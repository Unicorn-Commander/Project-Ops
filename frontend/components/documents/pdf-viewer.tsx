'use client';

interface PDFViewerProps {
  fileUrl: string;
}

export function PDFViewer({ fileUrl }: PDFViewerProps) {
  return (
    <div className="w-full h-full">
      <iframe
        src={fileUrl}
        className="w-full h-full border-0"
        title="PDF Document"
      />
    </div>
  );
}
