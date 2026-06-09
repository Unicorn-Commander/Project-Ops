import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { Organization, Prisma, User, UserRole } from '@prisma/client';

/**
 * Organizations are the operator's CLIENT records (an agency, business, etc.),
 * NOT the tenancy boundary — that is `workspaceId` (SUITE-IDENTITY §2). They
 * form a self-referential hierarchy (parentOrgId), so several reads recurse.
 *
 * SUITE TENANCY (Phase 2, B5): every read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. ALL org-owned DB access goes
 * through the passed `tx`, never `this.prisma`. The recursive helpers
 * (getChildrenRecursive / getDescendantIds / getAncestorIds /
 * validateNoCircularReference / getOrganizationTreeIds) take `tx` as their
 * first argument and thread it down every recursion level, so the whole
 * traversal stays inside the one workspace transaction (and one membership
 * authorization). Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off
 * (membership resolution is a no-op and withWorkspace runs under the BYPASSRLS
 * owner connection).
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
    return this.workspaceContext.runForUser(
      user,
      (tx) => this.findOneInTx(tx, id),
      workspaceId,
    );
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

  private async getChildrenRecursive(tx: WorkspaceTxClient, parentId: string): Promise<any[]> {
    const children = await tx.organization.findMany({
      where: { parentOrgId: parentId, isActive: true },
      include: {
        _count: {
          select: {
            childOrgs: true,
            contacts: true,
            projects: true,
          },
        },
      },
    });

    const childrenWithSubChildren = await Promise.all(
      children.map(async (child) => ({
        ...child,
        children: await this.getChildrenRecursive(tx, child.id),
      }))
    );

    return childrenWithSubChildren;
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
              orderBy: [
                { lastName: 'asc' },
              ],
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
          // Get all descendant organization IDs
          organizationIds = await this.getDescendantIds(tx, id);
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
        const [
          totalOrganizations,
          activeOrganizations,
          organizationsByType,
          withPortalAccess,
        ] = await Promise.all([
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
            `Portal access ${enabled ? 'enabled' : 'disabled'} for organization: ${organization.name} (${organization.id}) ws=${workspaceId}`
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

  // Helper method to get all organization IDs in a tree.
  // `tx` is threaded down every recursion level so the whole walk stays inside
  // the caller's workspace-scoped transaction.
  private async getOrganizationTreeIds(tx: WorkspaceTxClient, orgId: string): Promise<string[]> {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { id: true, parentOrgId: true },
    });

    if (!org) return [];

    const ids = [orgId];

    // Get parent tree
    if (org.parentOrgId) {
      const parentIds = await this.getOrganizationTreeIds(tx, org.parentOrgId);
      ids.push(...parentIds);
    }

    // Get children tree
    const childrenIds = await this.getDescendantIds(tx, orgId);
    ids.push(...childrenIds);

    return [...new Set(ids)]; // Remove duplicates
  }

  // Helper method to get all descendant organization IDs
  private async getDescendantIds(tx: WorkspaceTxClient, parentId: string): Promise<string[]> {
    const children = await tx.organization.findMany({
      where: { parentOrgId: parentId },
      select: { id: true },
    });

    const ids = children.map(c => c.id);

    for (const child of children) {
      const childDescendants = await this.getDescendantIds(tx, child.id);
      ids.push(...childDescendants);
    }

    return ids;
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

  // Helper method to get all ancestor organization IDs
  private async getAncestorIds(tx: WorkspaceTxClient, orgId: string): Promise<string[]> {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { id: true, parentOrgId: true },
    });

    if (!org) return [];

    const ids = [orgId];

    if (org.parentOrgId) {
      const parentAncestors = await this.getAncestorIds(tx, org.parentOrgId);
      ids.push(...parentAncestors);
    }

    return ids;
  }
}
