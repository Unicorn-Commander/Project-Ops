'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewerProps {
  fileUrl: string;
  fileName: string;
}

export function MarkdownViewer({ fileUrl, fileName }: MarkdownViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(false);
    fetch(fileUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Unable to load {fileName}</p>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 text-sm text-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mt-6 mb-3 text-2xl font-bold first:mt-0">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="mt-6 mb-3 text-xl font-semibold first:mt-0">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>
            ),
            h4: ({ children }) => (
              <h4 className="mt-4 mb-2 font-semibold">{children}</h4>
            ),
            p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
            ul: ({ children }) => (
              <ul className="mb-3 list-disc space-y-1 pl-6">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-3 list-decimal space-y-1 pl-6">{children}</ol>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {children}
              </a>
            ),
            code: ({ children, className }) => (
              <code
                className={`rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] ${className ?? ''}`}
              >
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre className="mb-3 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-sm [&>code]:bg-transparent [&>code]:p-0">
                {children}
              </pre>
            ),
            blockquote: ({ children }) => (
              <blockquote className="mb-3 border-l-4 border-border pl-4 italic text-muted-foreground">
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div className="mb-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-border bg-muted px-3 py-1.5 text-left font-semibold">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-3 py-1.5">{children}</td>
            ),
            hr: () => <hr className="my-6 border-border" />,
            img: ({ src, alt }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={alt ?? ''} className="max-w-full rounded" />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
