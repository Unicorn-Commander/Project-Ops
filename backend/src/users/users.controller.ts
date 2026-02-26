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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, User } from '@prisma/client';
import { AuthService } from '../auth/auth.service';

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
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Email or username already exists' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all users with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'role', required: false, type: String, description: 'Single role or comma-separated roles (e.g., ADMIN,MANAGER,STAFF)' })
  @ApiResponse({ status: 200, description: 'Returns list of users' })
  async findAll(
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

    const { users, total } = await this.usersService.findAll({
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
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'Returns user details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate user' })
  @ApiResponse({ status: 200, description: 'User deactivated successfully' })
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }

  @Patch(':id/activate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Activate user' })
  @ApiResponse({ status: 200, description: 'User activated successfully' })
  activate(@Param('id') id: string) {
    return this.usersService.activate(id);
  }

  @Post(':id/reset-password')
  @Throttle({ short: { limit: 3, ttl: 3600000 } }) // 3 attempts per hour
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin resets user password' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 401, description: 'Only admins can reset passwords' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 429, description: 'Too many password reset attempts' })
  resetPassword(
    @CurrentUser() admin: User,
    @Param('id') userId: string,
    @Body() body: { newPassword: string; forceChange?: boolean },
  ) {
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
  @ApiResponse({ status: 404, description: 'User not found' })
  toggleForcePasswordChange(
    @CurrentUser() admin: User,
    @Param('id') userId: string,
    @Body() body: { force: boolean },
  ) {
    return this.authService.toggleForcePasswordChange(admin.id, userId, body.force);
  }
}