// Packet variants/branches: named immutable snapshots of a PacketDocument. The active editing
// surface stays `docState` (documentHistory) — selecting a variant just SETs its doc into that
// surface (a fresh editing context), and saving snapshots the current working doc. Each non-base
// variant is diffed against the base with the existing engine diff. Pure reducer, mirroring the
// documentHistory/focus convention: a no-op returns the identical state reference so useReducer
// bails the re-render, and ids are supplied by the caller (never generated here).

import type { PacketDocument } from "../types";

export interface Variant {
  id: string;
  label: string;
  doc: PacketDocument;
}

export interface VariantState {
  items: Variant[];
  /** The variant everything diffs against (the first saved, until reassigned). */
  baseId: string | null;
  /** Which stored variant is currently loaded, or null when the working copy has diverged. */
  activeId: string | null;
}

export type VariantAction =
  | { type: "SAVE"; id: string; label: string; doc: PacketDocument }
  | { type: "SELECT"; id: string }
  | { type: "RENAME"; id: string; label: string }
  | { type: "DELETE"; id: string }
  | { type: "SET_BASE"; id: string }
  | { type: "UPDATE"; id: string; doc: PacketDocument };

export const INITIAL_VARIANT_STATE: VariantState = { items: [], baseId: null, activeId: null };

export function variantById(state: VariantState, id: string | null): Variant | undefined {
  return id == null ? undefined : state.items.find((v) => v.id === id);
}

export function variantsReducer(state: VariantState, action: VariantAction): VariantState {
  switch (action.type) {
    case "SAVE": {
      const items = [...state.items, { id: action.id, label: action.label, doc: action.doc }];
      // The first saved variant becomes the base; a later save just becomes the active one.
      const baseId = state.items.length === 0 ? action.id : state.baseId;
      return { items, baseId, activeId: action.id };
    }
    case "SELECT":
      if (state.activeId === action.id || !state.items.some((v) => v.id === action.id)) return state;
      return { ...state, activeId: action.id };
    case "RENAME": {
      const target = state.items.find((v) => v.id === action.id);
      if (!target || target.label === action.label) return state;
      return { ...state, items: state.items.map((v) => (v.id === action.id ? { ...v, label: action.label } : v)) };
    }
    case "SET_BASE":
      if (state.baseId === action.id || !state.items.some((v) => v.id === action.id)) return state;
      return { ...state, baseId: action.id };
    case "UPDATE": {
      if (!state.items.some((v) => v.id === action.id)) return state;
      return { ...state, items: state.items.map((v) => (v.id === action.id ? { ...v, doc: action.doc } : v)) };
    }
    case "DELETE": {
      if (!state.items.some((v) => v.id === action.id)) return state;
      const items = state.items.filter((v) => v.id !== action.id);
      // Reassign the base to the first remaining variant (or null); never auto-load a document on
      // delete — leave whatever is on screen as an unsaved working copy (activeId → null).
      const baseId = state.baseId === action.id ? (items[0]?.id ?? null) : state.baseId;
      const activeId = state.activeId === action.id ? null : state.activeId;
      return { items, baseId, activeId };
    }
  }
}
