// Semantic-camera navigation state: what the workspace is currently focused on, and how it got
// there. Pure — no React — mirroring the style of ../operation.ts. See ../Viewport.tsx for the
// (exported) `Transform` shape reused here for per-target viewport memory.
import type { BitRange, Field, Layer, PacketDocument } from "../types";
import type { Transform } from "../Viewport";

export type FocusAxis = "structure" | "computation" | "flow";

/**
 * What the camera is looking at. `layerId`/`fieldId` are always `String(node.id)` — the
 * stringified numeric `NodeId` from the Rust side — chosen so a `FocusTarget` can double as a
 * React key / dict key without extra coercion at every use site.
 *
 * Known gap (not fixed here): `operation`'s target carries no `layerId`, so a purely structural
 * rise from an operation can't locate its owning layer. Not a problem yet — nothing in this PR
 * ever dispatches a `DIVE`/`JUMP` to an `operation`, `byte`, or `bit` target; those are wired up
 * by a later PR alongside their projections.
 */
export type FocusTarget =
  | { kind: "packet" }
  | { kind: "layer"; layerId: string }
  | { kind: "field"; layerId: string; fieldId: string }
  | { kind: "byte"; byteIndex: number; ownerId?: string }
  | { kind: "bit"; bitIndex: number; ownerId?: string }
  | { kind: "operation"; fieldId: string; operationId: string };

export interface FocusSnapshot {
  axis: FocusAxis;
  target: FocusTarget;
}

export interface Selection {
  source: FocusTarget;
  range: BitRange;
}

export interface SemanticCameraState {
  axis: FocusAxis;
  target: FocusTarget;
  selectedRange?: BitRange;
  hoveredTarget?: FocusTarget;
  history: FocusSnapshot[];
  forwardHistory: FocusSnapshot[];
  viewportByTarget: Record<string, Transform>;
}

export type FocusAction =
  | { type: "DIVE"; target: FocusTarget }
  | { type: "RISE" }
  | { type: "JUMP"; target: FocusTarget }
  | { type: "BACK" }
  | { type: "FORWARD" }
  | { type: "SET_AXIS"; axis: FocusAxis }
  | { type: "SELECT_RANGE"; range?: BitRange };

export const INITIAL_FOCUS_STATE: SemanticCameraState = {
  axis: "structure",
  target: { kind: "packet" },
  history: [],
  forwardHistory: [],
  viewportByTarget: {},
};

/** Stable string key for React list keys / `viewportByTarget` lookups. */
export function targetKey(target: FocusTarget): string {
  switch (target.kind) {
    case "packet":
      return "packet";
    case "layer":
      return `layer:${target.layerId}`;
    case "field":
      return `field:${target.layerId}:${target.fieldId}`;
    case "byte":
      return `byte:${target.byteIndex}`;
    case "bit":
      return `bit:${target.bitIndex}`;
    case "operation":
      return `operation:${target.fieldId}:${target.operationId}`;
  }
}

export function findLayer(doc: PacketDocument, layerId: string): Layer | undefined {
  return doc.layers.find((l) => String(l.id) === layerId);
}

export function findField(doc: PacketDocument, layerId: string, fieldId: string): Field | undefined {
  return findLayer(doc, layerId)?.fields.find((f) => String(f.id) === fieldId);
}

/** Human label for breadcrumbs / outline rows. */
export function describeTarget(doc: PacketDocument, target: FocusTarget): string {
  switch (target.kind) {
    case "packet":
      return "Packet";
    case "layer":
      return findLayer(doc, target.layerId)?.name ?? "Unknown layer";
    case "field":
      return findField(doc, target.layerId, target.fieldId)?.name ?? "Unknown field";
    case "byte":
      return `Byte ${target.byteIndex}`;
    case "bit":
      return `Bit ${target.bitIndex}`;
    case "operation":
      return "Operation";
  }
}

/** The structural parent of a target, or `null` at the root (packet) or for kinds this PR never
 * reaches (byte/bit/operation dive isn't wired up yet). */
function structuralParent(target: FocusTarget): FocusTarget | null {
  switch (target.kind) {
    case "packet":
      return null;
    case "layer":
      return { kind: "packet" };
    case "field":
      return { kind: "layer", layerId: target.layerId };
    case "byte":
    case "bit":
    case "operation":
      return null;
  }
}

/** The chain of ancestors from the packet root down to (and including) `target` — e.g.
 * `[packet, layer, field]` — for breadcrumbs and outline highlighting. */
export function ancestorChain(target: FocusTarget): FocusTarget[] {
  const chain: FocusTarget[] = [target];
  let current = target;
  for (;;) {
    const parent = structuralParent(current);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

function navigate(state: SemanticCameraState, target: FocusTarget): SemanticCameraState {
  return {
    ...state,
    target,
    history: [...state.history, { axis: state.axis, target: state.target }],
    forwardHistory: [],
    selectedRange: undefined,
    hoveredTarget: undefined,
  };
}

export function focusReducer(state: SemanticCameraState, action: FocusAction): SemanticCameraState {
  switch (action.type) {
    case "DIVE":
      return navigate(state, action.target);
    case "JUMP":
      // Same reducer behavior as DIVE today — kept as a distinct action so callers (breadcrumb/
      // outline clicks vs. stage double-clicks) can express intent for later PRs (e.g. distinct
      // animations).
      return navigate(state, action.target);
    case "RISE": {
      const parent = structuralParent(state.target);
      return parent ? navigate(state, parent) : state;
    }
    case "BACK": {
      if (state.history.length === 0) return state;
      const previous = state.history[state.history.length - 1];
      return {
        ...state,
        axis: previous.axis,
        target: previous.target,
        history: state.history.slice(0, -1),
        forwardHistory: [...state.forwardHistory, { axis: state.axis, target: state.target }],
        selectedRange: undefined,
        hoveredTarget: undefined,
      };
    }
    case "FORWARD": {
      if (state.forwardHistory.length === 0) return state;
      const next = state.forwardHistory[state.forwardHistory.length - 1];
      return {
        ...state,
        axis: next.axis,
        target: next.target,
        forwardHistory: state.forwardHistory.slice(0, -1),
        history: [...state.history, { axis: state.axis, target: state.target }],
        selectedRange: undefined,
        hoveredTarget: undefined,
      };
    }
    case "SET_AXIS":
      return { ...state, axis: action.axis };
    case "SELECT_RANGE":
      return { ...state, selectedRange: action.range };
  }
}
