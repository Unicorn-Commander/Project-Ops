import { Injectable, NotFoundException, BadRequestException, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { Organization, Prisma, UserRole, OrgType } from '@prisma/client';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private prisma: PrismaService) {}

  async create(createOrganizationDto: CreateOrganizationDto, userId: string): Promise<Organization> {
    const { parentOrgId, ...data } = createOrganizationDto;

    // Validate parent organization exists
    if (parentOrgId) {
      const parentOrg = await this.prisma.organization.findUnique({
        where: { id: parentOrgId },
      });

      if (!parentOrg) {
        throw new NotFoundException(`Parent organization with ID ${parentOrgId} not found`);
      }

      // Prevent circular references by checking if parentOrgId is in the ancestry
      await this.validateNoCircularReference(parentOrgId, null);
    }

    try {
      const organization = await this.prisma.organization.create({
        data: {
          ...data,
          parentOrgId,
          createdById: userId,
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

      this.logger.log(`Organization created: ${organization.name} (${organization.id})`);
      return organization;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException('Organization with this information already exists');
        }
      }
      throw error;
    }
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.OrganizationWhereInput;
    orderBy?: Prisma.OrganizationOrderByWithRelationInput;
    userRole?: UserRole;
    userId?: string;
  }): Promise<{ organizations: Organization[]; total: number }> {
    const { skip, take, where = {}, orderBy, userRole, userId } = params || {};

    // Build where clause based on role
    let finalWhere = { ...where };

    // CLIENT role: Only see their organization tree
    if (userRole === UserRole.CLIENT) {
      const userContact = await this.prisma.contact.findFirst({
        where: { userId },
        select: { organizationId: true },
      });

      if (userContact?.organizationId) {
        // Get all organizations in the tree (parent and children)
        const orgTree = await this.getOrganizationTreeIds(userContact.organizationId);
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
      this.prisma.organization.findMany({
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
              cases: true,
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
      this.prisma.organization.count({ where: finalWhere }),
    ]);

    return { organizations, total };
  }

  async findOne(id: string): Promise<Organization> {
    const organization = await this.prisma.organization.findUnique({
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
            cases: true,
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

  async update(id: string, updateOrganizationDto: UpdateOrganizationDto): Promise<Organization> {
    const { parentOrgId, ...data } = updateOrganizationDto;

    // If updating parent, validate
    if (parentOrgId !== undefined) {
      if (parentOrgId) {
        const parentOrg = await this.prisma.organization.findUnique({
          where: { id: parentOrgId },
        });

        if (!parentOrg) {
          throw new NotFoundException(`Parent organization with ID ${parentOrgId} not found`);
        }

        // Prevent circular references
        await this.validateNoCircularReference(parentOrgId, id);
      }
    }

    try {
      const organization = await this.prisma.organization.update({
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

      this.logger.log(`Organization updated: ${organization.name} (${organization.id})`);
      return organization;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`Organization with ID ${id} not found`);
        }
      }
      throw error;
    }
  }

  async remove(id: string): Promise<Organization> {
    try {
      // Soft delete by setting isActive to false
      const organization = await this.prisma.organization.update({
        where: { id },
        data: { isActive: false },
      });

      this.logger.log(`Organization soft deleted: ${organization.name} (${organization.id})`);
      return organization;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`Organization with ID ${id} not found`);
        }
      }
      throw error;
    }
  }

  async getHierarchy(id: string): Promise<any> {
    const organization = await this.findOne(id);

    // Recursively get child organizations
    const children = await this.getChildrenRecursive(id);

    return {
      ...organization,
      hierarchy: children,
    };
  }

  private async getChildrenRecursive(parentId: string): Promise<any[]> {
    const children = await this.prisma.organization.findMany({
      where: { parentOrgId: parentId, isActive: true },
      include: {
        _count: {
          select: {
            childOrgs: true,
            contacts: true,
            cases: true,
          },
        },
      },
    });

    const childrenWithSubChildren = await Promise.all(
      children.map(async (child) => ({
        ...child,
        children: await this.getChildrenRecursive(child.id),
      }))
    );

    return childrenWithSubChildren;
  }

  async getContacts(id: string): Promise<any> {
    const organization = await this.prisma.organization.findUnique({
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
  }

  async getProjects(id: string, includeChildren: boolean = false): Promise<any> {
    let organizationIds = [id];

    if (includeChildren) {
      // Get all descendant organization IDs
      organizationIds = await this.getDescendantIds(id);
    }

    const projects = await this.prisma.project.findMany({
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
  }

  async getStats(): Promise<any> {
    const [
      totalOrganizations,
      activeOrganizations,
      organizationsByType,
      withPortalAccess,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { isActive: true } }),
      this.prisma.organization.groupBy({
        by: ['type'],
        _count: true,
        where: { isActive: true },
      }),
      this.prisma.organization.count({
        where: { portalAccessEnabled: true, isActive: true },
      }),
    ]);

    return {
      totalOrganizations,
      activeOrganizations,
      organizationsByType: organizationsByType.map(item => ({
        type: item.type,
        count: item._count,
      })),
      withPortalAccess,
    };
  }

  async togglePortalAccess(id: string, enabled: boolean): Promise<Organization> {
    try {
      const organization = await this.prisma.organization.update({
        where: { id },
        data: { portalAccessEnabled: enabled },
      });

      this.logger.log(
        `Portal access ${enabled ? 'enabled' : 'disabled'} for organization: ${organization.name} (${organization.id})`
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
  }

  // Helper method to get all organization IDs in a tree
  private async getOrganizationTreeIds(orgId: string): Promise<string[]> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, parentOrgId: true },
    });

    if (!org) return [];

    const ids = [orgId];

    // Get parent tree
    if (org.parentOrgId) {
      const parentIds = await this.getOrganizationTreeIds(org.parentOrgId);
      ids.push(...parentIds);
    }

    // Get children tree
    const childrenIds = await this.getDescendantIds(orgId);
    ids.push(...childrenIds);

    return [...new Set(ids)]; // Remove duplicates
  }

  // Helper method to get all descendant organization IDs
  private async getDescendantIds(parentId: string): Promise<string[]> {
    const children = await this.prisma.organization.findMany({
      where: { parentOrgId: parentId },
      select: { id: true },
    });

    const ids = children.map(c => c.id);

    for (const child of children) {
      const childDescendants = await this.getDescendantIds(child.id);
      ids.push(...childDescendants);
    }

    return ids;
  }

  // Helper method to validate no circular references
  private async validateNoCircularReference(parentId: string, currentId: string | null): Promise<void> {
    const ancestors = await this.getAncestorIds(parentId);

    if (currentId && ancestors.includes(currentId)) {
      throw new BadRequestException('Circular reference detected: Cannot set parent organization');
    }
  }

  // Helper method to get all ancestor organization IDs
  private async getAncestorIds(orgId: string): Promise<string[]> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, parentOrgId: true },
    });

    if (!org) return [];

    const ids = [orgId];

    if (org.parentOrgId) {
      const parentAncestors = await this.getAncestorIds(org.parentOrgId);
      ids.push(...parentAncestors);
    }

    return ids;
  }
}
