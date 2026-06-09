/**
 * Project-Ops Triage Agent (PO-owned; registers in Brigade via the MCP manifest).
 *
 * Ingests candidate action items (from Meeting-Ops or ANY source), routes each to
 * the best-fitting project, dedups, and writes a TriageProposal for human review.
 * Items with no good project home get proposedProjectId = null -> the
 * "Unassigned / needs a project" inbox, from which a user assigns them to an
 * existing project or creates a new one (createProjectFromUnassigned).
 *
 * Inference runs ENTIRELY on local hardware, reached from the PO backend on
 * bigboy over the LAN:
 *   - embeddings + rerank: Infinity (bge-m3 / bge-reranker-v2-m3) on midboy2
 *   - reasoning: Qwen3.6-35B-A3B-Vision on midboy1
 * Thinking stays ON (it materially improves the keep/route judgment); per-item
 * calls keep the token budget bounded so the answer is never starved.
 *
 * Nothing is created in Project-Ops until a human approves a proposal.
 *
 * SUITE TENANCY (Phase 2, B9): every TriageProposal read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. All triage-owned DB access goes
 * through the passed `tx`, never `this.prisma`. The project embedding index is
 * cached PER WORKSPACE (keyed by workspaceId) — a global cache would let
 * workspace A's ingest match against workspace B's projects (R5). Additive +
 * inert while PROJECT_OPS_TENANCY_ENABLED is off (membership resolution is a
 * no-op and withWorkspace runs under the BYPASSRLS owner connection).
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TaskPriority, User } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';

export type CandidateItem = {
  text: string;
  owner?: string | null;
  sourceType?: string;
  /** stable id from the source (e.g. meeting-ops action_items.id) for idempotency */
  sourceActionItemId?: string;
  sourceRef?: Record<string, any>;
};

type ProjIndexEntry = {
  id: string;
  number: string;
  title: string;
  vec: number[];
};

