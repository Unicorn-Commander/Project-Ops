import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsersService, toSafeUser } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { UserRole, User } from '@prisma/client';
import { AuthService } from '../auth/auth.service';

/**
 * User administration surface.
 *
 * TENANCY (fixes the cross-tenant user read/write defect): the global
 * `UserRole` enum on the users table has NO workspace dimension — an ADMIN of
 * tenant A and an ADMIN of tenant B are the same `role` value. `@Roles(...)`
 * alone therefore authorizes *a* role, never *which tenant's* records that role
 * may touch.
 *
 * Every route below that addresses a user by id resolves the caller's active
 * workspace (via the globally-applied WorkspaceMembershipGuard, surfaced by
 * `@CurrentWorkspace()`) and requires the TARGET to hold an ACTIVE membership
 * in that same workspace. Out-of-workspace targets 404 — never 403 — so this
 * endpoint cannot be used to enumerate the existence of other tenants' users.
 *
 * Responses are serialized through `toSafeUser`, which strips `password`,
 * `keycloakId` and `forcePasswordChange`.
 */
@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new user in the current workspace' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Email or username already exists' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @Body() createUserDto: CreateUserDto,
  ) {
    return this.usersService.createInWorkspace(workspaceId, createUserDto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get users in the current workspace with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'role', required: false, type: String, description: 'Single role or comma-separated roles (e.g., ADMIN,MANAGER,STAFF)' })
  @ApiResponse({ status: 200, description: 'Returns list of users in the caller workspace' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('role') role?: string,
  ) {
    // Parse pagination parameters
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const skip = (pageNum - 1) * limitNum;

    // Parse role parameter - support both single role and comma-separated roles
    let where: any = undefined;
    if (role) {
      const roles = role.split(',').map(r => r.trim()).filter(r => r);
      if (roles.length === 1) {
        where = { role: roles[0] as UserRole };
      } else if (roles.length > 1) {
        where = { role: { in: roles as UserRole[] } };
      }
    }

    const { users, total } = await this.usersService.findAllInWorkspace(workspaceId, {
      skip,
      take: limitNum,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: users,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF, UserRole.CLIENT)
  @ApiOperation({ summary: 'Get user by ID (must be in the caller workspace)' })
  @ApiResponse({ status: 200, description: 'Returns user details' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  findOne(@CurrentWorkspace() workspaceId: string, @Param('id') id: string) {
    return this.usersService.findOneInWorkspace(workspaceId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  async update(
    @CurrentWorkspace() workspaceId: string,
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    await this.usersService.assertInWorkspace(workspaceId, id);
    return toSafeUser(await this.usersService.update(id, updateUserDto));
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  async remove(
    @CurrentWorkspace() workspaceId: string,
    @Param('id') id: string,
  ) {
    await this.usersService.assertInWorkspace(workspaceId, id);
    return toSafeUser(await this.usersService.removeInWorkspace(workspaceId, id));
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate user' })
  @ApiResponse({ status: 200, description: 'User deactivated successfully' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  async deactivate(
    @CurrentWorkspace() workspaceId: string,
    @Param('id') id: string,
  ) {
    await this.usersService.assertInWorkspace(workspaceId, id);
    return toSafeUser(await this.usersService.deactivate(id));
  }

  @Patch(':id/activate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Activate user' })
  @ApiResponse({ status: 200, description: 'User activated successfully' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  async activate(
    @CurrentWorkspace() workspaceId: string,
    @Param('id') id: string,
  ) {
    await this.usersService.assertInWorkspace(workspaceId, id);
    return toSafeUser(await this.usersService.activate(id));
  }

  @Post(':id/reset-password')
  @Throttle({ short: { limit: 3, ttl: 3600000 } }) // 3 attempts per hour
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin resets user password' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 401, description: 'Only admins can reset passwords' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  @ApiResponse({ status: 429, description: 'Too many password reset attempts' })
  async resetPassword(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() admin: User,
    @Param('id') userId: string,
    @Body() body: { newPassword: string; forceChange?: boolean },
  ) {
    await this.usersService.assertInWorkspace(workspaceId, userId);
    return this.authService.resetUserPassword(
      admin.id,
      userId,
      body.newPassword,
      body.forceChange ?? true,
    );
  }

  @Patch(':id/force-password-change')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle force password change flag' })
  @ApiResponse({ status: 200, description: 'Force password change flag updated' })
  @ApiResponse({ status: 401, description: 'Only admins can manage password policies' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  async toggleForcePasswordChange(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() admin: User,
    @Param('id') userId: string,
    @Body() body: { force: boolean },
  ) {
    await this.usersService.assertInWorkspace(workspaceId, userId);
    return this.authService.toggleForcePasswordChange(admin.id, userId, body.force);
  }
}
