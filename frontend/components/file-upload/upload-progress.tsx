"use client"

import React from 'react';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/upload-service';
import { cn } from '@/lib/utils';

export interface UploadProgressProps {
  fileName: string;
  fileSize: number;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
  onCancel?: () => void;
  className?: string;
}

const UploadProgress: React.FC<UploadProgressProps> = ({
  fileName,
  fileSize,
  progress,
  status,
  error,
  onCancel,
  className,
}) => {
  return (
    <div className={cn("border rounded-lg p-4 bg-card", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium truncate">{fileName}</p>
            {status === 'success' && (
              <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
            )}
            {status === 'error' && (
              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
            )}
          </div>

          <p className="text-xs text-muted-foreground mb-3">
            {formatFileSize(fileSize)}
            {status === 'uploading' && ` • ${progress}%`}
          </p>

          {status === 'uploading' && (
            <Progress value={progress} className="h-2" />
          )}

          {status === 'error' && error && (
            <p className="text-xs text-destructive mt-2">{error}</p>
          )}

          {status === 'success' && (
            <p className="text-xs text-green-600 mt-2">Upload complete</p>
          )}
        </div>

        {status === 'uploading' && onCancel && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-8 w-8 flex-shrink-0"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Cancel upload</span>
          </Button>
        )}
      </div>
    </div>
  );
};

export default UploadProgress;
