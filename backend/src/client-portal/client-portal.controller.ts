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
import { User, UserRole } from '@prisma/client';

@ApiTags('client-portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
  getDashboard(@CurrentUser() user: User) {
    this.verifyClientRole(user);
    return this.clientPortalService.getDashboard(user.id);
  }

  @Get('projects')
  @ApiOperation({ summary: 'Get all projects for the client' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getProjects(@CurrentUser() user: User) {
    this.verifyClientRole(user);
    return this.clientPortalService.getProjects(user.id);
  }

  @Get('projects/:id')
  @ApiOperation({ summary: 'Get specific project details' })
  @ApiResponse({ status: 200, description: 'Project details' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client or project owner' })
  @ApiResponse({ status: 404, description: 'Project or client profile not found' })
  getProjectDetails(@Param('id') id: string, @CurrentUser() user: User) {
    this.verifyClientRole(user);
    return this.clientPortalService.getProjectDetails(user.id, id);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Get all documents for the client' })
  @ApiResponse({ status: 200, description: 'List of documents' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getDocuments(@CurrentUser() user: User) {
    this.verifyClientRole(user);
    return this.clientPortalService.getDocuments(user.id);
  }
}
