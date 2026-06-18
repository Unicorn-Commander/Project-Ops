import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ClientPortalService } from './client-portal.service';
import { ApprovalsService } from './approvals/approvals.service';
import { DecideApprovalDto } from './approvals/dto/decide-approval.dto';
import { RequestApprovalDto } from './approvals/dto/request-approval.dto';
import { CreatePortalCommentDto } from './dto/create-portal-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { ClientApprovalStatus, User, UserRole } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, G3): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 *
 * AUTH MODEL — two role audiences on ONE controller:
 *   - CLIENT routes (dashboard / projects / documents / approvals list +
 *     decision / project comments / invoices) gate with `verifyClientRole` and
 *     are additionally scoped to the contact's own org/projects inside the
 *     service. They carry NO `@Roles`, so RolesGuard is a no-op for them.
 *   - The single STAFF route (`POST /approvals`, request an approval) is gated
 *     by `@Roles(ADMIN, MANAGER, STAFF)` via the class-level RolesGuard. This is
 *     how the app already distinguishes staff vs client (user.role + RolesGuard,
 *     same pattern as ProjectsController/CommentsController). Staff surfaces in
 *     other modules can equivalently call the exported `ApprovalsService.request`.
 */
@ApiTags('client-portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Controller('client-portal')
export class ClientPortalController {
  constructor(
    private readonly clientPortalService: ClientPortalService,
    private readonly approvalsService: ApprovalsService,
  ) {}

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
  getDashboard(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    this.verifyClientRole(user);
    return this.clientPortalService.getDashboard(workspaceId, user);
  }

  @Get('projects')
  @ApiOperation({ summary: 'Get all projects for the client' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getProjects(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
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
  getDocuments(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    this.verifyClientRole(user);
    return this.clientPortalService.getDocuments(workspaceId, user);
  }

  // ====================================================================
  // APPROVALS (two-way)
  // ====================================================================

  @Get('approvals')
  @ApiOperation({ summary: "Get the client's pending + recent approvals" })
  @ApiQuery({ name: 'status', required: false, enum: ClientApprovalStatus })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size (default 50, max 100)',
  })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of approvals (pending first)' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getApprovals(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('status') status?: ClientApprovalStatus,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    this.verifyClientRole(user);
    return this.approvalsService.listForContact(workspaceId, user, {
      status,
      take: limit,
      skip: offset,
    });
  }

  @Post('approvals/:id/decision')
  @ApiOperation({ summary: "Record the client's decision on one of their pending approvals" })
  @ApiResponse({ status: 201, description: 'Decision recorded' })
  @ApiResponse({
    status: 403,
    description: 'Access denied - not a client, or approval already decided',
  })
  @ApiResponse({ status: 404, description: "Approval not found (or not the client's)" })
  decideApproval(
    @Param('id') id: string,
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: DecideApprovalDto,
  ) {
    this.verifyClientRole(user);
    return this.approvalsService.decide(workspaceId, user, id, dto);
  }

  @Post('approvals')
  // STAFF-only: this is how staff REQUEST an approval. Gated by RolesGuard (class
  // level) — clients are excluded. Equivalent to ApprovalsService.request, which
  // is also exported for staff surfaces in other modules.
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({
    summary: '[staff] Request a client approval on a document / deliverable / project',
  })
  @ApiResponse({ status: 201, description: 'Approval requested (PENDING)' })
  @ApiResponse({ status: 403, description: 'Access denied - staff only' })
  @ApiResponse({ status: 404, description: 'Linked project not found' })
  requestApproval(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: RequestApprovalDto,
  ) {
    return this.approvalsService.request(workspaceId, user, dto);
  }

  // ====================================================================
  // COMMENTS (two-way) — on the client's visible projects
  // ====================================================================

  @Get('projects/:id/comments')
  @ApiOperation({ summary: "Get non-internal comments on one of the client's projects" })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size (default 50, max 100)',
  })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of comments' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client or project owner' })
  @ApiResponse({ status: 404, description: 'Project or client profile not found' })
  getProjectComments(
    @Param('id') id: string,
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    this.verifyClientRole(user);
    return this.clientPortalService.getProjectComments(workspaceId, user, id, {
      take: limit,
      skip: offset,
    });
  }

  @Post('projects/:id/comments')
  @ApiOperation({ summary: "Post a comment on one of the client's projects" })
  @ApiResponse({ status: 201, description: 'Comment created' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client or project owner' })
  @ApiResponse({ status: 404, description: 'Project or client profile not found' })
  createProjectComment(
    @Param('id') id: string,
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreatePortalCommentDto,
  ) {
    this.verifyClientRole(user);
    return this.clientPortalService.createProjectComment(workspaceId, user, id, dto);
  }

  // ====================================================================
  // INVOICES (read-only)
  // ====================================================================

  @Get('invoices')
  @ApiOperation({ summary: "Get the client's invoices (read-only)" })
  @ApiResponse({ status: 200, description: 'List of invoices' })
  @ApiResponse({ status: 403, description: 'Access denied - not a client' })
  @ApiResponse({ status: 404, description: 'Client profile not found' })
  getInvoices(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    this.verifyClientRole(user);
    return this.clientPortalService.getInvoices(workspaceId, user);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get one invoice (read-only)' })
  @ApiResponse({
    status: 200,
    description: 'Invoice detail (incl. payUrl deep-link when a balance is due)',
  })
  @ApiResponse({ status: 403, description: 'Access denied - not a client or invoice owner' })
  @ApiResponse({ status: 404, description: 'Invoice or client profile not found' })
  getInvoiceById(
    @Param('id') id: string,
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    this.verifyClientRole(user);
    return this.clientPortalService.getInvoiceById(workspaceId, user, id);
  }
}
