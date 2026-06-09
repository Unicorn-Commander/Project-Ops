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
import { Logger, UseGuards } from '@nestjs/common';
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

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} disconnected: No token provided`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = this.jwtService.verify(token);
      client.data.user = payload;

      // Auto-join the per-user room so the timer widget + personal timesheet
      // get realtime updates regardless of which project room they're in.
      if (payload?.sub) {
        client.join(`user:${payload.sub}`);
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
  handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const room = `project:${data.projectId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined ${room}`);
    return { event: 'joined-project', data: { projectId: data.projectId } };
  }

  @SubscribeMessage('leave-project')
  handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const room = `project:${data.projectId}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left ${room}`);
    return { event: 'left-project', data: { projectId: data.projectId } };
  }

  @SubscribeMessage('project-update')
  handleProjectUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    const room = `project:${data.projectId}`;
    client.to(room).emit('project-updated', data);
    this.logger.log(`Project update broadcasted to ${room}`);
  }

  // Event listeners for automatic broadcasts

  @OnEvent('comment.created')
  handleCommentCreated(payload: any) {
    const room = `project:${payload.projectId}`;
    this.server.to(room).emit('comment-created', payload.comment);
    this.logger.log(`Comment created event broadcasted to ${room}`);
  }

  @OnEvent('comment.updated')
  handleCommentUpdated(payload: any) {
    const room = `project:${payload.projectId}`;
    this.server.to(room).emit('comment-updated', payload.comment);
    this.logger.log(`Comment updated event broadcasted to ${room}`);
  }

  @OnEvent('comment.deleted')
  handleCommentDeleted(payload: any) {
    const room = `project:${payload.projectId}`;
    this.server.to(room).emit('comment-deleted', { commentId: payload.commentId });
    this.logger.log(`Comment deleted event broadcasted to ${room}`);
  }

  @OnEvent('project.status-changed')
  handleProjectStatusChanged(payload: any) {
    const room = `project:${payload.projectId}`;
    this.server.to(room).emit('project-status-changed', payload);
    this.logger.log(`Project status changed event broadcasted to ${room}`);
  }

  @OnEvent('document.uploaded')
  handleDocumentUploaded(payload: any) {
    const room = `project:${payload.projectId}`;
    this.server.to(room).emit('document-uploaded', payload.document);
    this.logger.log(`Document uploaded event broadcasted to ${room}`);
  }

  // ── Time tracking ────────────────────────────────────────

  @OnEvent('timeEntry.created')
  handleTimeEntryCreated(payload: any) {
    this.toProjectAndUser(payload, 'time-entry-created', payload.timeEntry);
  }

  @OnEvent('timeEntry.updated')
  handleTimeEntryUpdated(payload: any) {
    this.toProjectAndUser(payload, 'time-entry-updated', payload.timeEntry);
  }

  @OnEvent('timeEntry.stopped')
  handleTimeEntryStopped(payload: any) {
    this.toProjectAndUser(payload, 'time-entry-stopped', payload.timeEntry);
  }

  @OnEvent('timeEntry.deleted')
  handleTimeEntryDeleted(payload: any) {
    this.toProjectAndUser(payload, 'time-entry-deleted', { id: payload.id });
  }

  @OnEvent('timesheet.submitted')
  handleTimesheetSubmitted(payload: any) {
    if (payload.userId) this.server.to(`user:${payload.userId}`).emit('timesheet-submitted', payload);
    // Notify approvers' queues (low-volume metadata).
    this.server.emit('timesheet-pending', payload);
  }

  @OnEvent('timesheet.approved')
  handleTimesheetApproved(payload: any) {
    this.server.emit('timesheet-approved', payload);
  }

  @OnEvent('timesheet.rejected')
  handleTimesheetRejected(payload: any) {
    this.server.emit('timesheet-rejected', payload);
  }

  @OnEvent('billing.invoiced')
  handleBillingInvoiced(payload: any) {
    for (const projectId of payload.projectIds || []) {
      this.server.to(`project:${projectId}`).emit('billing-invoiced', payload.invoice);
    }
  }

  /** Emit to both the entry's project room and the owning user's room. */
  private toProjectAndUser(payload: any, event: string, data: any) {
    if (payload.projectId) this.server.to(`project:${payload.projectId}`).emit(event, data);
    if (payload.userId) this.server.to(`user:${payload.userId}`).emit(event, data);
  }

  // Utility methods

  broadcastToProject(projectId: string, event: string, data: any) {
    const room = `project:${projectId}`;
    this.server.to(room).emit(event, data);
    this.logger.log(`Custom event '${event}' broadcasted to ${room}`);
  }

  broadcastToAll(event: string, data: any) {
    this.server.emit(event, data);
    this.logger.log(`Custom event '${event}' broadcasted to all clients`);
  }

  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }
}