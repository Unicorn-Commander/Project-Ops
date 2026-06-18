"use client";

/**
 * Dependency arrows — a shared, absolutely-positioned SVG overlay that draws
 * an orthogonal connector for every (predecessor → successor) edge whose both
 * bars are currently painted.
 *
 * Endpoints are MEASURED from the live bar DOM nodes via getBoundingClientRect()
 * (relative to a positioned container), so the arrows track zoom, swimlane
 * collapse, viewport resize, and even a CSS-transform drag preview without
 * re-deriving any date math. Purely decorative: pointer-events-none, and it
 * renders nothing when there are no in-view edges.
 *
 * This module is the single source of truth for the arrow look + routing,
 * consumed by BOTH the project master schedule (gantt.tsx, project-keyed) and
 * the per-project task timeline (task-timeline.tsx, task-keyed). Each caller
 * owns a `barRefs` map and registers its bars via {@link useBarRegistry}; the
 * overlay just reads positions out of that map.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** A directed edge between two painted bars, by their registry id. */
export interface DependencyEdge {
  from: string;
  to: string;
}

/**
 * Owns the live map of bar DOM nodes keyed by id, plus a stable `registerBar`
 * ref-callback to wire onto each bar. Callers pass `barRefs` straight into
 * {@link DependencyArrows}.
 */
export function useBarRegistry() {
  const barRefs = useRef<Map<string, HTMLElement>>(new Map());
  const registerBar = useCallback((id: string, el: HTMLElement | null) => {
    if (el) barRefs.current.set(id, el);
    else barRefs.current.delete(id);
  }, []);
  return { barRefs, registerBar };
}

interface ArrowPath {
  key: string;
  d: string;
  /** Highlighted edges (e.g. the critical path) read with extra weight. */
  emphasized: boolean;
}

export interface DependencyArrowsProps {
  edges: DependencyEdge[];
  barRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  /** The positioned (relative) element the bars live inside. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Bumping this string forces a re-measure. Compose it from anything that can
   * move a bar without remounting the overlay (painted set, zoom, container
   * width, an in-flight drag delta, …).
   */
  recomputeKey: string;
  /**
   * Optional set of `"from->to"` keys to draw with emphasis (a critical /
   * longest dependency chain). Non-emphasized edges stay subtle.
   */
  emphasizedKeys?: Set<string>;
}

export function DependencyArrows({
  edges,
  barRefs,
  containerRef,
  recomputeKey,
  emphasizedKeys,
}: DependencyArrowsProps) {
  const [paths, setPaths] = useState<ArrowPath[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    if (edges.length === 0) {
      setPaths([]);
      return;
    }
    let raf = 0;
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const base = container.getBoundingClientRect();
      setSize({ w: base.width, h: base.height });

      const next: ArrowPath[] = [];
      for (const edge of edges) {
        const fromEl = barRefs.current.get(edge.from);
        const toEl = barRefs.current.get(edge.to);
        if (!fromEl || !toEl) continue;
        const a = fromEl.getBoundingClientRect();
        const b = toEl.getBoundingClientRect();
        // Coordinates relative to the timeline container.
        const startX = a.right - base.left;
        const startY = a.top + a.height / 2 - base.top;
        const endX = b.left - base.left;
        const endY = b.top + b.height / 2 - base.top;

        // Orthogonal "elbow" routing. When the successor sits to the right we
        // step out → across → in. When it's to the left (or overlapping) we
        // loop out past the predecessor's right edge, down/up, and back to the
        // successor's left edge so the line never runs backwards through a bar.
        const STUB = 14; // px the line travels straight off a bar edge
        const ARROW_GAP = 6; // stop short of the bar so the arrowhead reads
        const endXAdj = endX - ARROW_GAP;
        let d: string;
        if (endXAdj > startX + STUB) {
          const midX = Math.max(startX + STUB, (startX + endXAdj) / 2);
          d = `M ${startX} ${startY} H ${midX} V ${endY} H ${endXAdj}`;
        } else {
          const outX = startX + STUB;
          const backX = endX - STUB;
          const midY = (startY + endY) / 2;
          d = `M ${startX} ${startY} H ${outX} V ${midY} H ${backX} V ${endY} H ${endXAdj}`;
        }
        const key = `${edge.from}->${edge.to}`;
        next.push({ key, d, emphasized: emphasizedKeys?.has(key) ?? false });
      }
      setPaths(next);
    };
    // Measure on the next frame so transitions/transforms have applied.
    raf = requestAnimationFrame(measure);
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, recomputeKey, emphasizedKeys]);

  if (paths.length === 0 || size.w === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-20 overflow-visible"
      width={size.w}
      height={size.h}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="po-dep-arrowhead"
          markerWidth="7"
          markerHeight="7"
          refX="5.5"
          refY="3"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L6,3 L0,6 Z" className="fill-primary/70" />
        </marker>
        <marker
          id="po-dep-arrowhead-strong"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L7,3.5 L0,7 Z" className="fill-amber-500 dark:fill-amber-400" />
        </marker>
      </defs>
      {paths.map((p) =>
        p.emphasized ? (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            className="stroke-amber-500 dark:stroke-amber-400"
            strokeWidth={2.25}
            strokeLinejoin="round"
            markerEnd="url(#po-dep-arrowhead-strong)"
          />
        ) : (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            className="stroke-primary/70"
            strokeWidth={1.5}
            strokeLinejoin="round"
            markerEnd="url(#po-dep-arrowhead)"
          />
        ),
      )}
    </svg>
  );
}
