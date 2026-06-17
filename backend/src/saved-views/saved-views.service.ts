import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';
import { SavedView, Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { MAX_SAVED_VIEW_CONFIG_BYTES, SavedViewScope } from './saved-views.constants';

/**
 * Saved-views service.
 *
 * SUITE TENANCY (Phase 2): every SavedView read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. All DB access goes through the
 * passed `tx`, never `this.prisma`, or it bypasses the GUC chokepoint. New rows
 * stamp `workspaceId` + `userId` (the acting user). The `workspaceId` is also
 * threaded into every `audit.log()` call. Additive + inert while
 * PROJECT_OPS_TENANCY_ENABLED is off (membership resolution is a no-op and
 * withWorkspace runs under the BYPASSRLS owner connection).
 *
 * Visibility model: because RLS fences every row to the active workspace, a
 * `shared = true` row is — by construction — owned by a member of THIS
 * workspace. So "my own views + others' shared views in the same workspace" is
 * just `WHERE scope = ? AND (userId = me OR shared = true)` inside the workspace
 * tx; no cross-workspace leakage is possible.
 *
 * Mutations (PATCH/DELETE) are owner-only: the row is loaded inside the tx and
 * 403s if `userId !== acting user` (and 404s if absent / not in this workspace).
 */
@Injectable()
export class SavedViewsService {
  private readonly logger = new Logger(SavedViewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Validate the `config` payload: it must be a plain JSON object (not an array
   * / primitive — class-validator's @IsObject lets arrays through) and its
   * serialized size must stay under the cap. Throws 400 on violation.
   */
  private validateConfig(config: unknown): Prisma.InputJsonObject {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new BadRequestException('config must be a JSON object');
    }

    // Byte length of the serialized payload (UTF-8), guarding against an
    // oversized preset. JSON.stringify also rejects circular structures.
    let serialized: string;
    try {
      serialized = JSON.stringify(config);
    } catch {
      throw new BadRequestException('config must be serializable JSON');
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SAVED_VIEW_CONFIG_BYTES) {
      throw new BadRequestException(
        `config exceeds the maximum size of ${MAX_SAVED_VIEW_CONFIG_BYTES} bytes`,
      );
    }

    return config as Prisma.InputJsonObject;
  }

  /**
   * Create a saved view for the acting user in the active workspace. Stamps
   * `userId` (the acting user) and `workspaceId`; `config` is validated first.
   */
  async create(workspaceId: string, user: User, dto: CreateSavedViewDto): Promise<SavedView> {
    const config = this.validateConfig(dto.config);

    const view = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.savedView.create({
          data: {
            workspaceId,
            userId: user.id,
            scope: dto.scope,
            name: dto.name,
            config,
            shared: dto.shared ?? false,
          },
        }),
      workspaceId,
    );

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      action: 'CREATE',
      resource: 'SavedView',
      resourceId: view.id,
      details: { scope: view.scope, name: view.name, shared: view.shared },
    });

    this.logger.log(`SavedView created scope=${view.scope} by user ${user.id} ws=${workspaceId}`);
    return view;
  }

  /**
   * List the views visible to the acting user for a scope: their own, plus any
   * `shared` views (which RLS guarantees belong to a member of this workspace).
   */
  async findAllForScope(
    workspaceId: string,
    user: User,
    scope: SavedViewScope,
  ): Promise<SavedView[]> {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.savedView.findMany({
          where: {
            scope,
            OR: [{ userId: user.id }, { shared: true }],
          },
          orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        }),
      workspaceId,
    );
  }

  /**
   * Load one saved view inside an existing workspace tx (RLS-scoped). Shared by
   * `update` and `remove` so the read + write run in ONE workspace transaction
   * (one membership authorization, one GUC scope). 404s if absent / not in this
   * workspace; 403s if the acting user is not the owner.
   */
  private async loadOwnedInTx(tx: WorkspaceTxClient, id: string, user: User): Promise<SavedView> {
    const view = await tx.savedView.findUnique({ where: { id } });

    if (!view) {
      throw new NotFoundException(`Saved view with ID ${id} not found`);
    }
    if (view.userId !== user.id) {
      throw new ForbiddenException('You do not have permission to modify this saved view');
    }
    return view;
  }

  /**
   * Update a saved view (name / config / shared). Owner-only. `config`, when
   * present, is validated (object + size cap) before the write.
   */
  async update(
    workspaceId: string,
    user: User,
    id: string,
    dto: UpdateSavedViewDto,
  ): Promise<SavedView> {
    const data: Prisma.SavedViewUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shared !== undefined) data.shared = dto.shared;
    if (dto.config !== undefined) data.config = this.validateConfig(dto.config);

    const view = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Existence + ownership check and update run in the SAME tx so both are
        // under the same RLS scope (no TOCTOU across two transactions).
        await this.loadOwnedInTx(tx, id, user);
        return tx.savedView.update({ where: { id }, data });
      },
      workspaceId,
    );

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      action: 'UPDATE',
      resource: 'SavedView',
      resourceId: id,
      details: {
        // Don't log the (potentially large) config blob; just which fields moved.
        fields: Object.keys(data),
      },
    });

    this.logger.log(`SavedView ${id} updated by user ${user.id} ws=${workspaceId}`);
    return view;
  }

  /** Delete a saved view. Owner-only. */
  async remove(workspaceId: string, user: User, id: string): Promise<SavedView> {
    const deleted = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        await this.loadOwnedInTx(tx, id, user);
        return tx.savedView.delete({ where: { id } });
      },
      workspaceId,
    );

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      action: 'DELETE',
      resource: 'SavedView',
      resourceId: id,
    });

    this.logger.log(`SavedView ${id} deleted by user ${user.id} ws=${workspaceId}`);
    return deleted;
  }
}
