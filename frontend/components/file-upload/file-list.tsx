"use client"

import React from 'react';
import { FileText, Image, FileType, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/upload-service';
import { cn } from '@/lib/utils';

export interface FileItem {
  file: File;
  id: string;
}

export interface FileListProps {
  files: FileItem[];
  onRemove: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) {
    return <Image className="h-5 w-5 text-primary" />;
  }
  if (mimeType === 'application/pdf') {
    return <FileText className="h-5 w-5 text-destructive" />;
  }
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return <FileType className="h-5 w-5 text-blue-600" />;
  }
  return <FileText className="h-5 w-5 text-muted-foreground" />;
};

const FileList: React.FC<FileListProps> = ({
  files,
  onRemove,
  disabled = false,
  className,
}) => {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <h3 className="text-sm font-medium text-foreground mb-3">
        Selected Files ({files.length})
      </h3>
      <div className="space-y-2">
        {files.map(({ file, id }) => (
          <div
            key={id}
            className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
          >
            <div className="flex-shrink-0">
              {getFileIcon(file.type)}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
                <span className="text-xs text-muted-foreground">•</span>
                <p className="text-xs text-muted-foreground">
                  {file.type.split('/')[1].toUpperCase()}
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemove(id)}
              disabled={disabled}
              className="h-8 w-8 flex-shrink-0"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FileList;
