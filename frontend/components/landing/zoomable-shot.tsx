"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { X, ZoomIn } from "lucide-react";

/**
 * ZoomableShot — a product screenshot that renders inline and opens to a
 * full-screen, large view when clicked. Used across the landing page so every
 * shot is legible at a glance and inspectable in detail.
 *
 * Accessibility: the thumbnail is a real <button> (keyboard + screen-reader
 * operable); the overlay is role="dialog" aria-modal, closes on Escape, on a
 * backdrop click, or via the explicit close button, and locks body scroll while
 * open. The whole thing is client-only ("use client") because it owns open
 * state and a keydown listener.
 */
export function ZoomableShot({
  src,
  alt,
  width,
  height,
  sizes,
  priority,
  className,
  caption,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  priority?: boolean;
  /** Extra classes for the inline thumbnail button (e.g. rounding). */
  className?: string;
  /** Short label shown under the enlarged image in the overlay. */
  caption?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge screenshot: ${alt}`}
        className={`group relative block w-full cursor-zoom-in overflow-hidden ${className ?? ""}`}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          priority={priority}
          className="h-auto w-full transition-transform duration-500 group-hover:scale-[1.015]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity duration-200 group-hover:opacity-100"
        >
          <ZoomIn className="h-4 w-4" />
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={close}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/85 p-4 backdrop-blur-sm sm:p-8"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>

          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes="100vw"
            onClick={(e) => e.stopPropagation()}
            className="h-auto max-h-[86vh] w-auto max-w-[94vw] cursor-default rounded-xl object-contain shadow-2xl"
          />

          <p className="pointer-events-none max-w-2xl text-center text-xs text-white/70 sm:text-sm">
            {caption ?? alt}
            <span className="ml-2 hidden text-white/45 sm:inline">— click anywhere or press Esc to close</span>
          </p>
        </div>
      )}
    </>
  );
}
