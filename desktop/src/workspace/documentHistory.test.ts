import { describe, expect, it, vi } from "vitest";
import { INITIAL_DOCUMENT_HISTORY, documentHistoryReducer, type DocumentHistoryState } from "./documentHistory";
import type { PacketDocument } from "../types";

function doc(buffer: string): PacketDocument {
  return { version: 1, buffer, layers: [], diagnostics: [] };
}

const A = doc("aa");
const B = doc("bb");
const C = doc("cc");

describe("documentHistoryReducer", () => {
  it("SET adopts the document and resets both stacks", () => {
    const dirty: DocumentHistoryState = { current: A, undoStack: [B], redoStack: [C] };
    const next = documentHistoryReducer(dirty, { type: "SET", document: B });
    expect(next).toEqual({ current: B, undoStack: [], redoStack: [] });
  });

  it("MUTATE pushes the previous current onto undoStack and clears redoStack", () => {
    let state = documentHistoryReducer(INITIAL_DOCUMENT_HISTORY, { type: "SET", document: A });
    state = documentHistoryReducer(state, { type: "MUTATE", document: B });
    expect(state).toEqual({ current: B, undoStack: [A], redoStack: [] });
  });

  it("several MUTATEs then UNDO x2/REDO x2 round-trip to the pre-undo state", () => {
    let state = documentHistoryReducer(INITIAL_DOCUMENT_HISTORY, { type: "SET", document: A });
    state = documentHistoryReducer(state, { type: "MUTATE", document: B });
    state = documentHistoryReducer(state, { type: "MUTATE", document: C });
    expect(state).toEqual({ current: C, undoStack: [A, B], redoStack: [] });

    state = documentHistoryReducer(state, { type: "UNDO" });
    expect(state).toEqual({ current: B, undoStack: [A], redoStack: [C] });

    state = documentHistoryReducer(state, { type: "UNDO" });
    expect(state).toEqual({ current: A, undoStack: [], redoStack: [C, B] });

    const beforeRedo = state;
    state = documentHistoryReducer(state, { type: "REDO" });
    expect(state).toEqual({ current: B, undoStack: [A], redoStack: [C] });
    expect(state).not.toBe(beforeRedo);

    state = documentHistoryReducer(state, { type: "REDO" });
    expect(state).toEqual({ current: C, undoStack: [A, B], redoStack: [] });
  });

  it("UNDO on an empty undoStack is a no-op that returns the identical state reference", () => {
    const state = documentHistoryReducer(INITIAL_DOCUMENT_HISTORY, { type: "SET", document: A });
    const undone = documentHistoryReducer(state, { type: "UNDO" });
    expect(undone).toBe(state);
  });

  it("REDO on an empty redoStack is a no-op that returns the identical state reference", () => {
    const state = documentHistoryReducer(INITIAL_DOCUMENT_HISTORY, { type: "SET", document: A });
    const redone = documentHistoryReducer(state, { type: "REDO" });
    expect(redone).toBe(state);
  });

  it("MUTATE after UNDO clears redoStack (a fresh edit invalidates redo)", () => {
    let state = documentHistoryReducer(INITIAL_DOCUMENT_HISTORY, { type: "SET", document: A });
    state = documentHistoryReducer(state, { type: "MUTATE", document: B });
    state = documentHistoryReducer(state, { type: "UNDO" });
    expect(state.redoStack).toEqual([B]);

    state = documentHistoryReducer(state, { type: "MUTATE", document: C });
    expect(state).toEqual({ current: C, undoStack: [A], redoStack: [] });
  });

  it("MUTATE with no current document logs an error and no-ops", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = documentHistoryReducer(INITIAL_DOCUMENT_HISTORY, { type: "MUTATE", document: A });
    expect(result).toBe(INITIAL_DOCUMENT_HISTORY);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
