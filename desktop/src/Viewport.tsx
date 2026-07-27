import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, WheelEvent as ReactWheelEvent } from "react";

export interface ViewportHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fit: () => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

interface ViewportProps {
  children: ReactNode;
  className?: string;
  /** Interactive elements inside the world that should never start a pan gesture. */
  interactiveSelector?: string;
  onTransformChange?: (t: Transform) => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const INITIAL: Transform = { x: 48, y: 32, scale: 1 };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** A pannable, zoomable 2D viewport (CSS transform on a `.world` layer) — drag empty background
 * to pan, wheel to zoom centered on the cursor. Interactive descendants (boxes, inputs, buttons)
 * are excluded from pan gestures via `interactiveSelector` so they keep their own click/drag
 * behavior. Zoom/pan controls are exposed imperatively via `ref` for an external toolbar. */
const Viewport = forwardRef<ViewportHandle, ViewportProps>(function Viewport(
  { children, className, interactiveSelector = ".box-node, input, button, textarea, select, .palette-chip", onTransformChange },
  ref,
) {
  const [transform, setTransform] = useState<Transform>(INITIAL);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const panStart = useRef<{ clientX: number; clientY: number; originX: number; originY: number } | null>(null);

  function apply(next: Transform) {
    setTransform(next);
    onTransformChange?.(next);
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    setTransform((t) => {
      const newScale = clampScale(t.scale * factor);
      const worldX = (cx - t.x) / t.scale;
      const worldY = (cy - t.y) / t.scale;
      const next = { scale: newScale, x: cx - worldX * newScale, y: cy - worldY * newScale };
      onTransformChange?.(next);
      return next;
    });
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
    },
    zoomOut: () => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
    },
    reset: () => apply(INITIAL),
    fit: () => {
      const vp = viewportRef.current;
      const world = worldRef.current;
      if (!vp || !world) return;
      const contentW = world.scrollWidth;
      const contentH = world.scrollHeight;
      if (contentW === 0 || contentH === 0) return;
      const vpRect = vp.getBoundingClientRect();
      const scale = clampScale(
        Math.min((vpRect.width - 80) / contentW, (vpRect.height - 80) / contentH, 1),
      );
      apply({ x: Math.max(24, (vpRect.width - contentW * scale) / 2), y: 32, scale });
    },
  }));

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  function onMouseDown(e: ReactMouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(interactiveSelector)) return;
    panStart.current = { clientX: e.clientX, clientY: e.clientY, originX: transform.x, originY: transform.y };
    setPanning(true);
  }

  function onMouseMove(e: ReactMouseEvent) {
    if (!panStart.current) return;
    const { clientX, clientY, originX, originY } = panStart.current;
    apply({ ...transform, x: originX + (e.clientX - clientX), y: originY + (e.clientY - clientY) });
  }

  function endPan() {
    panStart.current = null;
    setPanning(false);
  }

  const gridSize = 24 * transform.scale;

  return (
    <div
      ref={viewportRef}
      className={`viewport${panning ? " panning" : ""}${className ? ` ${className}` : ""}`}
      style={{
        backgroundPosition: `${transform.x}px ${transform.y}px`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
    >
      <div
        ref={worldRef}
        className="world"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        {children}
      </div>
    </div>
  );
});

export default Viewport;
