'use client';

import { Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';

interface OfficeViewerProps {
  fileUrl: string;
  mimeType: string;
  fileName: string;
}

export function OfficeViewer({ fileUrl, fileName }: OfficeViewerProps) {
  const [viewerUrl, setViewerUrl] = useState<string>('');
  const [viewerType, setViewerType] = useState<'office' | 'google' | 'none'>('none');

  useEffect(() => {
    // Encode the file URL for use in viewer
    const encodedUrl = encodeURIComponent(fileUrl);

    // Try Microsoft Office Online Viewer first (works best for Office files)
    // Format: https://view.officeapps.live.com/op/embed.aspx?src=<URL>
    const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodedUrl}`;

    // Fallback: Google Docs Viewer
    // Format: https://docs.google.com/viewer?url=<URL>&embedded=true
    const googleViewerUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;

    // Use Microsoft Office viewer for Office files (better compatibility)
    const ext = fileName.toLowerCase().split('.').pop();
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext || '')) {
      setViewerUrl(officeViewerUrl);
      setViewerType('office');
    } else {
      // For other formats, try Google viewer
      setViewerUrl(googleViewerUrl);
      setViewerType('google');
    }
  }, [fileUrl, fileName]);

  const handleDownload = () => {
    const link = window.document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.target = '_blank';
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  const handleOpenInNewTab = () => {
    window.open(viewerUrl, '_blank');
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 relative bg-muted">
        {viewerUrl ? (
          <iframe
            src={viewerUrl}
            className="w-full h-full border-0"
            title={fileName}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Loading document viewer...</p>
          </div>
        )}
      </div>
      <div className="p-4 border-t bg-muted/40">
        <div className="flex items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            Viewing with {viewerType === 'office' ? 'Microsoft Office Online' : 'Google Docs Viewer'}
          </p>
          <div className="flex gap-2">
            <Button onClick={handleOpenInNewTab} size="sm" variant="outline">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in New Tab
            </Button>
            <Button onClick={handleDownload} size="sm">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
