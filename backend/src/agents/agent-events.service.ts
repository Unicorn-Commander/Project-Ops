import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AgentActorKind, AgentVia, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { ucUidOf, WithWorkspaceClaim } from '../common/workspace/workspace.util';

/**
 * Agent activity & usage — the agent analog of time-tracking.
 *
 * SUITE TENANCY: `agent_events` is an RLS-scoped table (workspaceId column +
 * index + workspace_isolation policy). EVERY read runs inside the acting user's
 * workspace RLS tx via `WorkspaceContextService.runForUser`, through the passed
 * `tx` — never `this.prisma`. The WRITE path (`record`) runs inside the EXPLICIT
 * event workspace via `runInWorkspace` (no membership check — capture is a system
 * write already authorized by the calling request, exactly like AuditService),
 * so the row satisfies the RLS WITH CHECK under the NOBYPASSRLS runtime role.
 *
 * RESILIENCE: `record()` is a recorder, not a gate. It NEVER throws — a failed
 * capture must not break the action that triggered it (mirrors AuditService.log).
 * Failures are logged and swallowed.
 *
 * MONEY: `costUsd` is a Decimal(12,6) in the DB. We store it verbatim (callers
 * compute cost where a price is known) and serialize Decimal → JS number on the
 * wire (house pattern — see time-tracking/serialize). Aggregates sum in Prisma
 * and convert once.
 *
 * EFFICIENCY: rollups use grouped `groupBy`/`aggregate` over the windowed rows —
 * no N+1, no per-agent query.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Default reporting window when from/to are omitted: the trailing 30 days. */
const DEFAULT_WINDOW_DAYS = 30;
/** Switch the usage series from daily to weekly buckets past this many days. */
const SERIES_WEEKLY_THRESHOLD_DAYS = 70;

/** Arguments to record one agent event. A clean, explicit signature for callers. */
export interface RecordAgentEventInput {
  /** The workspace the event belongs to (the RLS fence for the write). Required. */
  workspaceId: string;
  /**
   * The acting user, when one is in context (used only for `app.uc_uid`
   * attribution on the write tx). Optional: federation/system captures may have
   * no human user.
   */
  user?: (User & Partial<WithWorkspaceClaim>) | null;
  /** Explicit uc_uid override when no `user` is available (e.g. a federated sub). */
  ucUid?: string | null;

  actorKind: AgentActorKind;
  /** Stable per-agent key: PAT id / "assistant" / federated sub / user id. */
  actorKey: string;
  /** Human-readable label ("Claude Code · Field bot", "Project Assistant"). */
  actorLabel: string;
  via: AgentVia;
  /** Tool name or verb ("create_task", "assistant.turn"). */
  action: string;

  resource?: string | null;
  resourceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;

  tokensIn?: number | null;
  tokensOut?: number | null;
  /** Cost in USD. Number or Decimal; null when unknown / zero-LLM-cost. */
  costUsd?: number | Prisma.Decimal | null;
  durationMs?: number | null;
  /** Arbitrary structured context (kept small — args summaries, ids). */
  details?: Prisma.InputJsonValue | null;
}

/** One row of the agent roster (`GET /agents`). */
export interface AgentRosterRow {
  actorKey: string;
  actorLabel: string;
  actorKind: AgentActorKind;
  via: AgentVia;
  eventCount: number;
  lastActiveAt: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  billableCostUsd: number;
  projectCount: number;
}

/** Chart-friendly bucket: a labeled period with its event count + cost. */
export interface AgentSeriesPoint {
  label: string;
  eventCount: number;
  costUsd: number;
}

