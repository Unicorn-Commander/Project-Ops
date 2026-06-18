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
import { CustomFieldsService } from './custom-fields.service';
import { CreateCustomFieldDto } from './dto/create-custom-field.dto';
import { UpdateCustomFieldDto } from './dto/update-custom-field.dto';
import { ListCustomFieldsDto } from './dto/list-custom-fields.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { CustomFieldEntity, User } from '@prisma/client';

/**
 * Custom-field DEFINITIONS for tasks / projects (workspace-defined attributes).
 *
 * Suite tenancy (Phase 2): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 * Mirrors the saved-views/comments controllers' guard + parameter convention.
 */
@ApiTags('custom-fields')
@Controller('custom-fields')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  @Get()
  @ApiOperation({ summary: 'List custom-field definitions for an entity (ordered by position, label)' })
  @ApiQuery({ name: 'entity', required: true, enum: CustomFieldEntity })
  @ApiResponse({ status: 200, description: 'Returns the entity’s custom-field definitions' })
  findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: ListCustomFieldsDto,
  ) {
    return this.customFieldsService.findAllForEntity(workspaceId, user, query.entity);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom-field definition' })
  @ApiResponse({ status: 201, description: 'Custom field created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid key/options' })
  @ApiResponse({ status: 409, description: 'A field with this key already exists for the entity' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createCustomFieldDto: CreateCustomFieldDto,
  ) {
    return this.customFieldsService.create(workspaceId, user, createCustomFieldDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a custom-field definition (key + entity are immutable)' })
  @ApiResponse({ status: 200, description: 'Custom field updated successfully' })
  @ApiResponse({ status: 404, description: 'Custom field not found' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateCustomFieldDto: UpdateCustomFieldDto,
  ) {
    return this.customFieldsService.update(workspaceId, user, id, updateCustomFieldDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom-field definition' })
  @ApiResponse({ status: 200, description: 'Custom field deleted successfully' })
  @ApiResponse({ status: 404, description: 'Custom field not found' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.customFieldsService.remove(workspaceId, user, id);
  }
}