/** A workspace-scoped, time-boxed project embedding index cache entry. */
type ProjIndexCacheEntry = {
  entries: ProjIndexEntry[];
  at: number;
};

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);
  /**
   * Project embedding index cache, keyed by workspaceId. MUST be workspace-keyed:
   * the index is the routing candidate set, so a global cache would serve
   * workspace A's projects as candidates for workspace B's items (cross-tenant
   * leak via routing). See blueprint R5.
   */
  private readonly projIndexByWorkspace = new Map<string, ProjIndexCacheEntry>();
  private static readonly INDEX_TTL_MS = 10 * 60 * 1000;
  private static readonly DEDUP_THRESHOLD = 0.82; // within-batch near-dup backstop

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
  ) {}

  // ---------- config (env with LAN defaults) ----------
  private get embedUrl() {
    return this.config.get<string>(
      'INFINITY_EMBEDDINGS_URL',
      'http://192.168.10.14:8082',
    );
  }
  private get rerankUrl() {
    return this.config.get<string>(
      'INFINITY_RERANK_URL',
      'http://192.168.10.14:8083',
    );
  }
  private get qwenUrl() {
    return this.config.get<string>(
      'QWEN_URL',
      'http://192.168.10.68:8088/v1/chat/completions',
    );
  }
  private get qwenModel() {
    return this.config.get<string>('QWEN_MODEL', 'Qwen3.6-35B-A3B-Vision');
  }
  private get embedModel() {
    return this.config.get<string>('INFINITY_EMBED_MODEL', 'BAAI/bge-m3');
  }
  private get rerankModel() {
    return this.config.get<string>(
      'INFINITY_RERANK_MODEL',
      'BAAI/bge-reranker-v2-m3',
    );
  }

  // ---------- inference helpers ----------
  private async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.embedUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embedModel, input: texts }),
    });
    if (!res.ok) throw new Error(`Infinity embeddings ${res.status}`);
    const data: any = await res.json();
    return (data.data ?? []).map((d: any) => d.embedding as number[]);
  }

  private async rerank(
    query: string,
    docs: string[],
    topN: number,
  ): Promise<{ index: number; score: number }[]> {
    const res = await fetch(`${this.rerankUrl}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.rerankModel,
        query,
        documents: docs,
        top_n: topN,
      }),
    });
    if (!res.ok) throw new Error(`Infinity rerank ${res.status}`);
    const data: any = await res.json();
    return (data.results ?? []).map((r: any) => ({
      index: r.index,
      score: r.relevance_score ?? 0,
    }));
  }

  private async qwenDecide(userMsg: string): Promise<any | null> {
    const res = await fetch(this.qwenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.qwenModel,
        messages: [
          { role: 'system', content: TriageService.SYSTEM },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.1,
        max_tokens: 1800,
      }),
    });
    if (!res.ok) throw new Error(`Qwen ${res.status}`);
    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    // content holds the answer; reasoning_content is the (discarded) thinking trace
    const text: string = msg.content || msg.reasoning_content || '';
    return this.firstJsonObject(text);
  }

  /** Extract the first balanced {...} that has a "keep" key (tolerates prose/think text around it). */
  private firstJsonObject(s: string): any | null {
    for (let st = 0; st < s.length; st++) {
      if (s[st] !== '{') continue;
      let depth = 0;
      for (let e = st; e < s.length; e++) {
        if (s[e] === '{') depth++;
        else if (s[e] === '}') {
          depth--;
          if (depth === 0) {
            try {
              const v = JSON.parse(s.slice(st, e + 1));
              if (v && typeof v === 'object' && 'keep' in v) return v;
            } catch {
              /* keep scanning */
            }
            break;
          }
        }
      }
    }
    return null;
  }

  private cosine(a: number[], b: number[]): number {
    let s = 0,
      na = 0,
      nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      s += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return s / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  // ---------- cached project embedding index (per workspace) ----------
  /**
   * Build/return the project embedding index for the ACTIVE workspace. The cache
   * key is `workspaceId` (R5): the index is the candidate set we route against,
   * so it must never be shared across workspaces. Reads run through the passed
   * `tx` so the project rows are RLS-scoped to the active workspace.
   */
  private async getProjectIndex(
    tx: WorkspaceTxClient,
    workspaceId: string,
  ): Promise<ProjIndexEntry[]> {
    const cached = this.projIndexByWorkspace.get(workspaceId);
    if (cached && Date.now() - cached.at < TriageService.INDEX_TTL_MS) {
      return cached.entries;
    }
    const rows = await tx.project.findMany({
      select: {
        id: true,
        projectNumber: true,
        title: true,
        description: true,
      },
    });
    const texts = rows.map(
      (r) =>
        `${r.projectNumber}: ${r.title}. ${(r.description ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 500)}`,
    );
    const vecs = texts.length ? await this.embed(texts) : [];
    const entries: ProjIndexEntry[] = rows.map((r, i) => ({
      id: r.id,
      number: r.projectNumber,
      title: r.title,
      vec: vecs[i] ?? [],
    }));
    this.projIndexByWorkspace.set(workspaceId, { entries, at: Date.now() });
    this.logger.log(
      `triage: project index built (${entries.length}) ws=${workspaceId}`,
    );
    return entries;
  }

  private static readonly SYSTEM = [
    'You triage ONE meeting action item into Project-Ops. You get the item, candidate projects (most-relevant first), and similar existing tasks.',
    'keep: true if it is a real trackable task; false ONLY for pure device/computer steps, in-call logistics, chit-chat, or vague non-actionable notes.',
    'project: choose the candidate project NUMBER whose SUBJECT genuinely covers this task. Use "NONE" if none is a real topical home. Do NOT force-fit a task onto a project just because they share a generic word like "meeting", "call", "contact", or "data" (a networking lunch or hotel sales call is NOT a software project -> NONE). But DO route a clear topical match.',
    'dup_of_existing: text of a similar_existing_task it clearly duplicates, else null.',
    'title: clean imperative. pri: LOW|MEDIUM|HIGH|URGENT. Owners are diarized speaker labels; never assign.',
    'Return ONLY a JSON object: {"keep":true,"project":"P-00042","dup_of_existing":null,"title":"...","pri":"HIGH"}',
  ].join('\n');

  private toPriority(p: any): TaskPriority {
    const v = String(p ?? '').toUpperCase();
    if (v === 'MED') return TaskPriority.MEDIUM;
    return (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(v)
      ? v
      : 'MEDIUM') as TaskPriority;
  }

  /**
   * Ingest candidate action items -> create TriageProposal rows.
   * Propose-only: no tasks/projects are created here. Idempotent on
   * (workspaceId, sourceType, sourceActionItemId). Everything runs inside the
   * acting user's workspace RLS transaction.
   */
  async ingestCandidates(
    workspaceId: string,
    user: User,
    items: CandidateItem[],
  ) {
    if (!items?.length) return { created: 0, skipped: 0, proposals: [] as any[] };

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const index = await this.getProjectIndex(tx, workspaceId);
        const itemVecs = await this.embed(items.map((it) => it.text));
        const created: any[] = [];
        let skipped = 0;

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.sourceActionItemId) {
            const existing = await tx.triageProposal.findFirst({
              where: {
                sourceType: it.sourceType ?? 'MANUAL',
                sourceActionItemId: it.sourceActionItemId,
              },
              select: { id: true },
            });
            if (existing) {
              skipped++;
              continue;
            }
          }

          const vec = itemVecs[i] ?? [];
          const scored = index
            .map((p) => ({ p, c: this.cosine(vec, p.vec) }))
            .sort((a, b) => b.c - a.c)
            .slice(0, 8);
          let order = scored.map((s) => s.p);
          try {
            const rr = await this.rerank(
              it.text,
              scored.map((s) => `${s.p.number}: ${s.p.title}`),
              Math.min(4, scored.length),
            );
            order = rr.map((r) => scored[r.index].p);
          } catch {
            order = scored.slice(0, 4).map((s) => s.p);
          }

          const userMsg = JSON.stringify({
            action_item: it.text.slice(0, 300),
            candidate_projects: order.map((p) => `${p.number}: ${p.title}`),
            similar_existing_tasks: [] as string[], // existing-task dedup wired in a follow-up
          });

          let decision: any = null;
          try {
            decision = await this.qwenDecide(userMsg);
          } catch (e) {
            this.logger.warn(
              `triage qwen failed for item ${i}: ${(e as Error).message}`,
            );
          }

          const keep = decision ? decision.keep !== false : true;
          const projNumber: string | null =
            decision?.project && decision.project !== 'NONE'
              ? decision.project
              : null;
          const proj = projNumber
            ? index.find((p) => p.number === projNumber)
            : null;
          const top = order[0];

          const proposal = await tx.triageProposal.create({
            data: {
              workspaceId,
              rawText: it.text,
              owner: it.owner ?? null,
              sourceType: it.sourceType ?? 'MANUAL',
              sourceActionItemId: it.sourceActionItemId ?? null,
              sourceRef: (it.sourceRef ?? null) as any,
              agentKeep: keep,
              proposedProjectId: proj?.id ?? null,
              proposedTitle: decision?.title ?? it.text.slice(0, 120),
              proposedPriority: this.toPriority(decision?.pri),
              dedupeNote: decision?.dup_of_existing ?? null,
              matchScore: top
                ? Number(this.cosine(vec, top.vec).toFixed(4))
                : null,
              alternatives: order.map((p) => ({
                number: p.number,
                title: p.title,
              })) as any,
              reasoning: decision?.reason ?? null,
              status: 'PENDING_REVIEW',
              createdById: user.id,
            },
          });
          created.push(proposal);
        }

        this.logger.log(
          `triage: ${created.length} proposals (${skipped} skipped) user=${user.id} ws=${workspaceId}`,
        );
        return { created: created.length, skipped, proposals: created };
      },
      workspaceId,
    );
  }

  /** The "Unassigned / needs a project" inbox: kept, no project, not a dup, still pending. */
  listInbox(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.triageProposal.findMany({
          where: {
            status: 'PENDING_REVIEW',
            agentKeep: true,
            proposedProjectId: null,
            dedupeNote: null,
          },
          orderBy: { createdAt: 'desc' },
        }),
      workspaceId,
    );
  }

  listPending(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.triageProposal.findMany({
          where: { status: 'PENDING_REVIEW' },
          orderBy: { createdAt: 'desc' },
          include: {
            proposedProject: { select: { projectNumber: true, title: true } },
          },
        }),
      workspaceId,
    );
  }

  async approve(
    workspaceId: string,
    user: User,
    proposalId: string,
    overrideProjectId?: string,
  ) {
    return this.workspaceContext.runForUser(
      user,
      (tx) => this.approveInTx(tx, workspaceId, user, proposalId, overrideProjectId),
      workspaceId,
    );
  }

  /**
   * Approve a proposal inside an existing workspace tx. Shared by `approve` and
   * `createProjectFromUnassigned` so both run in ONE workspace-scoped
   * transaction (and one membership authorization).
   *
   * The Task is created via `this.tasks.createInTx(tx, workspaceId, user, dto)`
   * (B2 landed), so it is created inside THIS workspace tx — one transaction,
   * one membership authorization, and the row is stamped with the active
   * workspaceId rather than inheriting a default.
   */
  private async approveInTx(
    tx: WorkspaceTxClient,
    workspaceId: string,
    user: User,
    proposalId: string,
    overrideProjectId?: string,
  ) {
    const p = await tx.triageProposal.findUnique({
      where: { id: proposalId },
    });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.status !== 'PENDING_REVIEW')
      throw new BadRequestException(`proposal is ${p.status}`);
    const projectId = overrideProjectId ?? p.proposedProjectId;
    if (!projectId)
      throw new BadRequestException(
        'no project resolved: assign one or use create-project-from-unassigned',
      );
    const task = await this.tasks.createInTx(tx, workspaceId, user, {
      projectId,
      title: p.proposedTitle,
      description: p.rawText,
      priority: p.proposedPriority,
    } as any);
    return tx.triageProposal.update({
      where: { id: proposalId },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
        reviewedById: user.id,
        proposedProjectId: projectId,
        createdTaskId: task.id,
      },
    });
  }

  async reject(
    workspaceId: string,
    user: User,
    proposalId: string,
    reason?: string,
  ) {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.triageProposal.update({
          where: { id: proposalId },
          data: {
            status: 'REJECTED',
            reviewedById: user.id,
            rejectionReason: reason ?? null,
          },
        }),
      workspaceId,
    );
  }

  /** Create a NEW project from a set of unassigned proposals, then apply them as its tasks. */
  async createProjectFromUnassigned(
    workspaceId: string,
    user: User,
    proposalIds: string[],
    projectInput: {
      title: string;
      clientName: string;
      description?: string;
      priority?: string;
    },
  ) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // B1 landed: create the Project inside THIS workspace tx via the
        // tx-accepting variant, so the new Project (and its project-number
        // sequence) is scoped to the active workspace and shares the single
        // runForUser/membership authorization with the proposals applied below.
        const project = await this.projects.createInTx(
          tx,
          workspaceId,
          user,
          projectInput as any,
        );
        const applied: string[] = [];
        for (const id of proposalIds) {
          try {
            await this.approveInTx(tx, workspaceId, user, id, project.id);
            applied.push(id);
          } catch (e) {
            this.logger.warn(
              `apply ${id} -> new project failed: ${(e as Error).message}`,
            );
          }
        }
        return {
          projectId: project.id,
          projectNumber: (project as any).projectNumber,
          applied: applied.length,
        };
      },
      workspaceId,
    );
  }
}
