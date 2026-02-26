"use client"

import React, { useCallback, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { validateFile } from '@/lib/upload-service';

export interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
}

const DropZone: React.FC<DropZoneProps> = ({
  onFilesSelected,
  multiple = true,
  disabled = false,
  className,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const fileArray = Array.from(files);
      const validFiles: File[] = [];
      const errors: string[] = [];

      fileArray.forEach((file) => {
        const validation = validateFile(file);
        if (validation.valid) {
          validFiles.push(file);
        } else if (validation.error) {
          errors.push(`${file.name}: ${validation.error}`);
        }
      });

      if (errors.length > 0) {
        alert(`Some files were rejected:\n${errors.join('\n')}`);
      }

      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }
    },
    [onFilesSelected]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      handleFiles(files);
    },
    [disabled, handleFiles]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset input value to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleFiles]
  );

  const handleClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  return (
    <div
      className={cn(
        "relative border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
        isDragging
          ? "border-primary bg-primary/5 scale-105"
          : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-primary/5",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        onChange={handleFileInputChange}
        className="hidden"
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
        disabled={disabled}
      />

      <div className="flex flex-col items-center gap-4">
        <div className={cn(
          "rounded-full p-4 transition-colors",
          isDragging ? "bg-primary/10" : "bg-primary/5"
        )}>
          {isDragging ? (
            <FileText className="h-8 w-8 text-primary" />
          ) : (
            <Upload className="h-8 w-8 text-primary" />
          )}
        </div>

        <div>
          <p className="text-base font-medium text-foreground mb-1">
            {isDragging ? 'Drop files here' : 'Drag and drop files here'}
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse
          </p>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>Supported: PDF, DOC, DOCX, JPG, PNG</p>
          <p>Maximum size: 10MB per file</p>
        </div>
      </div>
    </div>
  );
};

export default DropZone;
