import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, User, UserRole, TimeEntry } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { AuditService } from '../audit/audit.service';
import { EntryFinancialsService } from './entry-financials.service';
import { buildTimeEntryVisibilityFilter } from '../common/workspace/time-entry-visibility';
import { buildVisibilityFilter } from '../mcp/mcp.tools';
import { serializeTimeEntry, serializeTimeEntries } from './serialize';
import { ENTRY_INCLUDE } from './timer.service';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto';
import { QueryTimeEntriesDto } from './dto/query-time-entries.dto';

@Injectable()
export class TimeEntryService {
  private readonly logger = new Logger(TimeEntryService.name);

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

  private get allowOverlapping(): boolean {
    return (
      (this.config.get<string>('ALLOW_OVERLAPPING_ENTRIES', 'false') ?? 'false').toLowerCase() ===
      'true'
    );
  }

  /** Manual time entry. Resolves start/end from start+end, start+duration, end+duration, or duration. */
  async logTime(workspaceId: string, user: User, dto: CreateTimeEntryDto) {
    this.assertCanWrite(user);

    // Whole create (policy → access → overlap → financials → insert) runs in ONE
    // workspace tx so every read/write is RLS-scoped on the same tx and the
    // overlap check is consistent with the row being created.
    const created = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const policy = await this.financials.resolveBillablePolicy(tx, dto.projectId, dto.taskId);
        await this.assertProjectAccess(tx, user, policy.projectId);

        const { startedAt, endedAt } = this.resolveInterval(dto);
        if (endedAt < startedAt) {
          throw new BadRequestException('endedAt cannot be before startedAt');
        }
        await this.assertNoOverlap(tx, workspaceId, user.id, startedAt, endedAt, null);

        const billable = dto.billable ?? policy.billable;
        const fin = await this.financials.compute(tx, {
          workspaceId,
          userId: user.id,
          role: user.role,
          projectId: policy.projectId,
          taskId: dto.taskId ?? null,
          startedAt,
          endedAt,
          billable,
        });

        const entry = await tx.timeEntry.create({
          data: {
            workspaceId,
            userId: user.id,
            projectId: policy.projectId,
            taskId: dto.taskId ?? null,
            description: dto.description ?? null,
            startedAt,
            endedAt,
            durationSeconds: fin.durationSeconds,
            roundingAppliedSeconds: fin.roundingAppliedSeconds,
            source: dto.source ?? 'MANUAL',
            billable,
            billRateApplied: fin.billRateApplied ?? undefined,
            costRateApplied: fin.costRateApplied ?? undefined,
            currency: fin.currency,
            billableAmount: fin.billableAmount ?? undefined,
          },
          include: ENTRY_INCLUDE,
        });

        await this.audit.log({
          workspaceId,
          userId: user.id,
          projectId: entry.projectId,
          action: 'CREATE',
          resource: 'TimeEntry',
          resourceId: entry.id,
          details: { source: entry.source, action: 'log_time' },
        });

        return entry;
      },
      workspaceId,
    );

    this.emit('timeEntry.created', created);
    this.logger.log(`log_time: user=${user.email} project=${created.projectId} entry=${created.id}`);

    return serializeTimeEntry(created, user.role);
  }

  async update(workspaceId: string, user: User, id: string, dto: UpdateTimeEntryDto) {
    this.assertCanWrite(user);

    const updated = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const entry = await this.loadOwned(tx, workspaceId, user, id);
        this.assertMutable(entry);

        // Resolve new interval (only if any timing field supplied).
        const wantsTiming =
          dto.startedAt !== undefined ||
          dto.endedAt !== undefined ||
          dto.durationMinutes !== undefined;
        let startedAt = entry.startedAt;
        let endedAt = entry.endedAt;
        if (wantsTiming) {
          const resolved = this.resolveInterval(
            {
              startedAt: dto.startedAt,
              endedAt: dto.endedAt,
              durationMinutes: dto.durationMinutes,
            },
            entry,
          );
          startedAt = resolved.startedAt;
          endedAt = resolved.endedAt;
          if (endedAt < startedAt) throw new BadRequestException('endedAt cannot be before startedAt');
          await this.assertNoOverlap(tx, workspaceId, user.id, startedAt, endedAt, entry.id);
        }

        const taskId = dto.taskId !== undefined ? dto.taskId : entry.taskId;
        const billable = dto.billable !== undefined ? dto.billable : entry.billable;

        // Recompute financials when timing, task, or billable changed and the
        // entry is closed (has an end). A still-running entry just patches fields.
        const data: Prisma.TimeEntryUpdateInput = {
          description: dto.description !== undefined ? dto.description : undefined,
          billable,
        };
        if (dto.taskId !== undefined) {
          data.task = taskId ? { connect: { id: taskId } } : { disconnect: true };
        }
        if (endedAt) {
          const fin = await this.financials.compute(tx, {
            workspaceId,
            userId: entry.userId,
            role: user.role,
            projectId: entry.projectId,
            taskId,
            startedAt,
            endedAt,
            billable,
          });
          data.startedAt = startedAt;
          data.endedAt = endedAt;
          data.durationSeconds = fin.durationSeconds;
          data.roundingAppliedSeconds = fin.roundingAppliedSeconds;
          data.billRateApplied = fin.billRateApplied ?? null;
          data.costRateApplied = fin.costRateApplied ?? null;
          data.currency = fin.currency;
          data.billableAmount = fin.billableAmount ?? null;
        } else if (wantsTiming) {
          data.startedAt = startedAt;
        }

        const result = await tx.timeEntry.update({
          where: { id: entry.id },
          data,
          include: ENTRY_INCLUDE,
        });

        await this.audit.log({
          workspaceId,
          userId: user.id,
          projectId: result.projectId,
          action: 'UPDATE',
          resource: 'TimeEntry',
          resourceId: result.id,
          details: { action: 'update_time_entry' },
        });

        return result;
      },
      workspaceId,
    );

    this.emit('timeEntry.updated', updated);
    return serializeTimeEntry(updated, user.role);
  }

  async remove(workspaceId: string, user: User, id: string) {
    this.assertCanWrite(user);

    const entry = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const target = await this.loadOwned(tx, workspaceId, user, id);
        this.assertMutable(target);

        await tx.timeEntry.delete({ where: { id: target.id } });
        await this.audit.log({
          workspaceId,
          userId: user.id,
          projectId: target.projectId,
          action: 'DELETE',
          resource: 'TimeEntry',
          resourceId: target.id,
          details: { action: 'delete_time_entry' },
        });
        return target;
      },
      workspaceId,
    );

    this.events.emit('timeEntry.deleted', { projectId: entry.projectId, userId: entry.userId, id: entry.id });
    return { message: 'Time entry deleted' };
  }

  async list(workspaceId: string, user: User, query: QueryTimeEntriesDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 50, 200);
    const skip = (page - 1) * limit;

    const where: Prisma.TimeEntryWhereInput = {
      ...buildTimeEntryVisibilityFilter(user, workspaceId),
    };
    if (query.userId) where.userId = query.userId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.taskId) where.taskId = query.taskId;
    if (query.billable !== undefined) where.billable = query.billable;
    if (query.billed !== undefined) where.billed = query.billed;
    if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
    if (query.from || query.to) {
      where.startedAt = {};
      if (query.from) (where.startedAt as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.startedAt as Prisma.DateTimeFilter).lte = new Date(query.to);
    }

    const { rows, total } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [entries, count] = await Promise.all([
          tx.timeEntry.findMany({
            where,
            skip,
            take: limit,
            orderBy: { startedAt: 'desc' },
            include: ENTRY_INCLUDE,
          }),
          tx.timeEntry.count({ where }),
        ]);
        return { rows: entries, total: count };
      },
      workspaceId,
    );

    return {
      data: serializeTimeEntries(rows, user.role),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(workspaceId: string, user: User, id: string) {
    const entry = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.timeEntry.findFirst({
          where: { id, ...buildTimeEntryVisibilityFilter(user, workspaceId) },
          include: ENTRY_INCLUDE,
        }),
      workspaceId,
    );
    if (!entry) throw new NotFoundException(`Time entry ${id} not found`);
    return serializeTimeEntry(entry, user.role);
  }

  // ── internals ────────────────────────────────────────────

  /** Load an entry the user is allowed to mutate (owner, or ADMIN/MANAGER). */
  private async loadOwned(
    tx: WorkspaceTxClient,
    workspaceId: string,
    user: User,
    id: string,
  ): Promise<TimeEntry> {
    const entry = await tx.timeEntry.findFirst({ where: { id, workspaceId } });
    if (!entry) throw new NotFoundException(`Time entry ${id} not found`);
    const elevated = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    if (entry.userId !== user.id && !elevated) {
      throw new ForbiddenException('You do not have permission to modify this time entry');
    }
    return entry;
  }

  /** Locked, billed, or non-DRAFT entries are immutable. */
  private assertMutable(entry: TimeEntry) {
    if (entry.billed) {
      throw new ForbiddenException('This time entry is billed and cannot be changed');
    }
    if (entry.lockedAt) {
      throw new ForbiddenException('This time entry is locked (approved/billed) and cannot be changed');
    }
    if (entry.approvalStatus !== 'DRAFT') {
      throw new ForbiddenException(
        `This time entry is ${entry.approvalStatus} and can only be edited while DRAFT`,
      );
    }
  }

  private resolveInterval(
    dto: { startedAt?: string; endedAt?: string; durationMinutes?: number },
    fallback?: TimeEntry,
  ): { startedAt: Date; endedAt: Date } {
    const start = dto.startedAt ? new Date(dto.startedAt) : fallback?.startedAt;
    const end = dto.endedAt ? new Date(dto.endedAt) : undefined;
    const durationMs =
      dto.durationMinutes !== undefined ? Math.round(dto.durationMinutes * 60_000) : undefined;

    if (start && end) return { startedAt: start, endedAt: end };
    if (start && durationMs !== undefined) {
      return { startedAt: start, endedAt: new Date(start.getTime() + durationMs) };
    }
    if (end && durationMs !== undefined) {
      return { startedAt: new Date(end.getTime() - durationMs), endedAt: end };
    }
    if (durationMs !== undefined) {
      const now = new Date();
      return { startedAt: new Date(now.getTime() - durationMs), endedAt: now };
    }
    throw new BadRequestException(
      'Provide startedAt+endedAt, startedAt+durationMinutes, endedAt+durationMinutes, or durationMinutes',
    );
  }

  private async assertNoOverlap(
    tx: WorkspaceTxClient,
    workspaceId: string,
    userId: string,
    startedAt: Date,
    endedAt: Date,
    excludeId: string | null,
  ) {
    if (this.allowOverlapping) return;
    const overlap = await tx.timeEntry.findFirst({
      where: {
        workspaceId,
        userId,
        id: excludeId ? { not: excludeId } : undefined,
        startedAt: { lt: endedAt },
        OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
      },
      select: { id: true },
    });
    if (overlap) {
      throw new BadRequestException(
        'This time range overlaps an existing entry. Set ALLOW_OVERLAPPING_ENTRIES=true to permit overlaps.',
      );
    }
  }

  private async assertProjectAccess(tx: WorkspaceTxClient, user: User, projectId: string) {
    const project = await tx.project.findFirst({
      where: { id: projectId, ...buildVisibilityFilter(user) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found or no access');
  }

  private emit(event: string, entry: TimeEntry) {
    this.events.emit(event, { projectId: entry.projectId, userId: entry.userId, timeEntry: entry });
  }
}
