import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { QuotePanel, QuotePanelService } from '../customer-ops/quote-panel.service';
import { ProjectsService } from '../projects/projects.service';

/**
 * The staff Quote panel: `GET /api/v1/projects/:id/quote`.
 *
 * Same guard chain + workspace resolution as ProjectsController (the project is
 * loaded through ProjectsService.findOne inside the workspace RLS tx, so a
 * project from another workspace 404s). The Customer-Ops read-through runs
 * OUTSIDE the tx and degrades to the cached summary. A CLIENT hitting this
 * route (they normally use the portal) gets the masked view — defence in depth.
 */
@ApiTags('projects')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Controller('projects')
export class QuotePanelController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly panel: QuotePanelService,
  ) {}

  @Get(':id/quote')
  @ApiOperation({
    summary:
      'Quote panel for a project (read-through to Customer-Ops; cached summary when unavailable)',
  })
  @ApiResponse({
    status: 200,
    description: '{ linked:false } when the project did not come from a quote',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getProjectQuote(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<QuotePanel> {
    const project = await this.projects.findOne(workspaceId, user, id);
    const viewer = user.role === UserRole.CLIENT ? 'client' : 'staff';
    return this.panel.buildPanel({ id: project.id, metadata: project.metadata }, viewer, {
      workspaceId,
    });
  }
}
