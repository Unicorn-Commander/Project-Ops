import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User, UserRole, TimeEntry } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { AuditService } from '../audit/audit.service';
import { EntryFinancialsService } from './entry-financials.service';
import { buildVisibilityFilter } from '../mcp/mcp.tools';
import { serializeTimeEntry } from './serialize';
import { StartTimerDto } from './dto/start-timer.dto';

export const ENTRY_INCLUDE = {
  project: { select: { id: true, projectNumber: true, title: true } },
  task: { select: { id: true, title: true, type: true } },
} as const;

@Injectable()
export class TimerService {
  private readonly logger = new Logger(TimerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financials: EntryFinancialsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  private assertCanWrite(user: Pick<User, 'role'>) {
    if (user.role === UserRole.CLIENT) {
      throw new ForbiddenException('CLIENT users cannot log time');
    }
  }

  /** True when starting a timer should auto-stop any running one (default). */
  private get startStopsRunning(): boolean {
    return (
      (this.config.get<string>('TIMER_START_STOPS_RUNNING', 'true') ?? 'true').toLowerCase() !==
      'false'
    );
  }

  async getRunning(workspaceId: string, user: Pick<User, 'id'>) {
    return this.workspaceContext.runForUser(
      user as User,
      async (tx) => {
        const entry = await tx.timeEntry.findFirst({
          where: { workspaceId, userId: user.id, endedAt: null },
          include: ENTRY_INCLUDE,
        });
        return entry ? serializeTimeEntry(entry, (user as User).role) : null;
      },
      workspaceId,
    );
  }

  async startTimer(workspaceId: string, user: User, dto: StartTimerDto) {
    this.assertCanWrite(user);

    // Whole start sequence (policy lookup → access check → stop any running →
    // create) runs in ONE workspace tx so the single-running-timer invariant is
    // enforced atomically and every read/write is RLS-scoped on the same tx.
    const created = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const policy = await this.financials.resolveBillablePolicy(tx, dto.projectId, dto.taskId);
        await this.assertProjectAccess(tx, user, policy.projectId);

        // Enforce the single-running-timer invariant (also guarded by a partial
        // unique index). Stop the existing one, or reject, per config.
        const running = await tx.timeEntry.findFirst({
          where: { workspaceId, userId: user.id, endedAt: null },
        });
        if (running) {
          if (this.startStopsRunning) {
            await this.finishEntry(tx, running, new Date(), user);
          } else {
            throw new BadRequestException(
              'A timer is already running. Stop it before starting a new one.',
            );
          }
        }

        return tx.timeEntry.create({
          data: {
            workspaceId,
            userId: user.id,
            projectId: policy.projectId,
            taskId: dto.taskId ?? null,
            description: dto.description ?? null,
            startedAt: new Date(),
            endedAt: null,
            source: 'TIMER',
            billable: policy.billable,
          },
          include: ENTRY_INCLUDE,
        });
      },
      workspaceId,
    );

    await this.audit.log({
      workspaceId,
      userId: user.id,
      projectId: created.projectId,
      action: 'CREATE',
      resource: 'TimeEntry',
      resourceId: created.id,
      details: { source: 'TIMER', action: 'start_timer' },
    });
    this.emit('timeEntry.created', created);
    this.logger.log(
      `start_timer: user=${user.email} project=${created.projectId} entry=${created.id}`,
    );

    return serializeTimeEntry(created, user.role);
  }

  async stopTimer(workspaceId: string, user: User) {
    this.assertCanWrite(user);

    const stopped = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const running = await tx.timeEntry.findFirst({
          where: { workspaceId, userId: user.id, endedAt: null },
        });
        if (!running) {
          throw new NotFoundException('No running timer to stop');
        }
        return this.finishEntry(tx, running, new Date(), user);
      },
      workspaceId,
    );
    this.logger.log(`stop_timer: user=${user.email} entry=${stopped.id}`);
    return serializeTimeEntry(stopped, user.role);
  }

  /**
   * Close a running entry at `endedAt`, computing duration, rounding, rates and
   * billable amount. Shared by stopTimer and the start-stops-running path.
   *
   * Runs on the caller's workspace `tx`: the financials compute (which reads
   * project/task/rate rows) and the entry update share ONE RLS transaction with
   * the caller, so they are workspace-scoped and atomic. Never opens its own tx.
   */
  private async finishEntry(
    tx: WorkspaceTxClient,
    entry: TimeEntry,
    endedAt: Date,
    user: User,
  ): Promise<TimeEntry> {
    const fin = await this.financials.compute(tx, {
      workspaceId: entry.workspaceId,
      userId: entry.userId,
      role: user.role,
      projectId: entry.projectId,
      taskId: entry.taskId,
      startedAt: entry.startedAt,
      endedAt,
      billable: entry.billable,
    });

    const updated = await tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        endedAt,
        durationSeconds: fin.durationSeconds,
        roundingAppliedSeconds: fin.roundingAppliedSeconds,
        billRateApplied: fin.billRateApplied ?? undefined,
        costRateApplied: fin.costRateApplied ?? undefined,
        currency: fin.currency,
        billableAmount: fin.billableAmount ?? undefined,
      },
      include: ENTRY_INCLUDE,
    });

    await this.audit.log({
      workspaceId: entry.workspaceId,
      userId: user.id,
      projectId: updated.projectId,
      action: 'UPDATE',
      resource: 'TimeEntry',
      resourceId: updated.id,
      details: { action: 'stop_timer', durationSeconds: fin.durationSeconds },
    });
    this.emit('timeEntry.stopped', updated);
    return updated;
  }

  private async assertProjectAccess(tx: WorkspaceTxClient, user: User, projectId: string) {
    const project = await tx.project.findFirst({
      where: { id: projectId, ...buildVisibilityFilter(user) },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found or no access');
    }
  }

  private emit(event: string, entry: TimeEntry) {
    this.events.emit(event, {
      projectId: entry.projectId,
      userId: entry.userId,
      timeEntry: entry,
    });
  }
}
