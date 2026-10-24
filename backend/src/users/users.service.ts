import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, Prisma, UserRole, MembershipStatus, WorkspaceRole } from '@prisma/client';
import { MembershipService } from '../common/workspace/membership.service';
import * as bcrypt from 'bcrypt';

/**
 * The public shape of a user as returned by the REST /users surface.
 *
 * SECURITY: `password` (a bcrypt hash), `keycloakId` (the uchub `sub`, which is
 * also `memberships.userKey` — i.e. the value an attacker needs to forge or
 * target a membership row) and `forcePasswordChange` are NEVER serialized to
 * the users API. They remain available on the internal `User` entity for the
 * auth flows that legitimately need them.
 */
export type SafeUser = Omit<User, 'password' | 'keycloakId' | 'forcePasswordChange'> & {
  _count?: unknown;
};

/** Strip credential/identity-linkage fields from a user before serialization. */
export function toSafeUser<T extends Partial<User>>(user: T): SafeUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _p, keycloakId: _k, forcePasswordChange: _f, ...safe } = user as any;
  return safe as SafeUser;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  // ==========================================================
  // WORKSPACE SCOPING
  // ==========================================================
  //
  // The `users` table is deliberately NOT workspace-columned and carries no
  // RLS policy (it is shared identity, not tenant data). Tenancy for users is
  // therefore expressed through `memberships`: a user belongs to a workspace
  // iff an ACTIVE membership row exists whose `userKey` is that user's
  // keycloakId (uchub sub) or, for local non-SSO users, their local id.
  //
  // Every REST path that reads or mutates a user by id MUST first pass through
  // one of the helpers below. Without them, `prisma.user.findUnique({id})` is
  // an unscoped cross-tenant read — which is exactly the defect this fixes.

  /** ACTIVE membership keys (keycloakId or local id) for one workspace. */
  private async membershipKeys(workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId, status: MembershipStatus.ACTIVE },
      select: { userKey: true },
    });
    return rows.map((r) => r.userKey);
  }

  /**
   * A Prisma `where` fragment matching exactly the users who hold an ACTIVE
   * membership in `workspaceId`. Returns a never-matching predicate when the
   * workspace has no members, so a caller can never accidentally widen to "all
   * users" via an empty filter.
   */
  private async workspaceUserWhere(workspaceId: string): Promise<Prisma.UserWhereInput> {
    const keys = await this.membershipKeys(workspaceId);
    if (keys.length === 0) {
      // Impossible predicate: no members => no users visible.
      return { id: { in: [] } };
    }
    return { OR: [{ keycloakId: { in: keys } }, { id: { in: keys } }] };
  }

  /**
   * Assert that `userId` is a member of `workspaceId`, else 404.
   *
   * 404 (not 403) is deliberate: a caller outside the workspace must not be
   * able to distinguish "exists elsewhere" from "does not exist", which would
   * turn this into a cross-tenant user-enumeration oracle.
   */
  async assertInWorkspace(workspaceId: string, userId: string): Promise<User> {
    const scope = await this.workspaceUserWhere(workspaceId);
    const user = await this.prisma.user.findFirst({
      where: { AND: [{ id: userId }, scope] },
    });
    if (!user) {
      this.logger.warn(
        `Blocked out-of-workspace user access: user=${userId} workspace=${workspaceId}`,
      );
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    return user;
  }

  /** Workspace-scoped counterpart of findOne(). */
  async findOneInWorkspace(workspaceId: string, id: string): Promise<SafeUser> {
    const scope = await this.workspaceUserWhere(workspaceId);
    const user = await this.prisma.user.findFirst({
      where: { AND: [{ id }, scope] },
      include: {
        _count: {
          select: {
            createdProjects: true,
            assignedProjects: true,
            comments: true,
          },
        },
      },
    });

    if (!user) {
      this.logger.warn(`Blocked out-of-workspace user read: user=${id} workspace=${workspaceId}`);
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return toSafeUser(user);
  }

  /** Workspace-scoped counterpart of findAll(). */
  async findAllInWorkspace(
    workspaceId: string,
    params?: {
      skip?: number;
      take?: number;
      where?: Prisma.UserWhereInput;
      orderBy?: Prisma.UserOrderByWithRelationInput;
    },
  ): Promise<{ users: SafeUser[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};
    const scope = await this.workspaceUserWhere(workspaceId);
    const scopedWhere: Prisma.UserWhereInput = where ? { AND: [where, scope] } : scope;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ skip, take, where: scopedWhere, orderBy }),
      this.prisma.user.count({ where: scopedWhere }),
    ]);

    return { users: users.map(toSafeUser), total };
  }

  /**
   * Count of users holding an ACTIVE membership in `workspaceId`. Used by the
   * dashboard so `totalUsers` reflects the caller's tenant, not the instance.
   */
  async countInWorkspace(workspaceId: string): Promise<number> {
    const scope = await this.workspaceUserWhere(workspaceId);
    return this.prisma.user.count({ where: scope });
  }

  /**
   * Create a user AND seed their ACTIVE membership in the creating admin's
   * workspace. Without the membership the new user would be invisible to every
   * workspace-scoped read (including the list the admin just created them
   * from), so the two writes belong together.
   */
  async createInWorkspace(workspaceId: string, createUserDto: CreateUserDto): Promise<SafeUser> {
    const user = await this.create(createUserDto);
    const userKey = user.keycloakId ?? user.id;
    await this.prisma.membership.upsert({
      where: { userKey_workspaceId: { userKey, workspaceId } },
      update: { status: MembershipStatus.ACTIVE },
      create: {
        userKey,
        workspaceId,
        role: WorkspaceRole.MEMBER,
        status: MembershipStatus.ACTIVE,
        isDefault: true,
      },
    });
    this.logger.log(`Seeded membership for new user ${user.email} in workspace ${workspaceId}`);
    return toSafeUser(user);
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      // Hash password if provided
      const data: any = { ...createUserDto };
      if (data.password) {
        data.password = await bcrypt.hash(data.password, 10);
      }

      const user = await this.prisma.user.create({
        data,
      });

      this.logger.log(`User created: ${user.email}`);
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Email or username already exists');
        }
      }
      throw error;
    }
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<{ users: User[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take,
        where,
        orderBy,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            createdProjects: true,
            assignedProjects: true,
            comments: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  /** Public lookup; internal auth lookups above deliberately retain the full record. */
  async findPublicOne(id: string, caller: User, workspaceId: string) {
    return this.prisma.withWorkspace(
      workspaceId,
      MembershipService.membershipKey(caller),
      async (tx) => {
        const target = await tx.user.findUnique({ where: { id } });
        if (!target) throw new NotFoundException('User not found');
        if (caller.role !== UserRole.ADMIN && caller.id !== id) {
          const member = await tx.membership.findUnique({
            where: {
              userKey_workspaceId: {
                userKey: MembershipService.membershipKey(target),
                workspaceId,
              },
            },
          });
          if (!target.isActive || member?.status !== 'ACTIVE')
            throw new NotFoundException('User not found');
        }
        // Counts are scoped too: the identity table is global, its related work is not.
        return tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            forcePasswordChange: true,
            weeklyCapacityHours: true,
            _count: {
              select: {
                createdProjects: { where: { workspaceId } },
                assignedProjects: { where: { workspaceId } },
                comments: { where: { workspaceId } },
              },
            },
          },
        });
      },
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findByKeycloakId(keycloakId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { keycloakId },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: updateUserDto,
      });

      this.logger.log(`User updated: ${user.email}`);
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`User with ID ${id} not found`);
        }
        if (error.code === 'P2002') {
          throw new ConflictException('Email or username already exists');
        }
      }
      throw error;
    }
  }

  async remove(id: string): Promise<User> {
    try {
      const user = await this.prisma.user.delete({
        where: { id },
      });

      this.logger.log(`User deleted: ${user.email}`);
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`User with ID ${id} not found`);
        }
      }
      throw error;
    }
  }

  /**
   * Delete a user AND their membership row in the caller's workspace.
   *
   * `memberships` is keyed by (userKey, workspaceId) and has no FK to `users`
   * (userKey is the uchub sub, not a local id), so deleting the user alone
   * would strand the membership — and a later user with the same keycloakId
   * would silently inherit it. Both go, together.
   */
  async removeInWorkspace(workspaceId: string, id: string): Promise<User> {
    const target = await this.assertInWorkspace(workspaceId, id);
    const userKey = target.keycloakId ?? target.id;
    const user = await this.remove(id);
    await this.prisma.membership.deleteMany({ where: { userKey, workspaceId } });
    this.logger.log(`Deleted user ${user.email} and membership in workspace ${workspaceId}`);
    return user;
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async deactivate(id: string): Promise<User> {
    return this.update(id, { isActive: false });
  }

  async activate(id: string): Promise<User> {
    return this.update(id, { isActive: true });
  }
}
