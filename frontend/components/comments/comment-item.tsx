'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Edit2, Trash2, Check, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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

interface CommentItemProps {
  comment: Comment;
  currentUserId: string;
  onUpdate: () => void;
  onDelete: () => void;
}

export function CommentItem({ comment, currentUserId, onUpdate, onDelete }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isAuthor = comment.userId === currentUserId;
  const userRole = localStorage.getItem('userRole') || '';
  const canEdit = isAuthor || userRole === 'ADMIN';
  const canDelete = isAuthor || ['ADMIN', 'MANAGER'].includes(userRole);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim()) {
      toast.error('Comment cannot be empty');
      return;
    }

    try {
      await api.patch(`/comments/${comment.id}`, { content: editContent });
      toast.success('Comment updated');
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Failed to update comment:', error);
      toast.error('Failed to update comment');
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await api.delete(`/comments/${comment.id}`);
      toast.success('Comment deleted');
      onDelete();
    } catch (error) {
      console.error('Failed to delete comment:', error);
      toast.error('Failed to delete comment');
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <>
      <Card className="p-4">
        <div className="flex gap-3">
          <div className="h-10 w-10 rounded-full bg-primary text-white flex items-center justify-center font-semibold flex-shrink-0">
            {getInitials(comment.user?.name || 'Unknown')}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-semibold text-foreground">
                  {comment.user?.name || 'Unknown User'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {getRelativeTime(comment.createdAt)}
                  {comment.updatedAt !== comment.createdAt && ' (edited)'}
                </p>
              </div>

              {!isEditing && (
                <div className="flex gap-1">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditing(true)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[100px]"
                  placeholder="Edit your comment..."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveEdit}>
                    <Check className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      setEditContent(comment.content);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {comment.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this comment? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
