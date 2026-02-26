'use client';

import { useState, useEffect } from 'react';
import { CommentItem } from './comment-item';
import { CommentForm } from './comment-form';
import { api } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Comment {
  id: string;
  projectId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

interface CommentThreadProps {
  projectId: string;
}

export function CommentThread({ projectId }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');

  useEffect(() => {
    const userId = localStorage.getItem('userId') || '';
    setCurrentUserId(userId);
    fetchComments();

    // Connect to WebSocket
    const socket = wsClient.connect();
    wsClient.joinProject(projectId);

    // Listen for real-time comment events
    const handleCommentCreated = (comment: Comment) => {
      setComments((prev) => [comment, ...prev]);
    };

    const handleCommentUpdated = (comment: Comment) => {
      setComments((prev) =>
        prev.map((c) => (c.id === comment.id ? comment : c))
      );
    };

    const handleCommentDeleted = ({ commentId }: { commentId: string }) => {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    };

    wsClient.on('comment-created', handleCommentCreated);
    wsClient.on('comment-updated', handleCommentUpdated);
    wsClient.on('comment-deleted', handleCommentDeleted);

    return () => {
      wsClient.off('comment-created', handleCommentCreated);
      wsClient.off('comment-updated', handleCommentUpdated);
      wsClient.off('comment-deleted', handleCommentDeleted);
      wsClient.leaveProject(projectId);
    };
  }, [projectId]);

  const fetchComments = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/comments/project/${projectId}`);
      setComments(response.data);
    } catch (error) {
      console.error('Failed to fetch comments:', error);
      toast.error('Failed to load comments');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CommentForm projectId={projectId} onCommentAdded={fetchComments} />

      {comments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No comments yet</p>
          <p className="text-sm mt-1">Be the first to comment!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              onUpdate={fetchComments}
              onDelete={fetchComments}
            />
          ))}
        </div>
      )}
    </div>
  );
}
