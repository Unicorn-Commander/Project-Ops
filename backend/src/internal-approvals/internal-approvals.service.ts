import { ForbiddenException, Injectable, NotFoundException, ValidationPipe } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import {
  InternalApprovalBindingDto,
  ListInternalApprovalsDto,
  RecordInternalApprovalDto,
} from './dto/internal-approval.dto';

@Injectable()
export class InternalApprovalsService {
  // MCP and REST share validation, including rejection of caller-supplied identity fields.
  private readonly validation = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  constructor(private readonly workspace: WorkspaceContextService) {}

  private assertStaff(user: User) {
    if (![UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF].includes(user.role as any)) {
      throw new ForbiddenException('Internal approvals require a staff workspace member.');
    }
  }

  async record(workspaceId: string, user: User, input: RecordInternalApprovalDto) {
    this.assertStaff(user);
    await this.workspace.assertCanWrite(user, workspaceId);
    const dto: RecordInternalApprovalDto = await this.validation.transform(input, {
      type: 'body',
      metatype: RecordInternalApprovalDto,
    });
    return this.workspace.runForUser(
      user,
      async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: dto.projectId, workspaceId },
          select: { id: true },
        });
        if (!project) throw new NotFoundException('Project not found in this workspace.');
        if (dto.entity === 'task' || dto.entity === 'document') {
          const where = { id: dto.entityRef, projectId: dto.projectId, workspaceId };
          const entity =
            dto.entity === 'task'
              ? await tx.task.findFirst({ where, select: { id: true } })
              : await tx.document.findFirst({ where, select: { id: true } });
          if (!entity) throw new NotFoundException('Entity not found in this project.');
        }
        return tx.internalApproval.create({
          data: {
            workspaceId,
            projectId: dto.projectId,
            type: 'INTERNAL',
            entity: dto.entity,
            entityRef: dto.entityRef,
            versionHash: dto.versionHash,
            decision: dto.decision,
            reason: dto.reason,
            approverId: user.id,
          },
        });
      },
      workspaceId,
    );
  }

  async list(workspaceId: string, user: User, input: ListInternalApprovalsDto) {
    this.assertStaff(user);
    const dto: ListInternalApprovalsDto = await this.validation.transform(input, {
      type: 'query',
      metatype: ListInternalApprovalsDto,
    });
    return this.workspace.runForUser(
      user,
      (tx) =>
        tx.internalApproval.findMany({
          where: {
            workspaceId,
            projectId: dto.projectId,
            entity: dto.entity,
            entityRef: dto.entityRef,
            versionHash: dto.versionHash,
          },
          orderBy: { sequence: 'desc' },
          take: dto.limit ?? 50,
          skip: dto.offset ?? 0,
        }),
      workspaceId,
    );
  }

  async latest(workspaceId: string, user: User, input: InternalApprovalBindingDto) {
    this.assertStaff(user);
    const dto: InternalApprovalBindingDto = await this.validation.transform(input, {
      type: 'query',
      metatype: InternalApprovalBindingDto,
    });
    return this.workspace.runForUser(
      user,
      (tx) =>
        tx.internalApproval.findFirst({
          where: {
            workspaceId,
            projectId: dto.projectId,
            entity: dto.entity,
            entityRef: dto.entityRef,
            versionHash: dto.versionHash,
          },
          orderBy: { sequence: 'desc' },
        }),
      workspaceId,
    );
  }
}
