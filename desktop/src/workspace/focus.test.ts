import { describe, expect, it } from "vitest";
import {
  type FocusTarget,
  INITIAL_FOCUS_STATE,
  ancestorChain,
  describeTarget,
  focusReducer,
  targetKey,
} from "./focus";
import type { PacketDocument } from "../types";

const PACKET: FocusTarget = { kind: "packet" };
const LAYER: FocusTarget = { kind: "layer", layerId: "1" };
const FIELD: FocusTarget = { kind: "field", layerId: "1", fieldId: "2" };
const OTHER_LAYER: FocusTarget = { kind: "layer", layerId: "5" };

const DOC: PacketDocument = {
  version: 1,
  buffer: "4500",
  layers: [
    {
      id: 1,
      name: "IPv4",
      range: { start_bit: 0, len_bits: 16 },
      fields: [{ id: 2, name: "Version", range: { start_bit: 0, len_bits: 4 }, kind: "uint" }],
    },
  ],
  diagnostics: [],
};

describe("targetKey", () => {
  it("produces a distinct, stable key per FocusTarget kind", () => {
    const keys = [
      targetKey({ kind: "packet" }),
      targetKey({ kind: "layer", layerId: "1" }),
      targetKey({ kind: "field", layerId: "1", fieldId: "2" }),
      targetKey({ kind: "byte", byteIndex: 3 }),
      targetKey({ kind: "bit", bitIndex: 4 }),
      targetKey({ kind: "operation", fieldId: "2", operationId: "op1" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("describeTarget", () => {
  it("labels a known layer/field by name, and packet/byte/bit/operation generically", () => {
    expect(describeTarget(DOC, PACKET)).toBe("Packet");
    expect(describeTarget(DOC, LAYER)).toBe("IPv4");
    expect(describeTarget(DOC, FIELD)).toBe("Version");
    expect(describeTarget(DOC, { kind: "byte", byteIndex: 0 })).toBe("Byte 0");
  });

  it("falls back to a placeholder label for an id that no longer resolves", () => {
    expect(describeTarget(DOC, OTHER_LAYER)).toBe("Unknown layer");
    expect(describeTarget(DOC, { kind: "field", layerId: "1", fieldId: "99" })).toBe("Unknown field");
  });
});

describe("ancestorChain", () => {
  it("is just the packet at the root", () => {
    expect(ancestorChain(PACKET)).toEqual([PACKET]);
  });

  it("includes packet and layer for a layer target", () => {
    expect(ancestorChain(LAYER)).toEqual([PACKET, LAYER]);
  });

  it("includes packet, layer, and field for a field target", () => {
    expect(ancestorChain(FIELD)).toEqual([PACKET, LAYER, FIELD]);
  });
});

describe("focusReducer", () => {
  it("DIVE packet -> layer -> field accumulates history in order", () => {
    let state = focusReducer(INITIAL_FOCUS_STATE, { type: "DIVE", target: LAYER });
    state = focusReducer(state, { type: "DIVE", target: FIELD });
    expect(state.target).toEqual(FIELD);
    expect(state.history.map((s) => s.target)).toEqual([PACKET, LAYER]);
  });

  it("RISE walks back up one structural level at a time and no-ops at the packet root", () => {
    let state = focusReducer(INITIAL_FOCUS_STATE, { type: "DIVE", target: LAYER });
    state = focusReducer(state, { type: "DIVE", target: FIELD });

    state = focusReducer(state, { type: "RISE" });
    expect(state.target).toEqual(LAYER);

    state = focusReducer(state, { type: "RISE" });
    expect(state.target).toEqual(PACKET);

    const atRoot = focusReducer(state, { type: "RISE" });
    expect(atRoot.target).toEqual(PACKET);
    expect(atRoot).toBe(state); // no-op returns the same reference
  });

  it("several dives, then BACK x2, then FORWARD x2 round-trips exactly", () => {
    let state = INITIAL_FOCUS_STATE;
    state = focusReducer(state, { type: "DIVE", target: LAYER }); // packet -> layer
    state = focusReducer(state, { type: "DIVE", target: FIELD }); // layer -> field
    state = focusReducer(state, { type: "DIVE", target: OTHER_LAYER }); // field -> other layer (JUMP-ish)
    const afterDives = state;

    state = focusReducer(state, { type: "BACK" });
    state = focusReducer(state, { type: "BACK" });
    expect(state.target).toEqual(LAYER); // back to right after the first dive

    state = focusReducer(state, { type: "FORWARD" });
    state = focusReducer(state, { type: "FORWARD" });
    expect(state.target).toEqual(afterDives.target);
  });

  it("a new DIVE after BACK clears forwardHistory", () => {
    let state = INITIAL_FOCUS_STATE;
    state = focusReducer(state, { type: "DIVE", target: LAYER });
    state = focusReducer(state, { type: "DIVE", target: FIELD });
    state = focusReducer(state, { type: "BACK" });
    expect(state.forwardHistory.length).toBe(1);

    state = focusReducer(state, { type: "DIVE", target: OTHER_LAYER });
    expect(state.forwardHistory).toEqual([]);
  });

  it("JUMP behaves like DIVE for history bookkeeping", () => {
    const viaDive = focusReducer(INITIAL_FOCUS_STATE, { type: "DIVE", target: LAYER });
    const viaJump = focusReducer(INITIAL_FOCUS_STATE, { type: "JUMP", target: LAYER });
    expect(viaJump.target).toEqual(viaDive.target);
    expect(viaJump.history).toEqual(viaDive.history);
  });

  it("BACK/FORWARD on an empty stack is a no-op", () => {
    expect(focusReducer(INITIAL_FOCUS_STATE, { type: "BACK" })).toBe(INITIAL_FOCUS_STATE);
    expect(focusReducer(INITIAL_FOCUS_STATE, { type: "FORWARD" })).toBe(INITIAL_FOCUS_STATE);
  });

  it("SELECT_RANGE sets/clears selectedRange without touching history", () => {
    const range = { start_bit: 0, len_bits: 8 };
    const selected = focusReducer(INITIAL_FOCUS_STATE, { type: "SELECT_RANGE", range });
    expect(selected.selectedRange).toEqual(range);
    expect(selected.history).toEqual(INITIAL_FOCUS_STATE.history);

    const cleared = focusReducer(selected, { type: "SELECT_RANGE", range: undefined });
    expect(cleared.selectedRange).toBeUndefined();
  });

  it("SET_AXIS updates only the axis", () => {
    const state = focusReducer(INITIAL_FOCUS_STATE, { type: "SET_AXIS", axis: "computation" });
    expect(state.axis).toBe("computation");
    expect(state.target).toEqual(INITIAL_FOCUS_STATE.target);
    expect(state.history).toEqual(INITIAL_FOCUS_STATE.history);
  });

  it("DIVE clears any prior selection", () => {
    const selected = focusReducer(INITIAL_FOCUS_STATE, {
      type: "SELECT_RANGE",
      range: { start_bit: 0, len_bits: 8 },
    });
    const dived = focusReducer(selected, { type: "DIVE", target: LAYER });
    expect(dived.selectedRange).toBeUndefined();
  });
});