@Injectable()
export class AgentEventsService {
  private readonly logger = new Logger(AgentEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // WRITE — the resilient recorder. Never throws.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Record one agent event inside its workspace RLS context. NEVER throws: a
   * capture failure is logged and swallowed so the triggering action is
   * unaffected (the AuditService contract). Returns the created row's id on
   * success, or null on any failure / when `workspaceId` is missing.
   *
   * The write runs via `runInWorkspace` (explicit workspace, no membership
   * check) so the row's workspaceId equals the GUC and satisfies WITH CHECK
   * under the NOBYPASSRLS runtime role.
   */
  async record(input: RecordAgentEventInput): Promise<string | null> {
    try {
      if (!input.workspaceId || !input.workspaceId.trim()) {
        // Fail closed + loud-ish: a capture with no workspace can't be fenced.
        this.logger.warn(`agent event "${input.action}" dropped: no workspaceId`);
        return null;
      }

      const ucUid = input.ucUid ?? (input.user ? ucUidOf(input.user) : '');

      const data: Prisma.AgentEventUncheckedCreateInput = {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        actorKind: input.actorKind,
        actorKey: input.actorKey,
        actorLabel: input.actorLabel,
        via: input.via,
        action: input.action,
        resource: input.resource ?? null,
        resourceId: input.resourceId ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        costUsd: input.costUsd ?? null,
        durationMs: input.durationMs ?? null,
        details: input.details ?? Prisma.JsonNull,
      };

      const row = await this.workspaceContext.runInWorkspace(input.workspaceId, ucUid, (tx) =>
        tx.agentEvent.create({ data, select: { id: true } }),
      );

      this.logger.debug(
        `agent event recorded: ${input.action} by ${input.actorKey} [${input.via}]`,
      );
      return row.id;
    } catch (error) {
      // Don't throw — capture must not break application flow.
      this.logger.error(`Failed to record agent event "${input.action}"`, error as Error);
      return null;
    }
  }

  /**
   * Convenience for call-sites that have a request `user` but not a resolved
   * workspace id (e.g. the assistant): resolve the user's active workspace from
   * their claim and record. NON-authorizing (the triggering request was already
   * authorized) and never-throws, same as `record`. `workspaceId` in `input` is
   * ignored — it's derived from the user here.
   */
  async recordForUser(
    user: User & Partial<WithWorkspaceClaim>,
    input: Omit<RecordAgentEventInput, 'workspaceId' | 'user'>,
  ): Promise<string | null> {
    try {
      const workspaceId = this.workspaceContext.resolve(user);
      return this.record({ ...input, workspaceId, user });
    } catch (error) {
      this.logger.error(`Failed to record agent event "${input.action}" for user`, error as Error);
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Pure helpers (no DB) — unit-tested directly.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the reporting window from optional ISO `from`/`to`. When either is
   * omitted, default to the trailing 30 days ending now. Validates `from <= to`.
   * `now` is injectable so the default branch is deterministic in tests.
   */
  resolveWindow(from?: string, to?: string, now: Date = new Date()): { from: Date; to: Date } {
    const t = to ? new Date(to) : new Date(now);
    const f = from ? new Date(from) : new Date(now.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (f.getTime() > t.getTime()) {
      throw new BadRequestException('`from` must be on or before `to`');
    }
    return { from: f, to: t };
  }

  /** Inclusive window length in whole days (>= 1). */
  static windowDays(window: { from: Date; to: Date }): number {
    return Math.max(1, Math.ceil((window.to.getTime() - window.from.getTime()) / MS_PER_DAY));
  }

  /** UTC `YYYY-MM-DD` day key for a timestamp. */
  static dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** UTC ISO-week label `YYYY-Www` for a timestamp (weekly bucketing). */
  static weekKey(date: Date): string {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week =
      1 +
      Math.round(
        ((d.getTime() - firstThursday.getTime()) / MS_PER_DAY -
          3 +
          ((firstThursday.getUTCDay() + 6) % 7)) /
          7,
      );
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  /**
   * Bucket events into a contiguous, chart-ready series across the window.
   * Daily buckets for windows up to ~10 weeks, weekly beyond that, so the
   * series stays readable. Buckets with no events are emitted as zero so the
   * chart has no gaps. `events` need only carry `occurredAt` + `costUsd`.
   */
  static buildSeries(
    window: { from: Date; to: Date },
    events: { occurredAt: Date; costUsd: number }[],
  ): AgentSeriesPoint[] {
    const days = AgentEventsService.windowDays(window);
    const weekly = days > SERIES_WEEKLY_THRESHOLD_DAYS;
    const keyOf = weekly ? AgentEventsService.weekKey : AgentEventsService.dayKey;

    // Seed every bucket across the window so gaps render as zero.
    const order: string[] = [];
    const buckets = new Map<string, AgentSeriesPoint>();
    const stepMs = weekly ? 7 * MS_PER_DAY : MS_PER_DAY;
    for (let t = window.from.getTime(); t <= window.to.getTime(); t += stepMs) {
      const label = keyOf(new Date(t));
      if (!buckets.has(label)) {
        buckets.set(label, { label, eventCount: 0, costUsd: 0 });
        order.push(label);
      }
    }

    for (const e of events) {
      const label = keyOf(e.occurredAt);
      let b = buckets.get(label);
      if (!b) {
        // An event exactly on the upper boundary can hash to a not-yet-seeded
        // bucket; add it rather than drop it.
        b = { label, eventCount: 0, costUsd: 0 };
        buckets.set(label, b);
        order.push(label);
      }
      b.eventCount += 1;
      b.costUsd = round2(b.costUsd + (e.costUsd || 0));
    }

    return order.map((label) => buckets.get(label)!);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // READ — aggregation builders (RLS-scoped: every query runs on the workspace tx).
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `GET /agents` — the agent roster: one row per distinct agent (keyed by
   * actorKey) with lifetime-ish rollups, plus workspace totals. No window: the
   * roster is "every agent we've seen". Uses grouped queries (no N+1):
   *   1) groupBy actorKey → count, token/cost sums, lastActiveAt.
   *   2) a per-(actorKey,projectId) groupBy → distinct project count per agent.
   *   3) a per-actorKey billable-cost sum (separate so the unfiltered totals
   *      stay correct).
   * Identity columns (actorLabel/Kind/via) are taken from each agent's MOST
   * RECENT event so a relabeled agent shows its latest label.
   */
  async getRoster(
    workspaceId: string,
    user: User & Partial<WithWorkspaceClaim>,
  ): Promise<{
    agents: AgentRosterRow[];
    totals: {
      agentCount: number;
      eventCount: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
    };
  }> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [grouped, billableGrouped, projectPairs, latestRows] = await Promise.all([
          tx.agentEvent.groupBy({
            by: ['actorKey'],
            _count: { _all: true },
            _sum: { tokensIn: true, tokensOut: true, costUsd: true },
            _max: { occurredAt: true },
          }),
          tx.agentEvent.groupBy({
            by: ['actorKey'],
            where: { billable: true },
            _sum: { costUsd: true },
          }),
          tx.agentEvent.groupBy({
            by: ['actorKey', 'projectId'],
            where: { projectId: { not: null } },
            _count: { _all: true },
          }),
          // Most-recent event per agent for its display identity. One indexed
          // scan; we fold to first-seen-per-key in JS (cheap; bounded by event
          // count, and we only need the columns).
          tx.agentEvent.findMany({
            orderBy: { occurredAt: 'desc' },
            select: { actorKey: true, actorLabel: true, actorKind: true, via: true },
          }),
        ]);

        const billableByKey = new Map<string, number>();
        for (const b of billableGrouped)
          billableByKey.set(b.actorKey, decToNum(b._sum.costUsd) ?? 0);

        const projectCountByKey = new Map<string, number>();
        for (const p of projectPairs) {
          projectCountByKey.set(p.actorKey, (projectCountByKey.get(p.actorKey) ?? 0) + 1);
        }

        const latestByKey = new Map<string, (typeof latestRows)[number]>();
        for (const r of latestRows)
          if (!latestByKey.has(r.actorKey)) latestByKey.set(r.actorKey, r);

        const agents: AgentRosterRow[] = grouped.map((g) => {
          const latest = latestByKey.get(g.actorKey);
          return {
            actorKey: g.actorKey,
            actorLabel: latest?.actorLabel ?? g.actorKey,
            actorKind: latest?.actorKind ?? AgentActorKind.SYSTEM,
            via: latest?.via ?? AgentVia.SYSTEM,
            eventCount: g._count._all,
            lastActiveAt: g._max.occurredAt ? g._max.occurredAt.toISOString() : null,
            tokensIn: g._sum.tokensIn ?? 0,
            tokensOut: g._sum.tokensOut ?? 0,
            costUsd: decToNum(g._sum.costUsd) ?? 0,
            billableCostUsd: billableByKey.get(g.actorKey) ?? 0,
            projectCount: projectCountByKey.get(g.actorKey) ?? 0,
          };
        });

        // Most active first, then by label for a stable order.
        agents.sort(
          (a, b) => b.eventCount - a.eventCount || a.actorLabel.localeCompare(b.actorLabel),
        );

        const totals = {
          agentCount: agents.length,
          eventCount: agents.reduce((s, a) => s + a.eventCount, 0),
          tokensIn: agents.reduce((s, a) => s + a.tokensIn, 0),
          tokensOut: agents.reduce((s, a) => s + a.tokensOut, 0),
          costUsd: round2(agents.reduce((s, a) => s + a.costUsd, 0)),
        };

        return { agents, totals };
      },
      workspaceId,
    );
  }

