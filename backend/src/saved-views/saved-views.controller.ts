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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SavedViewsService } from './saved-views.service';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';
import { ListSavedViewsDto } from './dto/list-saved-views.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { User } from '@prisma/client';
import { SAVED_VIEW_SCOPES } from './saved-views.constants';

/**
 * Saved views: reusable per-surface list presets (filters / sort / columns).
 *
 * Suite tenancy (Phase 2): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 * Mirrors the projects/comments controllers' guard + parameter convention.
 */
@ApiTags('saved-views')
@Controller('saved-views')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class SavedViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List saved views for a scope: the current user’s own views plus others’ shared views in this workspace',
  })
  @ApiQuery({ name: 'scope', required: true, enum: SAVED_VIEW_SCOPES })
  @ApiResponse({ status: 200, description: 'Returns the visible saved views' })
  findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: ListSavedViewsDto,
  ) {
    return this.savedViewsService.findAllForScope(workspaceId, user, query.scope);
  }

  @Post()
  @ApiOperation({ summary: 'Create a saved view (owned by the current user)' })
  @ApiResponse({ status: 201, description: 'Saved view created successfully' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createSavedViewDto: CreateSavedViewDto,
  ) {
    return this.savedViewsService.create(workspaceId, user, createSavedViewDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a saved view (owner only)' })
  @ApiResponse({ status: 200, description: 'Saved view updated successfully' })
  @ApiResponse({ status: 403, description: 'Not the owner of this saved view' })
  @ApiResponse({ status: 404, description: 'Saved view not found' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateSavedViewDto: UpdateSavedViewDto,
  ) {
    return this.savedViewsService.update(workspaceId, user, id, updateSavedViewDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved view (owner only)' })
  @ApiResponse({ status: 200, description: 'Saved view deleted successfully' })
  @ApiResponse({ status: 403, description: 'Not the owner of this saved view' })
  @ApiResponse({ status: 404, description: 'Saved view not found' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.savedViewsService.remove(workspaceId, user, id);
  }
}
