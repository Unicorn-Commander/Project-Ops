'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, X, FileText } from 'lucide-react';
import { PDFViewer } from './pdf-viewer';
import { ImageViewer } from './image-viewer';
import { OfficeViewer } from './office-viewer';
import { MarkdownViewer } from './markdown-viewer';

interface Document {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

interface DocumentViewerModalProps {
  document: Document | null;
  fileUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DocumentViewerModal({
  document,
  fileUrl,
  isOpen,
  onClose,
}: DocumentViewerModalProps) {
  if (!document || !fileUrl) return null;

  const isPDF = document.mimeType === 'application/pdf';
  const isImage = document.mimeType.startsWith('image/');

  // Office document types
  const isWord = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ].includes(document.mimeType);

  const isExcel = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ].includes(document.mimeType);

  const isPowerPoint = [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ].includes(document.mimeType);

  // Markdown is detected by extension too — browsers often upload .md files
  // with an empty or generic mime type.
  const isMarkdown =
    document.mimeType === 'text/markdown' ||
    /\.(md|markdown)$/i.test(document.fileName);
  const isText = !isMarkdown && document.mimeType.startsWith('text/');
  const isOffice = isWord || isExcel || isPowerPoint;

  const handleDownload = () => {
    const link = window.document.createElement('a');
    link.href = fileUrl;
    link.download = document.fileName;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold truncate pr-8">
              {document.fileName}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
          <DialogDescription className="sr-only">
            Document viewer displaying {document.fileName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden min-h-0">
          {isPDF && <PDFViewer fileUrl={fileUrl} />}
          {isImage && <ImageViewer fileUrl={fileUrl} fileName={document.fileName} />}
          {isOffice && <OfficeViewer fileUrl={fileUrl} mimeType={document.mimeType} fileName={document.fileName} />}
          {isMarkdown && <MarkdownViewer fileUrl={fileUrl} fileName={document.fileName} />}
          {isText && (
            <div className="h-full p-6">
              <iframe
                src={fileUrl}
                className="w-full h-full border-0"
                title={document.fileName}
              />
            </div>
          )}
          {!isPDF && !isImage && !isOffice && !isText && !isMarkdown && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground/70" />
                <p className="text-muted-foreground mb-2 font-semibold">
                  Preview not available for this file type
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  File type: {document.mimeType}
                </p>
                <Button onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download to view
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