  /**
   * `GET /agents/activity` — the paged activity feed across the window, newest
   * first, with optional actorKey/projectId/via filters. Returns the page rows
   * (Decimal costUsd → number) plus the unpaged `total` for the same filter.
   */
  async getActivity(
    workspaceId: string,
    user: User & Partial<WithWorkspaceClaim>,
    opts: {
      from?: string;
      to?: string;
      actorKey?: string;
      projectId?: string;
      via?: AgentVia;
      limit: number;
      offset: number;
    },
  ): Promise<{ data: any[]; total: number }> {
    const window = this.resolveWindow(opts.from, opts.to);
    const where: Prisma.AgentEventWhereInput = {
      occurredAt: { gte: window.from, lte: window.to },
      ...(opts.actorKey ? { actorKey: opts.actorKey } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.via ? { via: opts.via } : {}),
    };

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.agentEvent.findMany({
            where,
            orderBy: { occurredAt: 'desc' },
            skip: opts.offset,
            take: opts.limit,
          }),
          tx.agentEvent.count({ where }),
        ]);
        return { data: rows.map(serializeActivityRow), total };
      },
      workspaceId,
    );
  }

  /**
   * `GET /agents/usage` — usage & cost over the window: per-agent rollup +
   * a per-day/week series + window totals. The series scans the windowed rows
   * once (occurredAt + costUsd only) and buckets in JS.
   */
  async getUsage(
    workspaceId: string,
    user: User & Partial<WithWorkspaceClaim>,
    from?: string,
    to?: string,
  ): Promise<{
    period: { from: string; to: string };
    byAgent: {
      actorKey: string;
      actorLabel: string;
      eventCount: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
    }[];
    series: AgentSeriesPoint[];
    totals: { eventCount: number; tokensIn: number; tokensOut: number; costUsd: number };
  }> {
    const window = this.resolveWindow(from, to);
    const where: Prisma.AgentEventWhereInput = { occurredAt: { gte: window.from, lte: window.to } };

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [grouped, labelRows, seriesRows] = await Promise.all([
          tx.agentEvent.groupBy({
            by: ['actorKey'],
            where,
            _count: { _all: true },
            _sum: { tokensIn: true, tokensOut: true, costUsd: true },
          }),
          // Latest label per agent within the window (display identity).
          tx.agentEvent.findMany({
            where,
            orderBy: { occurredAt: 'desc' },
            select: { actorKey: true, actorLabel: true },
          }),
          tx.agentEvent.findMany({
            where,
            select: { occurredAt: true, costUsd: true },
          }),
        ]);

        const labelByKey = new Map<string, string>();
        for (const r of labelRows)
          if (!labelByKey.has(r.actorKey)) labelByKey.set(r.actorKey, r.actorLabel);

        const byAgent = grouped
          .map((g) => ({
            actorKey: g.actorKey,
            actorLabel: labelByKey.get(g.actorKey) ?? g.actorKey,
            eventCount: g._count._all,
            tokensIn: g._sum.tokensIn ?? 0,
            tokensOut: g._sum.tokensOut ?? 0,
            costUsd: decToNum(g._sum.costUsd) ?? 0,
          }))
          .sort((a, b) => b.costUsd - a.costUsd || b.eventCount - a.eventCount);

        const series = AgentEventsService.buildSeries(
          window,
          seriesRows.map((r) => ({ occurredAt: r.occurredAt, costUsd: decToNum(r.costUsd) ?? 0 })),
        );

        const totals = {
          eventCount: byAgent.reduce((s, a) => s + a.eventCount, 0),
          tokensIn: byAgent.reduce((s, a) => s + a.tokensIn, 0),
          tokensOut: byAgent.reduce((s, a) => s + a.tokensOut, 0),
          costUsd: round2(byAgent.reduce((s, a) => s + a.costUsd, 0)),
        };

        return {
          period: { from: window.from.toISOString(), to: window.to.toISOString() },
          byAgent,
          series,
          totals,
        };
      },
      workspaceId,
    );
  }

  /**
   * `GET /agents/:actorKey` — one agent's detail over the window: identity +
   * first/last seen (lifetime, NOT window-bounded — useful context), windowed
   * totals, per-project breakdown (with project names resolved via the
   * project relation), a series, and the recent activity rows. 404 when the
   * agent has never been seen in the workspace.
   */
  async getAgent(
    workspaceId: string,
    user: User & Partial<WithWorkspaceClaim>,
    actorKey: string,
    from?: string,
    to?: string,
    recentLimit = 25,
  ): Promise<any> {
    const window = this.resolveWindow(from, to);
    const windowWhere: Prisma.AgentEventWhereInput = {
      actorKey,
      occurredAt: { gte: window.from, lte: window.to },
    };

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Identity + lifetime bounds come from ALL of this agent's events (not
        // the window) so the header is stable regardless of the chosen range.
        const [latest, lifetimeBounds] = await Promise.all([
          tx.agentEvent.findFirst({
            where: { actorKey },
            orderBy: { occurredAt: 'desc' },
            select: { actorKey: true, actorLabel: true, actorKind: true, via: true },
          }),
          tx.agentEvent.aggregate({
            where: { actorKey },
            _min: { occurredAt: true },
            _max: { occurredAt: true },
          }),
        ]);

        if (!latest) {
          throw new NotFoundException(
            `No agent activity for actorKey "${actorKey}" in this workspace.`,
          );
        }

        const [windowAgg, projectGroups, seriesRows, recent] = await Promise.all([
          tx.agentEvent.aggregate({
            where: windowWhere,
            _count: { _all: true },
            _sum: { tokensIn: true, tokensOut: true, costUsd: true },
          }),
          tx.agentEvent.groupBy({
            by: ['projectId'],
            where: { ...windowWhere, projectId: { not: null } },
            _count: { _all: true },
            _sum: { costUsd: true },
          }),
          tx.agentEvent.findMany({
            where: windowWhere,
            select: { occurredAt: true, costUsd: true },
          }),
          tx.agentEvent.findMany({
            where: windowWhere,
            orderBy: { occurredAt: 'desc' },
            take: recentLimit,
          }),
        ]);

        // Resolve project names for the breakdown in ONE query (no N+1).
        const projectIds = projectGroups.map((g) => g.projectId).filter((id): id is string => !!id);
        const projects =
          projectIds.length > 0
            ? await tx.project.findMany({
                where: { id: { in: projectIds } },
                select: { id: true, title: true, projectNumber: true },
              })
            : [];
        const nameById = new Map(projects.map((p) => [p.id, p.title || p.projectNumber || p.id]));

        const byProject = projectGroups
          .map((g) => ({
            projectId: g.projectId as string,
            projectName: nameById.get(g.projectId as string) ?? null,
            eventCount: g._count._all,
            costUsd: decToNum(g._sum.costUsd) ?? 0,
          }))
          .sort((a, b) => b.eventCount - a.eventCount);

        const series = AgentEventsService.buildSeries(
          window,
          seriesRows.map((r) => ({ occurredAt: r.occurredAt, costUsd: decToNum(r.costUsd) ?? 0 })),
        );

        return {
          agent: {
            actorKey: latest.actorKey,
            actorLabel: latest.actorLabel,
            actorKind: latest.actorKind,
            via: latest.via,
            firstSeenAt: lifetimeBounds._min.occurredAt
              ? lifetimeBounds._min.occurredAt.toISOString()
              : null,
            lastActiveAt: lifetimeBounds._max.occurredAt
              ? lifetimeBounds._max.occurredAt.toISOString()
              : null,
          },
          totals: {
            eventCount: windowAgg._count._all,
            tokensIn: windowAgg._sum.tokensIn ?? 0,
            tokensOut: windowAgg._sum.tokensOut ?? 0,
            costUsd: decToNum(windowAgg._sum.costUsd) ?? 0,
          },
          byProject,
          series,
          recent: recent.map(serializeActivityRow),
        };
      },
      workspaceId,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // BILLING HOOK (light). Flag one event billable; rollups already fold it.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Flag (or un-flag) a single agent event as billable (ADMIN/MANAGER — gated
   * at the controller). The update runs inside the workspace RLS tx, so a
   * manager can only flag events in their own workspace (a foreign id resolves
   * to 0 rows under RLS → 404). The flag drives `billableCostUsd` in the roster.
   *
   * TODO(accounting-ops): the full agent-billing rollup — turning the sum of
   * billable agent cost into an Accounting-Ops draft invoice line (like the
   * time-tracking BillableRollupService does for billable hours) — is OUT of
   * scope here. Extension point: a future AgentBillingService can read the
   * billable events for a project/period and assemble a draft. This flag is the
   * source signal; nothing downstream consumes it yet.
   */
  async setBillable(
    workspaceId: string,
    user: User & Partial<WithWorkspaceClaim>,
    id: string,
    billable: boolean,
  ): Promise<any> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Existence is RLS-scoped: a foreign id is invisible here.
        const existing = await tx.agentEvent.findUnique({ where: { id }, select: { id: true } });
        if (!existing) {
          throw new NotFoundException(`Agent event ${id} not found in this workspace.`);
        }
        const updated = await tx.agentEvent.update({ where: { id }, data: { billable } });
        return serializeActivityRow(updated);
      },
      workspaceId,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire serialization + small numeric helpers (house pattern).
// ─────────────────────────────────────────────────────────────────────────────

/** Prisma Decimal | null -> number | null (house pattern, see time-tracking/serialize). */
export function decToNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return parseFloat(v.toString());
}

/** Round to 2 decimals, avoiding float dust (cost SUMS are dollars; 2dp is the wire precision). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Shape one AgentEvent for the activity wire: Decimal costUsd → number, Dates →
 * ISO strings, and the exact field set the frontend is built against. Safe on a
 * bare event row.
 */
export function serializeActivityRow(e: any): any {
  if (!e) return e;
  return {
    id: e.id,
    occurredAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : e.occurredAt,
    actorKey: e.actorKey,
    actorLabel: e.actorLabel,
    actorKind: e.actorKind,
    via: e.via,
    action: e.action,
    resource: e.resource ?? null,
    resourceId: e.resourceId ?? null,
    projectId: e.projectId ?? null,
    taskId: e.taskId ?? null,
    tokensIn: e.tokensIn ?? null,
    tokensOut: e.tokensOut ?? null,
    costUsd: decToNum(e.costUsd),
    durationMs: e.durationMs ?? null,
    billable: e.billable ?? false,
  };
}
