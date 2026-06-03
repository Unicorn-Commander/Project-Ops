import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  async create(workspaceId: string, user: User, dto: CreateBillingRateDto) {
    this.assertScopeColumns(dto);
    const rate = await this.prisma.billingRate.create({
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
      userId: user.id,
      action: 'CREATE',
      resource: 'BillingRate',
      resourceId: rate.id,
      details: { scopeType: rate.scopeType },
    });
    this.logger.log(`create_billing_rate: user=${user.email} scope=${rate.scopeType} rate=${rate.id}`);
    return this.serialize(rate);
  }

  async findAll(workspaceId: string, filter?: { scopeType?: string; projectId?: string; userId?: string }) {
    const where: Prisma.BillingRateWhereInput = { workspaceId };
    if (filter?.scopeType) where.scopeType = filter.scopeType as any;
    if (filter?.projectId) where.projectId = filter.projectId;
    if (filter?.userId) where.userId = filter.userId;

    const rates = await this.prisma.billingRate.findMany({
      where,
      orderBy: [{ scopeType: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return rates.map((r) => this.serialize(r));
  }

  async update(workspaceId: string, user: User, id: string, dto: Partial<CreateBillingRateDto>) {
    const existing = await this.prisma.billingRate.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException(`Billing rate ${id} not found`);

    const rate = await this.prisma.billingRate.update({
      where: { id },
      data: {
        billRate: dto.billRate !== undefined ? (dto.billRate as any) : undefined,
        costRate: dto.costRate !== undefined ? (dto.costRate as any) : undefined,
        currency: dto.currency ?? undefined,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo !== undefined ? (dto.effectiveTo ? new Date(dto.effectiveTo) : null) : undefined,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      resource: 'BillingRate',
      resourceId: rate.id,
    });
    return this.serialize(rate);
  }

  async remove(workspaceId: string, user: User, id: string) {
    const existing = await this.prisma.billingRate.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException(`Billing rate ${id} not found`);
    await this.prisma.billingRate.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      resource: 'BillingRate',
      resourceId: id,
    });
    return { message: 'Billing rate deleted' };
  }

  /** Validate that the scope column required by scopeType is present. */
  private assertScopeColumns(dto: CreateBillingRateDto) {
    const need: Record<string, keyof CreateBillingRateDto> = {
      TASK: 'taskId',
      TASK_TYPE: 'taskType',
      PROJECT: 'projectId',
      CONTACT: 'contactId',
      USER: 'userId',
      ROLE: 'role',
      // ORG: organizationId optional (null = workspace-wide default)
    };
    if (dto.scopeType === 'USER_PROJECT') {
      if (!dto.userId || !dto.projectId) {
        throw new BadRequestException('USER_PROJECT rate requires both userId and projectId');
      }
      return;
    }
    const col = need[dto.scopeType];
    if (col && (dto[col] === undefined || dto[col] === null || dto[col] === '')) {
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
