import { io, Socket } from 'socket.io-client';

class WebSocketClient {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    const token = localStorage.getItem('access_token');
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3101';
    // Strip any path (e.g. `/api/v1`) so the socket.io namespace is exactly
    // `/realtime` (matching the backend gateway), not `/api/v1/realtime`
    // (which the server rejects as an invalid namespace).
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '');

    this.socket = io(`${wsUrl}/realtime`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.reconnectAttempts++;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached');
      }
    });

    return this.socket;
  }

  joinProject(projectId: string) {
    if (!this.socket) return;
    this.socket.emit('join-project', { projectId });
  }

  leaveProject(projectId: string) {
    if (!this.socket) return;
    this.socket.emit('leave-project', { projectId });
  }

  on(event: string, callback: (...args: any[]) => void) {
    if (!this.socket) return;
    this.socket.on(event, callback);
  }

  off(event: string, callback?: (...args: any[]) => void) {
    if (!this.socket) return;
    if (callback) {
      this.socket.off(event, callback);
    } else {
      this.socket.off(event);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

export const wsClient = new WebSocketClient();
