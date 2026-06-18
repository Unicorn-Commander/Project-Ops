import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutomationRule, AutomationTrigger, Prisma, TaskStatus, User } from '@prisma/client';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { TasksService } from '../tasks/tasks.service';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import { ActionType, AutomationAction, AutomationEvent } from './automation.types';
import { matchesConditions, parseConditions } from './automation-conditions';
import { AutomationContext } from './automation-context';

/**
 * Automations / rules engine.
 *
 * CRUD (request paths) runs through `workspaceContext.runForUser` so the
 * AutomationRule reads/writes are RLS-scoped to the caller's workspace, exactly
 * like every other module (Tasks/Notifications). The ENGINE side
 * (`runRulesForEvent`) is invoked by the event listener with no request user,
 * so it resolves rules + executes inside `runInWorkspace(workspaceId, ucUid)`.
 *
 * ACTION EXECUTION: actions reuse the real domain services (TasksService,
 * NotificationsService) rather than poking the DB directly, so every action
 * gets the same validation/authorization/RLS those services enforce. Because
 * TasksService methods act AS a User, the engine loads the rule's `createdBy`
 * user (the rule author — an ADMIN/MANAGER, since CRUD is role-gated) and acts
 * as them. The notify action has no acting-user requirement and uses
 * NotificationsService.create (system/event path).
 *
 * LOOP GUARD: see AutomationContext. Mutating actions emit fresh `task.*`
 * events; the listener consults the ALS depth and refuses to spawn another
 * generation past AUTOMATION_MAX_DEPTH.
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);
  private readonly maxDepth: number;

  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly config: ConfigService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService,
    private readonly automationContext: AutomationContext,
  ) {
    const raw = Number(this.config.get<string>('AUTOMATION_MAX_DEPTH'));
    this.maxDepth = Number.isFinite(raw) && raw >= 0 ? raw : 1;
  }

  // ───────────────────────────────────────────────────────────────────────
  // CRUD (request-scoped, workspace RLS)
  // ───────────────────────────────────────────────────────────────────────

  /** List the active workspace's automation rules, newest first. */
  async findAll(
    workspaceId: string,
    user: User,
    params: { trigger?: AutomationTrigger; enabled?: boolean } = {},
  ): Promise<AutomationRule[]> {
    const where: Prisma.AutomationRuleWhereInput = {};
    if (params.trigger) where.trigger = params.trigger;
    if (typeof params.enabled === 'boolean') where.enabled = params.enabled;

    return this.workspaceContext.runForUser(
      user,
      (tx) => tx.automationRule.findMany({ where, orderBy: { createdAt: 'desc' } }),
      workspaceId,
    );
  }

  /** One rule by id (404 when not visible in the active workspace). */
  async findOne(workspaceId: string, user: User, id: string): Promise<AutomationRule> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const rule = await tx.automationRule.findUnique({ where: { id } });
        if (!rule) throw new NotFoundException(`Automation rule ${id} not found`);
        return rule;
      },
      workspaceId,
    );
  }

  /** Create a rule, stamped with the active workspaceId + creator. */
  async create(
    workspaceId: string,
    user: User,
    dto: CreateAutomationRuleDto,
  ): Promise<AutomationRule> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const rule = await tx.automationRule.create({
          data: {
            workspaceId,
            name: dto.name,
            enabled: dto.enabled ?? true,
            trigger: dto.trigger,
            // Persist as plain JSON. Already validated to the right shape by the DTO.
            conditions: (dto.conditions ?? []) as unknown as Prisma.InputJsonValue,
            actions: dto.actions as unknown as Prisma.InputJsonValue,
            createdById: user.id,
          },
        });
        this.logger.log(`Automation rule ${rule.id} (${rule.trigger}) created ws=${workspaceId}`);
        return rule;
      },
      workspaceId,
    );
  }

  /** Patch a rule (only provided fields change). 404 when not in workspace. */
  async update(
    workspaceId: string,
    user: User,
    id: string,
    dto: UpdateAutomationRuleDto,
  ): Promise<AutomationRule> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const existing = await tx.automationRule.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException(`Automation rule ${id} not found`);

        const data: Prisma.AutomationRuleUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.enabled !== undefined) data.enabled = dto.enabled;
        if (dto.trigger !== undefined) data.trigger = dto.trigger;
        if (dto.conditions !== undefined)
          data.conditions = dto.conditions as unknown as Prisma.InputJsonValue;
        if (dto.actions !== undefined)
          data.actions = dto.actions as unknown as Prisma.InputJsonValue;

        const rule = await tx.automationRule.update({ where: { id }, data });
        this.logger.log(`Automation rule ${id} updated ws=${workspaceId}`);
        return rule;
      },
      workspaceId,
    );
  }

  /** Delete a rule. 404 when not in workspace. */
  async remove(workspaceId: string, user: User, id: string): Promise<{ message: string }> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const existing = await tx.automationRule.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException(`Automation rule ${id} not found`);
        await tx.automationRule.delete({ where: { id } });
        this.logger.log(`Automation rule ${id} deleted ws=${workspaceId}`);
        return { message: 'Automation rule deleted successfully' };
      },
      workspaceId,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Engine (event-driven, no request user)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Run every enabled rule for (workspaceId, trigger) against `event`. Called by
   * the listener. NEVER throws — a failing rule/action is logged and the rest
   * continue. Returns the number of rules that fired (for tests / observability).
   *
   * Loop guard: if we are already inside an automation chain at/over maxDepth,
   * skip entirely (the event was caused by an automation action and must not
   * spawn another generation).
   */
  async runRulesForEvent(trigger: AutomationTrigger, event: AutomationEvent): Promise<number> {
    if (!event?.workspaceId) {
      this.logger.warn(`Ignoring ${trigger}: event missing workspaceId`);
      return 0;
    }

    // Depth from ALS (in-process async chain) OR the stamped payload marker,
    // whichever is higher — see AutomationContext.
    const incomingDepth = Math.max(
      this.automationContext.currentDepth(),
      event.__automation?.depth ?? 0,
    );
    if (incomingDepth >= this.maxDepth) {
      this.logger.debug(
        `Loop guard: skipping ${trigger} (depth ${incomingDepth} >= max ${this.maxDepth}) ws=${event.workspaceId}`,
      );
      return 0;
    }

    let rules: AutomationRule[];
    try {
      rules = await this.workspaceContext.runInWorkspace(
        event.workspaceId,
        event.actorId ?? null,
        (tx) =>
          tx.automationRule.findMany({
            where: { trigger, enabled: true },
            orderBy: { createdAt: 'asc' },
          }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to load ${trigger} rules ws=${event.workspaceId}: ${(err as Error).message}`,
      );
      return 0;
    }

    if (rules.length === 0) return 0;

    let fired = 0;
    for (const rule of rules) {
      try {
        const conditions = parseConditions(rule.conditions);
        if (!matchesConditions(event, conditions)) continue;

        // Execute the rule's actions one depth deeper so any task.* events they
        // emit are short-circuited by the loop guard above (the ALS chain sets
        // the depth that the re-entrant runRulesForEvent reads).
        await this.automationContext.runInChain(incomingDepth + 1, () =>
          this.executeRule(rule, event),
        );
        fired++;
      } catch (err) {
        // A single rule failing must never break the others or bubble to the
        // emitter. Log + continue.
        this.logger.error(
          `Automation rule ${rule.id} (${trigger}) failed ws=${event.workspaceId}: ${(err as Error).message}`,
        );
      }
    }
    return fired;
  }

  /**
   * Execute a matched rule's actions in order, then bump runCount/lastRunAt.
   * Each action is independently guarded so one bad action doesn't abort the
   * rest of the rule.
   */
  private async executeRule(rule: AutomationRule, event: AutomationEvent): Promise<void> {
    const actions = this.parseActions(rule.actions);
    if (actions.length === 0) {
      this.logger.warn(`Automation rule ${rule.id} has no valid actions; skipping`);
      return;
    }

    // Resolve the actor (rule creator) ONCE for task-mutating actions. notify
    // doesn't need it. If the creator can't be loaded, task actions are skipped
    // (logged) but notify still runs.
    const actor = await this.loadActor(rule);

    for (const action of actions) {
      try {
        await this.dispatchAction(action, rule, event, actor);
      } catch (err) {
        this.logger.error(
          `Action "${action.type}" of rule ${rule.id} failed: ${(err as Error).message}`,
        );
      }
    }

    // Bump counters (best-effort; a failure here must not fail the rule run).
    try {
      await this.workspaceContext.runInWorkspace(rule.workspaceId, event.actorId ?? null, (tx) =>
        tx.automationRule.update({
          where: { id: rule.id },
          data: { runCount: { increment: 1 }, lastRunAt: new Date() },
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to bump runCount for rule ${rule.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Dispatch a single action to the right domain service. The target task id is
   * resolved from the event (the task that triggered it). All task mutations run
   * AS the rule's actor inside that actor's workspace RLS tx (via TasksService).
   */
  private async dispatchAction(
    action: AutomationAction,
    rule: AutomationRule,
    event: AutomationEvent,
    actor: User | null,
  ): Promise<void> {
    const ws = rule.workspaceId;
    const targetTaskId = this.eventTaskId(event);
    const projectId = this.eventProjectId(event);

    switch (action.type as ActionType) {
      case 'assign_task': {
        if (!actor) return this.warnNoActor(action.type, rule);
        if (!targetTaskId) return this.warnNoTarget(action.type, rule);
        const userId = String(action.params.userId);
        await this.tasks.assignTask(ws, actor, targetTaskId, userId);
        break;
      }
      case 'set_status': {
        if (!actor) return this.warnNoActor(action.type, rule);
        if (!targetTaskId) return this.warnNoTarget(action.type, rule);
        await this.tasks.updateStatus(ws, actor, targetTaskId, action.params.status as TaskStatus);
        break;
      }
      case 'add_comment': {
        if (!actor) return this.warnNoActor(action.type, rule);
        if (!targetTaskId) return this.warnNoTarget(action.type, rule);
        await this.tasks.addComment(ws, actor, targetTaskId, {
          content: String(action.params.text),
        } as any);
        break;
      }
      case 'create_task': {
        if (!actor) return this.warnNoActor(action.type, rule);
        // create_task may target an explicit projectId, else the event's project.
        const newProjectId = (action.params.projectId as string) || projectId;
        if (!newProjectId) {
          this.logger.warn(
            `create_task of rule ${rule.id} has no projectId (none in params or event); skipping`,
          );
          return;
        }
        await this.tasks.create(ws, actor, {
          projectId: newProjectId,
          title: String(action.params.title),
          priority: action.params.priority as any,
        } as any);
        break;
      }
      case 'notify': {
        const userId = String(action.params.userId);
        const message =
          (action.params.message as string) || `Automation "${rule.name}" notification`;
        await this.notifications.create({
          workspaceId: ws,
          userId,
          type: NotificationType.ASSIGNED,
          title: message,
          body: null,
          entityType: targetTaskId ? 'TASK' : projectId ? 'PROJECT' : null,
          entityId: targetTaskId ?? projectId ?? null,
          actorId: actor?.id ?? event.actorId ?? null,
        });
        break;
      }
      default:
        this.logger.warn(`Unknown action type "${(action as any).type}" in rule ${rule.id}`);
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /** Parse + shape-check the stored actions JSON into valid actions only. */
  private parseActions(raw: unknown): AutomationAction[] {
    if (!Array.isArray(raw)) return [];
    const out: AutomationAction[] = [];
    for (const a of raw) {
      if (
        a &&
        typeof a === 'object' &&
        typeof (a as any).type === 'string' &&
        (a as any).params &&
        typeof (a as any).params === 'object'
      ) {
        out.push({ type: (a as any).type, params: (a as any).params });
      }
    }
    return out;
  }

  /** The acting User for task-mutating actions: the rule's creator. */
  private async loadActor(rule: AutomationRule): Promise<User | null> {
    try {
      const actor = await this.workspaceContext.runInWorkspace(
        rule.workspaceId,
        rule.createdById,
        (tx) => tx.user.findUnique({ where: { id: rule.createdById } }),
      );
      if (!actor) {
        this.logger.warn(
          `Rule ${rule.id} creator ${rule.createdById} not found; task actions skipped`,
        );
      }
      return actor;
    } catch (err) {
      this.logger.warn(`Failed to load actor for rule ${rule.id}: ${(err as Error).message}`);
      return null;
    }
  }

  /** The task id an event concerns, if any. */
  private eventTaskId(event: AutomationEvent): string | null {
    return (event as { taskId?: string }).taskId ?? null;
  }

  /** The project id an event concerns, if any. */
  private eventProjectId(event: AutomationEvent): string | null {
    const e = event as { projectId?: string; task?: { projectId?: string } };
    return e.projectId ?? e.task?.projectId ?? null;
  }

  private warnNoActor(type: string, rule: AutomationRule): void {
    this.logger.warn(`Skipping "${type}" of rule ${rule.id}: no acting user could be resolved`);
  }

  private warnNoTarget(type: string, rule: AutomationRule): void {
    this.logger.warn(`Skipping "${type}" of rule ${rule.id}: event carries no target task`);
  }
}
