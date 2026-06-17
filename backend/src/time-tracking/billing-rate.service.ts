import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { AuditService } from '../audit/audit.service';
import { decToNum } from './serialize';
import { CreateBillingRateDto } from './dto/create-billing-rate.dto';

/**
 * CRUD for BillingRate rows. Restricted to ADMIN/MANAGER at the controller
 * (rates carry internal cost). The resolver (RateResolverService) reads these
 * to price time entries.
 */
@Injectable()
export class BillingRateService {
  private readonly logger = new Logger(BillingRateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async create(workspaceId: string, user: User, dto: CreateBillingRateDto) {
    this.assertScopeColumns(dto);
    const rate = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const created = await tx.billingRate.create({
          data: {
            workspaceId,
            scopeType: dto.scopeType,
            userId: dto.userId ?? null,
            projectId: dto.projectId ?? null,
            contactId: dto.contactId ?? null,
            taskId: dto.taskId ?? null,
            organizationId: dto.organizationId ?? null,
            taskType: dto.taskType ?? null,
            role: dto.role ?? null,
            billRate: dto.billRate as any,
            costRate: dto.costRate !== undefined ? (dto.costRate as any) : null,
            currency: dto.currency ?? 'USD',
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            createdById: user.id,
          },
        });
        await this.audit.log({
          workspaceId,
          userId: user.id,
          action: 'CREATE',
          resource: 'BillingRate',
          resourceId: created.id,
          details: { scopeType: created.scopeType },
        });
        return created;
      },
      workspaceId,
    );
    this.logger.log(`create_billing_rate: user=${user.email} scope=${rate.scopeType} rate=${rate.id}`);
    return this.serialize(rate);
  }

  async findAll(
    workspaceId: string,
    user: User,
    filter?: { scopeType?: string; projectId?: string; userId?: string },
  ) {
    const where: Prisma.BillingRateWhereInput = { workspaceId };
    if (filter?.scopeType) where.scopeType = filter.scopeType as any;
    if (filter?.projectId) where.projectId = filter.projectId;
    if (filter?.userId) where.userId = filter.userId;

    const rates = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.billingRate.findMany({
          where,
          orderBy: [{ scopeType: 'asc' }, { effectiveFrom: 'desc' }],
        }),
      workspaceId,
    );
    return rates.map((r) => this.serialize(r));
  }

  async update(workspaceId: string, user: User, id: string, dto: Partial<CreateBillingRateDto>) {
    const rate = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const existing = await tx.billingRate.findFirst({ where: { id, workspaceId } });
        if (!existing) throw new NotFoundException(`Billing rate ${id} not found`);

        const updated = await tx.billingRate.update({
          where: { id },
          data: {
            billRate: dto.billRate !== undefined ? (dto.billRate as any) : undefined,
            costRate: dto.costRate !== undefined ? (dto.costRate as any) : undefined,
            currency: dto.currency ?? undefined,
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
            effectiveTo:
              dto.effectiveTo !== undefined ? (dto.effectiveTo ? new Date(dto.effectiveTo) : null) : undefined,
          },
        });
        await this.audit.log({
          workspaceId,
          userId: user.id,
          action: 'UPDATE',
          resource: 'BillingRate',
          resourceId: updated.id,
        });
        return updated;
      },
      workspaceId,
    );
    return this.serialize(rate);
  }

  async remove(workspaceId: string, user: User, id: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const existing = await tx.billingRate.findFirst({ where: { id, workspaceId } });
        if (!existing) throw new NotFoundException(`Billing rate ${id} not found`);
        await tx.billingRate.delete({ where: { id } });
        await this.audit.log({
          workspaceId,
          userId: user.id,
          action: 'DELETE',
          resource: 'BillingRate',
          resourceId: id,
        });
        return { message: 'Billing rate deleted' };
      },
      workspaceId,
    );
  }

  /** The scope-identifying columns; exactly one set distinguishes a non-ORG scope. */
  private static readonly SCOPE_COLUMNS: ReadonlyArray<keyof CreateBillingRateDto> = [
    'taskId',
    'taskType',
    'projectId',
    'contactId',
    'userId',
    'role',
    'organizationId',
  ];

  private static isSet(v: unknown): boolean {
    return v !== undefined && v !== null && v !== '';
  }

  /**
   * Validate that the scope column required by scopeType is present.
   *
   * ORG is special: it has TWO legitimate forms that the resolver ranks
   * differently (RateResolverService.rowRank) —
   *   • org-specific  (organizationId set)  → applies only to that org's projects;
   *   • workspace-wide default (organizationId null) → the lowest-precedence
   *     fallback applied to ANY project with no more-specific rate.
   * Previously ORG skipped validation entirely, so an ORG row created WITHOUT an
   * organizationId silently became a workspace-wide default that re-priced every
   * project — a silent over/under-charge when the author actually intended an
   * org-specific rate. We can't tell those apart after the fact, so make the
   * intent explicit: a workspace-wide default must carry NO other scope column
   * (the resolver matches an ORG row only on organizationId and would silently
   * ignore a stray userId/projectId/etc., mis-scoping the rate).
   */
  private assertScopeColumns(dto: CreateBillingRateDto) {
    const need: Record<string, keyof CreateBillingRateDto> = {
      TASK: 'taskId',
      TASK_TYPE: 'taskType',
      PROJECT: 'projectId',
      CONTACT: 'contactId',
      USER: 'userId',
      ROLE: 'role',
      ORG: 'organizationId',
    };
    if (dto.scopeType === 'USER_PROJECT') {
      if (!dto.userId || !dto.projectId) {
        throw new BadRequestException('USER_PROJECT rate requires both userId and projectId');
      }
      return;
    }

    if (dto.scopeType === 'ORG') {
      const hasOrg = BillingRateService.isSet(dto.organizationId);
      if (hasOrg) return; // org-specific rate — valid.
      // No organizationId → this is the explicit workspace-wide default. It must
      // not carry any other scope column, or it would be silently mis-scoped.
      const stray = BillingRateService.SCOPE_COLUMNS.filter(
        (c) => c !== 'organizationId' && BillingRateService.isSet(dto[c]),
      );
      if (stray.length > 0) {
        throw new BadRequestException(
          `ORG rate without an organizationId is the workspace-wide default and must not set ${stray.join(', ')}; ` +
            'set organizationId for an org-specific rate.',
        );
      }
      return;
    }

    const col = need[dto.scopeType];
    if (col && !BillingRateService.isSet(dto[col])) {
      throw new BadRequestException(`${dto.scopeType} rate requires ${col}`);
    }
  }

  private serialize(rate: any) {
    return {
      ...rate,
      billRate: decToNum(rate.billRate),
      costRate: decToNum(rate.costRate),
    };
  }
}
