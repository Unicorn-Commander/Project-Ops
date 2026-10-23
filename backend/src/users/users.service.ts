import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, Prisma, UserRole } from '@prisma/client';
import { MembershipService } from '../common/workspace/membership.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

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
        // GET /users/:id is restricted to ADMIN/MANAGER. Retain this check for
        // any non-ADMIN internal callers; STAFF/CLIENT cannot reach it over HTTP.
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
