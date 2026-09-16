import { publicUserPayload } from '../common/serialization/public-user';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ForbiddenException, Logger } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientPortalService } from '../client-portal/client-portal.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private connectedClients = new Map<string, Socket>();

  constructor(
    private jwtService: JwtService,
    private readonly auth: AuthService,
    private readonly workspace: WorkspaceContextService,
    private readonly projects: ProjectsService,
    private readonly portal: ClientPortalService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token =
        client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} disconnected: No token provided`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = this.jwtService.verify(token);
      client.data.authClaims = payload;
      client.data.workspaceId = client.handshake.auth.workspaceId ?? payload.workspace_id ?? null;
      const user = await this.freshUser(client);
      client.data.workspaceId = await this.workspace.resolveAuthorized(
        user,
        client.data.workspaceId,
      );
      client.data.user = user;

      // Auto-join the per-user room so the timer widget + personal timesheet
      // get realtime updates regardless of which project room they're in.
      if (payload?.sub) {
        client.join(`user:${user.id}`);
      }

      this.connectedClients.set(client.id, client);
      this.logger.log(`Client connected: ${client.id} (User: ${payload.email})`);

      // Send welcome message
      client.emit('connected', {
        message: 'Connected to Project Ops realtime server',
        userId: payload.sub,
      });
    } catch (error) {
      this.logger.error(`Connection error for client ${client.id}:`, error.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-project')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string; workspaceId?: string },
  ) {
    try {
      const workspaceId = data.workspaceId ?? client.data.workspaceId;
      await this.authorizeProject(client, data.projectId, workspaceId);
      client.data.projectWorkspaces ??= {};
      client.data.projectWorkspaces[data.projectId] = workspaceId;
      await client.join(`project:${data.projectId}`);
      return { event: 'joined-project', data: { projectId: data.projectId } };
    } catch {
      return { event: 'error', data: { code: 'forbidden' } };
    }
  }

  @SubscribeMessage('leave-project')
  async handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    await client.leave(`project:${data.projectId}`);
    delete client.data.projectWorkspaces?.[data.projectId];
    return { event: 'left-project', data: { projectId: data.projectId } };
  }

  @SubscribeMessage('project-update')
  async handleProjectUpdate(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    try {
      const ws = client.data.projectWorkspaces?.[data.projectId] ?? client.data.workspaceId;
      const user = await this.authorizeProject(client, data.projectId, ws);
      if (user.role === UserRole.CLIENT) throw new ForbiddenException();
      await this.workspace.assertCanWrite(user, ws);
      await this.emitProject(
        data.projectId,
        'project-updated',
        { projectId: data.projectId },
        client.id,
      );
      return { event: 'project-update-accepted' };
    } catch {
      return { event: 'error', data: { code: 'forbidden' } };
    }
  }

  private async freshUser(client: Socket): Promise<User> {
    const claims = client.data.authClaims;
    if (!claims || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now())
      throw new ForbiddenException();
    return this.auth.validateJwtPayload(claims);
  }

  private async authorizeProject(client: Socket, projectId: string, requestedWorkspaceId?: string) {
    const user = await this.freshUser(client);
    const workspaceId = await this.workspace.resolveAuthorized(
      user,
      requestedWorkspaceId ?? client.data.workspaceId,
    );
    // Reuse the existing CLIENT contact/project fence rather than treating a
    // same-workspace project as automatically visible to every portal client.
    if (user.role === UserRole.CLIENT)
      await this.portal.getProjectDetails(workspaceId, user, projectId);
    else await this.projects.findOne(workspaceId, user, projectId);
    return user;
  }

  private async emitProject(projectId: string, event: string, data: any, excludeId?: string) {
    const room = `project:${projectId}`;
    for (const client of this.connectedClients.values()) {
      if (client.id === excludeId || !client.rooms.has(room)) continue;
      try {
        const user = await this.authorizeProject(
          client,
          projectId,
          client.data.projectWorkspaces?.[projectId],
        );
        if (
          user.role === UserRole.CLIENT &&
          ['comment-created', 'comment-updated'].includes(event) &&
          data?.isInternal !== false
        )
          continue;
        client.emit(event, publicUserPayload(data));
      } catch {
        await client.leave(room);
      }
    }
  }

  private async emitWorkspace(payload: any, event: string, data: any, approversOnly = false) {
    if (typeof payload.workspaceId !== 'string') return; // Never guess a tenant.
    for (const client of this.connectedClients.values()) {
      try {
        const user = await this.freshUser(client);
        await this.workspace.resolveAuthorized(user, payload.workspaceId);
        const owner = user.id === payload.userId || (payload.userIds ?? []).includes(user.id);
        let approver = [UserRole.ADMIN, UserRole.MANAGER].includes(user.role as any);
        if (approver) {
          try {
            await this.workspace.assertCanWrite(user, payload.workspaceId);
          } catch {
            approver = false;
          }
        }
        if (approversOnly ? approver : owner || approver)
          client.emit(event, publicUserPayload(data));
      } catch {
        /* Revoked/foreign sockets never receive the payload. */
      }
    }
  }

  // Event listeners for automatic broadcasts

  @OnEvent('comment.created')
  async handleCommentCreated(payload: any) {
    const room = `project:${payload.projectId}`;
    await this.emitProject(payload.projectId, 'comment-created', payload.comment);
    this.logger.log(`Comment created event broadcasted to ${room}`);
  }

  @OnEvent('comment.updated')
  async handleCommentUpdated(payload: any) {
    const room = `project:${payload.projectId}`;
    await this.emitProject(payload.projectId, 'comment-updated', payload.comment);
    this.logger.log(`Comment updated event broadcasted to ${room}`);
  }

  @OnEvent('comment.deleted')
  async handleCommentDeleted(payload: any) {
    const room = `project:${payload.projectId}`;
    await this.emitProject(payload.projectId, 'comment-deleted', { commentId: payload.commentId });
    this.logger.log(`Comment deleted event broadcasted to ${room}`);
  }

  @OnEvent('project.status-changed')
  async handleProjectStatusChanged(payload: any) {
    const room = `project:${payload.projectId}`;
    await this.emitProject(payload.projectId, 'project-status-changed', payload);
    this.logger.log(`Project status changed event broadcasted to ${room}`);
  }

  @OnEvent('document.uploaded')
  async handleDocumentUploaded(payload: any) {
    const room = `project:${payload.projectId}`;
    await this.emitProject(payload.projectId, 'document-uploaded', payload.document);
    this.logger.log(`Document uploaded event broadcasted to ${room}`);
  }

  // ── Time tracking ────────────────────────────────────────

  @OnEvent('timeEntry.created')
  async handleTimeEntryCreated(payload: any) {
    await this.toProjectAndUser(payload, 'time-entry-created', payload.timeEntry);
  }

  @OnEvent('timeEntry.updated')
  async handleTimeEntryUpdated(payload: any) {
    await this.toProjectAndUser(payload, 'time-entry-updated', payload.timeEntry);
  }

  @OnEvent('timeEntry.stopped')
  async handleTimeEntryStopped(payload: any) {
    await this.toProjectAndUser(payload, 'time-entry-stopped', payload.timeEntry);
  }

  @OnEvent('timeEntry.deleted')
  async handleTimeEntryDeleted(payload: any) {
    await this.toProjectAndUser(payload, 'time-entry-deleted', { id: payload.id });
  }

  @OnEvent('timesheet.submitted')
  async handleTimesheetSubmitted(payload: any) {
    await this.emitWorkspace(payload, 'timesheet-submitted', payload);
    await this.emitWorkspace(payload, 'timesheet-pending', payload, true);
  }
  @OnEvent('timesheet.approved')
  async handleTimesheetApproved(payload: any) {
    await this.emitWorkspace(payload, 'timesheet-approved', payload);
  }
  @OnEvent('timesheet.rejected')
  async handleTimesheetRejected(payload: any) {
    await this.emitWorkspace(payload, 'timesheet-rejected', payload);
  }
  @OnEvent('billing.invoiced')
  async handleBillingInvoiced(payload: any) {
    for (const projectId of payload.projectIds || [])
      await this.emitProject(projectId, 'billing-invoiced', payload.invoice);
  }
  private async toProjectAndUser(payload: any, event: string, data: any) {
    await this.emitWorkspace(
      { ...payload, workspaceId: payload.workspaceId ?? payload.timeEntry?.workspaceId },
      event,
      data,
    );
  }
  async broadcastToProject(projectId: string, event: string, data: any) {
    await this.emitProject(projectId, event, data);
  }
  /** No callers currently exist. A tenant is mandatory; global payload broadcasts are forbidden. */
  async broadcastToAll(event: string, data: any, workspaceId?: string) {
    if (!workspaceId) throw new ForbiddenException('A workspace is required.');
    await this.emitWorkspace({ workspaceId }, event, data, true);
  }

  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }
}
