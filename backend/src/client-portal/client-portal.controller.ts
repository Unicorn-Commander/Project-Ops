import {
  Controller,
  Get,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClientPortalService } from './client-portal.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { User, UserRole } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, G3): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 * The existing CLIENT-role gate (verifyClientRole) is preserved on top.
 */
@ApiTags('client-portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('client-portal')
export class ClientPortalController {
  constructor(private readonly clientPortalService: ClientPortalService) {}

  private verifyClientRole(user: User) {
    if (user.role !== UserRole.CLIENT) {
      throw new ForbiddenException('This endpoint is only accessible to clients');
    }
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get client dashboard data' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getDashboard(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    this.verifyClientRole(user);
    return this.clientPortalService.getDashboard(workspaceId, user);
  }

  @Get('projects')
  @ApiOperation({ summary: 'Get all projects for the client' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getProjects(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    this.verifyClientRole(user);
    return this.clientPortalService.getProjects(workspaceId, user);
  }

  @Get('projects/:id')
  @ApiOperation({ summary: 'Get specific project details' })
  @ApiResponse({ status: 200, description: 'Project details' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client or project owner' })
  @ApiResponse({ status: 404, description: 'Project or client profile not found' })
  getProjectDetails(
    @Param('id') id: string,
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    this.verifyClientRole(user);
    return this.clientPortalService.getProjectDetails(workspaceId, user, id);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Get all documents for the client' })
  @ApiResponse({ status: 200, description: 'List of documents' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getDocuments(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    this.verifyClientRole(user);
    return this.clientPortalService.getDocuments(workspaceId, user);
  }
}
