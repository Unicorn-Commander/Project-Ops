import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Outbound webhook administration.
 *
 * Suite tenancy: every route resolves the active workspace via @CurrentWorkspace
 * + the (also-global) WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 *
 * Authorization: webhooks expose workspace-wide event traffic to an external
 * URL, so management is restricted to ADMIN/MANAGER (STAFF/CLIENT cannot
 * register a sink for other people's activity).
 */
@ApiTags('webhooks')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints (secrets masked)' })
  @ApiResponse({ status: 200, description: 'List of endpoints (secretHint only)' })
  list(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.webhooks.list(workspaceId, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a webhook endpoint (returns the signing secret ONCE)' })
  @ApiResponse({ status: 201, description: 'Created endpoint incl. plaintext secret (shown once)' })
  @ApiResponse({ status: 400, description: 'Invalid url or unknown event(s)' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.create(workspaceId, user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a webhook endpoint (secret masked)' })
  @ApiResponse({ status: 200, description: 'Endpoint' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.webhooks.findOne(workspaceId, user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a webhook endpoint (optionally rotate the secret)' })
  @ApiResponse({
    status: 200,
    description: 'Updated endpoint (new secret returned once if rotated)',
  })
  @ApiResponse({ status: 400, description: 'Invalid url or unknown event(s)' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(workspaceId, user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.webhooks.remove(workspaceId, user, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List recent deliveries for an endpoint (paginated)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated delivery log' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  listDeliveries(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    // In this stack ParseIntPipe({optional:true}) 400s on a MISSING param, so
    // pair DefaultValuePipe with a non-optional ParseIntPipe.
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.webhooks.listDeliveries(workspaceId, user, id, { limit, offset });
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a sample `ping` delivery so the receiver can be verified' })
  @ApiResponse({ status: 201, description: '{ deliveryId, status }' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  sendTest(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.webhooks.sendTest(workspaceId, user, id);
  }
}
