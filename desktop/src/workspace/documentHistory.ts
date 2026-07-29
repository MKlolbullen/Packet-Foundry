// Undo/redo for document edits (PR3's set_field_bytes/clear_field_override, and any future
// mutation source that flows through the same onDocumentChange callback). Deliberately
// frontend-only: packet-core's EditHistory is byte-offset-patch based and doesn't understand
// override_bytes/resolve() semantics, and since the mutation Tauri commands are stateless per
// IPC call (a document arrives, gets mutated, leaves — no server-side session), it can never
// accumulate across edits without real backend session state. This reducer mirrors focus.ts's
// navigate/BACK/FORWARD shape — same push-current/clear-redo-on-new-action idiom, same
// return-the-identical-state-on-a-no-op property so useReducer bails out of the re-render.
import type { PacketDocument } from "../types";

export interface DocumentHistoryState {
  current: PacketDocument | null;
  undoStack: PacketDocument[];
  redoStack: PacketDocument[];
}

export type DocumentHistoryAction =
  | { type: "SET"; document: PacketDocument | null } // fresh assemble — resets both stacks
  | { type: "MUTATE"; document: PacketDocument } // an edit — push current, clear redo
  | { type: "UNDO" }
  | { type: "REDO" };

export const INITIAL_DOCUMENT_HISTORY: DocumentHistoryState = { current: null, undoStack: [], redoStack: [] };

// No cap on stack depth: a hand-crafted stack with a large Raw payload (protocols/raw.rs) means
// document size is caller-controlled, not "packets are always small" — an accepted trade-off for
// this PR, not an oversight.
export function documentHistoryReducer(state: DocumentHistoryState, action: DocumentHistoryAction): DocumentHistoryState {
  switch (action.type) {
    case "SET":
      return { current: action.document, undoStack: [], redoStack: [] };
    case "MUTATE": {
      if (!state.current) {
        // Unreachable in practice: MUTATE only ever fires via onDocumentChange, which only
        // FieldDetail calls, which only renders once doc is non-null. Fail loud rather than
        // silently adopting the document with no history entry, so a future caller that breaks
        // this invariant doesn't get masked.
        console.error("documentHistoryReducer: MUTATE with no current document");
        return state;
      }
      return { current: action.document, undoStack: [...state.undoStack, state.current], redoStack: [] };
    }
    case "UNDO": {
      if (state.undoStack.length === 0 || !state.current) return state;
      const previous = state.undoStack[state.undoStack.length - 1];
      return {
        current: previous,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.current],
      };
    }
    case "REDO": {
      if (state.redoStack.length === 0 || !state.current) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        current: next,
        undoStack: [...state.undoStack, state.current],
        redoStack: state.redoStack.slice(0, -1),
      };
    }
  }
}
