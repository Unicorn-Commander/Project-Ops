'use client';

interface ImageViewerProps {
  fileUrl: string;
  fileName: string;
}

export function ImageViewer({ fileUrl, fileName }: ImageViewerProps) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 p-4">
      <img
        src={fileUrl}
        alt={fileName || "Uploaded image"}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
