import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { Organization, Prisma, User, UserRole } from '@prisma/client';

/**
 * Hard cap on hierarchy recursion depth. Org trees are shallow in practice
 * (agency → sub-agency → client); this bounds every `WITH RECURSIVE` walk so a
 * data cycle or pathological tree can never run away. `parentOrgId` is FK-cycle
 * resistant (create/update reject circular references), so this is defense in
 * depth, not the primary cycle guard.
 */
const MAX_HIERARCHY_DEPTH = 50;

/**
 * A flat row from the descendant-subtree `WITH RECURSIVE` query: every
 * Organization scalar column, plus the per-node aggregate counts (aliased so
 * they don't collide with the `childOrgs`/`contacts`/`projects` relations) and
 * the traversal `depth`. `buildTree` folds these into the nested shape.
 */
type OrgTreeRow = Organization & {
  depth: number;
  childOrgsCount: number;
  contactsCount: number;
  projectsCount: number;
};

/**
 * Organizations are the operator's CLIENT records (an agency, business, etc.),
 * NOT the tenancy boundary — that is `workspaceId` (SUITE-IDENTITY §2). They
 * form a self-referential hierarchy (parentOrgId), so several reads walk the
 * tree.
 *
 * SUITE TENANCY (Phase 2, B5): every read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. ALL org-owned DB access goes
 * through the passed `tx`, never `this.prisma`. The hierarchy helpers
 * (getChildrenRecursive / getDescendantIds / getAncestorIds /
 * getOrganizationTreeIds) take `tx` as their first argument and resolve the
 * whole tree in a SINGLE `WITH RECURSIVE` query (no per-level N+1). Because the
 * raw query executes on that same `tx`, it shares the transaction's
 * `app.current_workspace` GUC and is RLS-fenced exactly like the ORM calls —
 * tenancy never escapes. Additive + inert while PROJECT_OPS_TENANCY_ENABLED is
 * off (membership resolution is a no-op and withWorkspace runs under the
 * BYPASSRLS owner connection).
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async create(
    workspaceId: string,
    user: User,
    createOrganizationDto: CreateOrganizationDto,
  ): Promise<Organization> {
    const { parentOrgId, ...data } = createOrganizationDto;

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Validate parent organization exists
        if (parentOrgId) {
          const parentOrg = await tx.organization.findUnique({
            where: { id: parentOrgId },
          });

          if (!parentOrg) {
            throw new NotFoundException(`Parent organization with ID ${parentOrgId} not found`);
          }

          // Prevent circular references by checking if parentOrgId is in the ancestry
          await this.validateNoCircularReference(tx, parentOrgId, null);
        }

        try {
          const organization = await tx.organization.create({
            data: {
              ...data,
              workspaceId,
              parentOrgId,
              createdById: user.id,
            },
            include: {
              parentOrg: true,
              createdBy: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          });

          this.logger.log(
            `Organization created: ${organization.name} (${organization.id}) ws=${workspaceId}`,
          );
          return organization;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
              throw new BadRequestException('Organization with this information already exists');
            }
          }
          throw error;
        }
      },
      workspaceId,
    );
  }

  async findAll(
    workspaceId: string,
    user: User,
    params?: {
      skip?: number;
      take?: number;
      where?: Prisma.OrganizationWhereInput;
      orderBy?: Prisma.OrganizationOrderByWithRelationInput;
      userRole?: UserRole;
      userId?: string;
    },
  ): Promise<{ organizations: Organization[]; total: number }> {
    const { skip, take, where = {}, orderBy, userRole, userId } = params || {};

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Build where clause based on role
        let finalWhere = { ...where };

        // CLIENT role: Only see their organization tree
        if (userRole === UserRole.CLIENT) {
          const userContact = await tx.contact.findFirst({
            where: { userId },
            select: { organizationId: true },
          });

          if (userContact?.organizationId) {
            // Get all organizations in the tree (parent and children)
            const orgTree = await this.getOrganizationTreeIds(tx, userContact.organizationId);
            finalWhere = {
              ...finalWhere,
              id: { in: orgTree },
            };
          } else {
            // No organization access - return empty
            return { organizations: [], total: 0 };
          }
        }

        const [organizations, total] = await Promise.all([
          tx.organization.findMany({
            skip,
            take,
            where: finalWhere,
            orderBy,
            include: {
              parentOrg: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                },
              },
              _count: {
                select: {
                  childOrgs: true,
                  contacts: true,
                  projects: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          }),
          tx.organization.count({ where: finalWhere }),
        ]);

        return { organizations, total };
      },
      workspaceId,
    );
  }

  async findOne(workspaceId: string, user: User, id: string): Promise<Organization> {
    return this.workspaceContext.runForUser(user, (tx) => this.findOneInTx(tx, id), workspaceId);
  }

  /**
   * Load one organization with its full detail include, inside an existing
   * workspace tx. Shared by `findOne` and `getHierarchy` so the latter runs the
   * detail read + the recursive child walk in ONE workspace-scoped transaction
   * (and one membership authorization).
   */
  private async findOneInTx(tx: WorkspaceTxClient, id: string): Promise<Organization> {
    const organization = await tx.organization.findUnique({
      where: { id },
      include: {
        parentOrg: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        childOrgs: {
          select: {
            id: true,
            name: true,
            type: true,
            isActive: true,
          },
        },
        contacts: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isActive: true,
          },
          where: { isActive: true },
          orderBy: { lastName: 'asc' },
        },
        primaryContact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            contacts: true,
            projects: true,
            childOrgs: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    return organization;
  }

  async update(
    workspaceId: string,
    user: User,
    id: string,
    updateOrganizationDto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const { parentOrgId, ...data } = updateOrganizationDto;

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // If updating parent, validate
        if (parentOrgId !== undefined) {
          if (parentOrgId) {
            const parentOrg = await tx.organization.findUnique({
              where: { id: parentOrgId },
            });

            if (!parentOrg) {
              throw new NotFoundException(`Parent organization with ID ${parentOrgId} not found`);
            }

            // Prevent circular references
            await this.validateNoCircularReference(tx, parentOrgId, id);
          }
        }

        try {
          const organization = await tx.organization.update({
            where: { id },
            data: {
              ...data,
              ...(parentOrgId !== undefined && { parentOrgId }),
            },
            include: {
              parentOrg: true,
              createdBy: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          });

          this.logger.log(
            `Organization updated: ${organization.name} (${organization.id}) ws=${workspaceId}`,
          );
          return organization;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
              throw new NotFoundException(`Organization with ID ${id} not found`);
            }
          }
          throw error;
        }
      },
      workspaceId,
    );
  }

  async remove(workspaceId: string, user: User, id: string): Promise<Organization> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        try {
          // Soft delete by setting isActive to false
          const organization = await tx.organization.update({
            where: { id },
            data: { isActive: false },
          });

          this.logger.log(
            `Organization soft deleted: ${organization.name} (${organization.id}) ws=${workspaceId}`,
          );
          return organization;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
              throw new NotFoundException(`Organization with ID ${id} not found`);
            }
          }
          throw error;
        }
      },
      workspaceId,
    );
  }

  async getHierarchy(workspaceId: string, user: User, id: string): Promise<any> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const organization = await this.findOneInTx(tx, id);

        // Recursively get child organizations
        const children = await this.getChildrenRecursive(tx, id);

        return {
          ...organization,
          hierarchy: children,
        };
      },
      workspaceId,
    );
  }

  /**
   * Full active-descendant subtree of `parentId`, shaped identically to the old
   * per-level recursion: each node is the complete Organization row plus
   * `_count: { childOrgs, contacts, projects }` and a nested `children[]`.
   *
   * N+1 FIX: the previous implementation issued one `findMany` per tree level
   * (15+ sequential round-trips on a deep tree). This now fetches the whole
   * subtree in a SINGLE `WITH RECURSIVE` query and assembles the nesting in
   * memory. The raw query runs through the caller's workspace `tx`, so it shares
   * the same transaction + `app.current_workspace` GUC the ORM uses and stays
   * inside RLS (the recursion is additionally fenced to `isActive` rows, exactly
   * as before). Bounded by MAX_HIERARCHY_DEPTH so a cycle or pathological tree
   * can never run away.
   */
  private async getChildrenRecursive(tx: WorkspaceTxClient, parentId: string): Promise<any[]> {
    const rows = await tx.$queryRaw<OrgTreeRow[]>(Prisma.sql`
      WITH RECURSIVE subtree AS (
        SELECT o.*, 1 AS depth
          FROM "organizations" o
         WHERE o."parentOrgId" = ${parentId}
           AND o."isActive" = true
        UNION ALL
        SELECT o.*, s.depth + 1 AS depth
          FROM "organizations" o
          JOIN subtree s ON o."parentOrgId" = s."id"
         WHERE o."isActive" = true
           AND s.depth < ${MAX_HIERARCHY_DEPTH}
      )
      SELECT s.*,
             (SELECT COUNT(*)::int FROM "organizations" c WHERE c."parentOrgId" = s."id") AS "childOrgsCount",
             (SELECT COUNT(*)::int FROM "contacts"      c WHERE c."organizationId" = s."id") AS "contactsCount",
             (SELECT COUNT(*)::int FROM "projects"      p WHERE p."organizationId" = s."id") AS "projectsCount"
        FROM subtree s
       ORDER BY s.depth ASC
    `);

    return this.buildTree(rows, parentId);
  }

  /**
   * Assemble flat `WITH RECURSIVE` rows into the nested tree shape callers
   * expect. Strips the helper columns (`depth`, the `*Count` aliases), folds the
   * counts into `_count`, and attaches a `children[]` array to every node.
   */
  private buildTree(rows: OrgTreeRow[], rootParentId: string): any[] {
    const byParent = new Map<string, any[]>();

    for (const row of rows) {
      const { depth, childOrgsCount, contactsCount, projectsCount, ...org } = row;
      void depth;
      const node = {
        ...org,
        _count: {
          childOrgs: childOrgsCount,
          contacts: contactsCount,
          projects: projectsCount,
        },
        children: [] as any[],
      };
      const bucket = byParent.get(row.parentOrgId ?? '') ?? [];
      bucket.push(node);
      byParent.set(row.parentOrgId ?? '', bucket);
    }

    // Link each node's children, then return the roots (direct children of the
    // requested org). A node missing from `byParent` simply has no children.
    for (const bucket of byParent.values()) {
      for (const node of bucket) {
        node.children = byParent.get(node.id) ?? [];
      }
    }

    return byParent.get(rootParentId) ?? [];
  }

  async getContacts(workspaceId: string, user: User, id: string): Promise<any> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const organization = await tx.organization.findUnique({
          where: { id },
          include: {
            contacts: {
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    isActive: true,
                  },
                },
              },
              orderBy: [{ lastName: 'asc' }],
            },
          },
        });

        if (!organization) {
          throw new NotFoundException(`Organization with ID ${id} not found`);
        }

        return organization.contacts;
      },
      workspaceId,
    );
  }

  async getProjects(
    workspaceId: string,
    user: User,
    id: string,
    includeChildren: boolean = false,
  ): Promise<any> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        let organizationIds = [id];

        if (includeChildren) {
          // The org's OWN projects PLUS all descendant orgs' projects.
          // (getDescendantIds returns descendants only, so include `id`.)
          organizationIds = [id, ...(await this.getDescendantIds(tx, id))];
        }

        const projects = await tx.project.findMany({
          where: {
            organizationId: { in: organizationIds },
          },
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
            assignedTo: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
            _count: {
              select: {
                documents: true,
                comments: true,
                tasks: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        return projects;
      },
      workspaceId,
    );
  }

  async getStats(workspaceId: string, user: User): Promise<any> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [totalOrganizations, activeOrganizations, organizationsByType, withPortalAccess] =
          await Promise.all([
            tx.organization.count(),
            tx.organization.count({ where: { isActive: true } }),
            tx.organization.groupBy({
              by: ['type'],
              _count: true,
              where: { isActive: true },
            }),
            tx.organization.count({
              where: { portalAccessEnabled: true, isActive: true },
            }),
          ]);

        const byType = organizationsByType.reduce(
          (acc, item) => {
            const key = item.type.toLowerCase() as 'agency' | 'business' | 'individual' | 'partner';
            acc[key] = item._count;
            return acc;
          },
          { agency: 0, business: 0, individual: 0, partner: 0 } as Record<
            'agency' | 'business' | 'individual' | 'partner',
            number
          >,
        );

        const totalContacts = await tx.contact.count({
          where: { organizationId: { not: null } },
        });

        return {
          total: totalOrganizations,
          active: activeOrganizations,
          byType,
          withPortalAccess,
          totalContacts,
        };
      },
      workspaceId,
    );
  }

  async togglePortalAccess(
    workspaceId: string,
    user: User,
    id: string,
    enabled: boolean,
  ): Promise<Organization> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        try {
          const organization = await tx.organization.update({
            where: { id },
            data: { portalAccessEnabled: enabled },
          });

          this.logger.log(
            `Portal access ${enabled ? 'enabled' : 'disabled'} for organization: ${organization.name} (${organization.id}) ws=${workspaceId}`,
          );
          return organization;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
              throw new NotFoundException(`Organization with ID ${id} not found`);
            }
          }
          throw error;
        }
      },
      workspaceId,
    );
  }

  // Helper method to get every organization id in `orgId`'s connected tree
  // (the full tree rooted at orgId's topmost ancestor — used for CLIENT
  // visibility, which spans the whole org family, not just one branch).
  //
  // N+1 FIX: the old version recursed the parent chain AND re-walked each
  // ancestor's descendants one level per query. The union it produced is
  // exactly {root} ∪ {all descendants of root}, so we now resolve the root via
  // ONE ancestor CTE and pull the whole subtree via ONE descendant CTE — two
  // queries total (was O(nodes)), both through the caller's workspace `tx`
  // (RLS-scoped). Returns `[]` for a non-existent org, as before.
  private async getOrganizationTreeIds(tx: WorkspaceTxClient, orgId: string): Promise<string[]> {
    // ancestors = [orgId, parent, ..., root]; the root is the last element.
    const ancestors = await this.getAncestorIds(tx, orgId);
    if (ancestors.length === 0) return [];

    const rootId = ancestors[ancestors.length - 1];
    const descendantsOfRoot = await this.getDescendantIds(tx, rootId);

    return [...new Set([rootId, ...descendantsOfRoot])];
  }

  // Helper method to get all descendant organization IDs.
  //
  // N+1 FIX: single `WITH RECURSIVE` walk (was one query per level) through the
  // caller's workspace `tx` (same transaction + GUC => RLS-scoped). Returns the
  // descendant ids only (the start node is excluded, as before). The root is
  // NOT seeded into the CTE so its own id never appears. Depth-capped.
  private async getDescendantIds(tx: WorkspaceTxClient, parentId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE descendants AS (
        SELECT o."id", o."parentOrgId", 1 AS depth
          FROM "organizations" o
         WHERE o."parentOrgId" = ${parentId}
        UNION ALL
        SELECT o."id", o."parentOrgId", d.depth + 1 AS depth
          FROM "organizations" o
          JOIN descendants d ON o."parentOrgId" = d."id"
         WHERE d.depth < ${MAX_HIERARCHY_DEPTH}
      )
      SELECT "id" FROM descendants
    `);

    return rows.map((r) => r.id);
  }

  // Helper method to validate no circular references
  private async validateNoCircularReference(
    tx: WorkspaceTxClient,
    parentId: string,
    currentId: string | null,
  ): Promise<void> {
    const ancestors = await this.getAncestorIds(tx, parentId);

    if (currentId && ancestors.includes(currentId)) {
      throw new BadRequestException('Circular reference detected: Cannot set parent organization');
    }
  }

  // Helper method to get all ancestor organization IDs (self included, then
  // each parent walking up — matching the prior return shape and order).
  //
  // N+1 FIX: single `WITH RECURSIVE` walk up the `parentOrgId` chain (was one
  // query per level) through the caller's workspace `tx` (RLS-scoped). Returns
  // `[]` when the start org does not exist, exactly as before. Depth-capped.
  private async getAncestorIds(tx: WorkspaceTxClient, orgId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT o."id", o."parentOrgId", 0 AS depth
          FROM "organizations" o
         WHERE o."id" = ${orgId}
        UNION ALL
        SELECT o."id", o."parentOrgId", a.depth + 1 AS depth
          FROM "organizations" o
          JOIN ancestors a ON o."id" = a."parentOrgId"
         WHERE a.depth < ${MAX_HIERARCHY_DEPTH}
      )
      SELECT "id" FROM ancestors ORDER BY depth ASC
    `);

    return rows.map((r) => r.id);
  }
}
