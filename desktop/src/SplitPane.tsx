import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

export const DIVIDER_SIZE = 10;

interface SplitPaneProps {
  /** "horizontal" = panes side by side, split by a vertical divider bar.
   *  "vertical" = panes stacked, split by a horizontal divider bar. */
  direction: "horizontal" | "vertical";
  first: ReactNode;
  second: ReactNode;
  /** Initial size (px) of the first pane along the split axis. */
  defaultSize: number;
  minSize?: number;
  minSecondSize?: number;
  /** Persists (and restores) the split position across sessions. */
  storageKey?: string;
  className?: string;
  /** Whether this split is currently visible (e.g. its tab is the active one). Defaults to true.
   * A `display: none` ancestor collapses `clientWidth`/`clientHeight` to 0 — since both tabs stay
   * mounted (so switching back never loses a draft), a split that first mounts on the *inactive*
   * tab would otherwise clamp its size down to the floor while hidden and never recover, because
   * nothing further "resizes" it once it's shown. Passing `active` re-measures the moment it
   * actually becomes visible instead of guessing at timing. */
  active?: boolean;
}

function readStoredSize(storageKey: string | undefined, fallback: number): number {
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredSize(storageKey: string | undefined, size: number): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, String(Math.round(size)));
  } catch {
    // Private-browsing quota or disabled storage — losing the persisted split position isn't
    // worth surfacing an error for.
  }
}

/** A resizable two-pane split — drag the divider, double-click it to reset. Sizing is a plain
 * pixel offset (not a ratio) so the divider tracks the cursor exactly; a resize observer
 * re-clamps it if the container's size changes so a persisted size never pushes the second pane
 * off-screen. */
export default function SplitPane({
  direction,
  first,
  second,
  defaultSize,
  minSize = 120,
  minSecondSize = 120,
  storageKey,
  className,
  active = true,
}: SplitPaneProps) {
  const horizontal = direction === "horizontal";
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => readStoredSize(storageKey, defaultSize));
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ pos: number; size: number } | null>(null);

  function clamp(value: number): number {
    const el = containerRef.current;
    const total = el ? (horizontal ? el.clientWidth : el.clientHeight) : Infinity;
    const max = Math.max(minSize, total - minSecondSize - DIVIDER_SIZE);
    return Math.min(Math.max(value, minSize), max);
  }

  // Re-clamp whenever the container becomes visible or its own box changes size. Skipping this
  // while `!active` (see the `active` prop doc) avoids measuring a `display: none` box as 0 and
  // getting stuck there; re-running when `active` flips true re-measures the instant it's shown.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !active) return;
    setSize((s) => clamp(s));
    const observer = new ResizeObserver(() => {
      setSize((s) => clamp(s));
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // A mousemove during drag can wander over arbitrary text elsewhere on the page (the divider
  // itself has nothing to select, but the pointer does cross panes) — the browser's default
  // text-selection-while-dragging kicks in unless selection is suppressed for the duration.
  useLayoutEffect(() => {
    if (!dragging) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    function onMove(e: MouseEvent) {
      if (!dragStart.current) return;
      const pos = horizontal ? e.clientX : e.clientY;
      setSize(clamp(dragStart.current.size + (pos - dragStart.current.pos)));
    }
    function onUp() {
      dragStart.current = null;
      setDragging(false);
      setSize((s) => {
        writeStoredSize(storageKey, s);
        return s;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = previousUserSelect;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  function onDividerMouseDown(e: ReactMouseEvent) {
    e.preventDefault();
    dragStart.current = { pos: horizontal ? e.clientX : e.clientY, size };
    setDragging(true);
  }

  function onDividerDoubleClick() {
    const next = clamp(defaultSize);
    setSize(next);
    writeStoredSize(storageKey, next);
  }

  return (
    <div
      ref={containerRef}
      className={`split-pane split-${direction}${dragging ? " dragging" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="split-pane-first" style={horizontal ? { width: size } : { height: size }}>
        {first}
      </div>
      <div
        className="split-pane-divider"
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        title="Drag to resize, double-click to reset"
        onMouseDown={onDividerMouseDown}
        onDoubleClick={onDividerDoubleClick}
      />
      <div className="split-pane-second">{second}</div>
    </div>
  );
}
