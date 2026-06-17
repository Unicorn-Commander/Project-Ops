'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { Send } from 'lucide-react';

interface CommentFormProps {
  projectId: string;
  onCommentAdded?: () => void;
}

export function CommentForm({ projectId, onCommentAdded }: CommentFormProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim()) {
      toast({ title: 'Comment cannot be empty', variant: 'destructive' });
      return;
    }

    if (content.length > 2000) {
      toast({
        title: 'Comment is too long (max 2000 characters)',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      await api.post('/comments', {
        projectId,
        content: content.trim(),
      });
      toast({ title: 'Comment added', variant: 'success' });
      setContent('');
      if (onCommentAdded) {
        onCommentAdded();
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
      toast({ title: 'Failed to add comment', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a comment... (Markdown supported)"
          className="min-h-[100px] pr-16"
          disabled={isSubmitting}
        />
        <div className="absolute bottom-2 right-2 text-xs text-gray-500">
          {content.length}/2000
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Supports **bold**, *italic*, and lists
        </p>
        <Button type="submit" disabled={isSubmitting || !content.trim()}>
          <Send className="h-4 w-4 mr-2" />
          {isSubmitting ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
