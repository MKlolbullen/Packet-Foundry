import { describe, expect, it } from "vitest";
import {
  EVALUABLE_KINDS,
  type Operation,
  RESERVED_KINDS,
  bytesToHex,
  childLabels,
  defaultOperation,
  getAtPath,
  getChildren,
  hexToBytesArray,
  insertAtPath,
  isReserved,
  moveListItem,
  opKind,
  removeAtPath,
  setAtPath,
  setChildren,
} from "./operation";

const C = (n: number): Operation => ({ Const: [n] });

describe("defaultOperation", () => {
  it("produces a structurally sound instance for every evaluable kind", () => {
    for (const kind of EVALUABLE_KINDS) {
      const op = defaultOperation(kind);
      expect(opKind(op)).toBe(kind);
      expect(isReserved(op)).toBe(false);
    }
  });

  it("produces a structurally sound instance for every reserved kind", () => {
    for (const kind of RESERVED_KINDS) {
      const op = defaultOperation(kind);
      expect(opKind(op)).toBe(kind);
      expect(isReserved(op)).toBe(true);
    }
  });

  it("gives fixed-arity kinds exactly as many children as their labels", () => {
    for (const kind of [...EVALUABLE_KINDS, ...RESERVED_KINDS]) {
      const op = defaultOperation(kind);
      const labels = childLabels(op);
      if (Array.isArray(labels)) {
        expect(getChildren(op)).toHaveLength(labels.length);
      }
    }
  });
});

describe("getChildren / setChildren round-trip", () => {
  it("round-trips a two-operand kind (Xor)", () => {
    const op: Operation = { Xor: [C(1), C(2)] };
    const children = getChildren(op);
    expect(children).toEqual([C(1), C(2)]);
    expect(setChildren(op, [C(3), C(4)])).toEqual({ Xor: [C(3), C(4)] });
  });

  it("round-trips a single-child kind (Not) without disturbing sibling data", () => {
    const op: Operation = { Not: C(1) };
    expect(getChildren(op)).toEqual([C(1)]);
    expect(setChildren(op, [C(9)])).toEqual({ Not: C(9) });
  });

  it("preserves the scalar bits param when replacing Shl's child", () => {
    const op: Operation = { Shl: [C(1), 7] };
    expect(getChildren(op)).toEqual([C(1)]);
    expect(setChildren(op, [C(9)])).toEqual({ Shl: [C(9), 7] });
  });

  it("preserves the Composite name when replacing its body", () => {
    const op: Operation = { Composite: { name: "checksum", body: C(1) } };
    expect(getChildren(op)).toEqual([C(1)]);
    expect(setChildren(op, [C(2)])).toEqual({ Composite: { name: "checksum", body: C(2) } });
  });

  it("round-trips a list kind (Concat) at any length", () => {
    const op: Operation = { Concat: [C(1), C(2), C(3)] };
    expect(getChildren(op)).toEqual([C(1), C(2), C(3)]);
    expect(setChildren(op, [])).toEqual({ Concat: [] });
    expect(setChildren(op, [C(9)])).toEqual({ Concat: [C(9)] });
  });

  it("round-trips If's three named branches in order", () => {
    const op: Operation = { If: { cond: C(1), then_branch: C(2), else_branch: C(3) } };
    expect(getChildren(op)).toEqual([C(1), C(2), C(3)]);
    expect(setChildren(op, [C(4), C(5), C(6)])).toEqual({
      If: { cond: C(4), then_branch: C(5), else_branch: C(6) },
    });
  });

  it("returns no children for pure leaves", () => {
    expect(getChildren({ Const: [1, 2] })).toEqual([]);
    expect(getChildren({ ReadRange: { start_bit: 0, len_bits: 8 } })).toEqual([]);
    expect(getChildren({ ReadFrom: { from_byte: 0 } })).toEqual([]);
    expect(getChildren({ ByteLength: { from_byte: 0, width: 2 } })).toEqual([]);
    expect(getChildren({ Call: { name: "f" } })).toEqual([]);
  });
});

describe("path addressing", () => {
  // Concat[ Xor[Const(1), Const(2)], Const(3) ]
  const tree: Operation = { Concat: [{ Xor: [C(1), C(2)] }, C(3)] };

  it("reads a nested node by path", () => {
    expect(getAtPath(tree, [])).toEqual(tree);
    expect(getAtPath(tree, [0])).toEqual({ Xor: [C(1), C(2)] });
    expect(getAtPath(tree, [0, 1])).toEqual(C(2));
    expect(getAtPath(tree, [1])).toEqual(C(3));
  });

  it("replaces the root wholesale when path is empty", () => {
    expect(setAtPath(tree, [], C(42))).toEqual(C(42));
  });

  it("replaces a deeply nested node while leaving siblings untouched", () => {
    const updated = setAtPath(tree, [0, 1], C(99));
    expect(updated).toEqual({ Concat: [{ Xor: [C(1), C(99)] }, C(3)] });
    // original tree is untouched (functional update)
    expect(tree).toEqual({ Concat: [{ Xor: [C(1), C(2)] }, C(3)] });
  });

  it("removes a list item and shifts the rest", () => {
    const updated = removeAtPath(tree, [1]);
    expect(updated).toEqual({ Concat: [{ Xor: [C(1), C(2)] }] });
  });

  it("removing a nested fixed-slot's list ancestor works through multiple levels", () => {
    const nested: Operation = { Concat: [{ Concat: [C(1), C(2), C(3)] }] };
    expect(removeAtPath(nested, [0, 1])).toEqual({ Concat: [{ Concat: [C(1), C(3)] }] });
  });

  it("throws when asked to remove the root", () => {
    expect(() => removeAtPath(tree, [])).toThrow();
  });

  it("inserts at an arbitrary index in a list", () => {
    const updated = insertAtPath(tree, [], 1, C(7));
    expect(updated).toEqual({ Concat: [{ Xor: [C(1), C(2)] }, C(7), C(3)] });
  });

  it("appends when index equals the current length", () => {
    const updated = insertAtPath(tree, [], 2, C(7));
    expect(updated).toEqual({ Concat: [{ Xor: [C(1), C(2)] }, C(3), C(7)] });
  });
});

describe("moveListItem", () => {
  const list: Operation = { Concat: [C(1), C(2), C(3)] };

  it("swaps with the next sibling", () => {
    expect(moveListItem(list, [], 0, 1)).toEqual({ Concat: [C(2), C(1), C(3)] });
  });

  it("swaps with the previous sibling", () => {
    expect(moveListItem(list, [], 2, -1)).toEqual({ Concat: [C(1), C(3), C(2)] });
  });

  it("is a no-op past either boundary", () => {
    expect(moveListItem(list, [], 0, -1)).toEqual(list);
    expect(moveListItem(list, [], 2, 1)).toEqual(list);
  });
});

describe("hex helpers", () => {
  it("round-trips bytes through hex", () => {
    expect(bytesToHex([0xde, 0xad, 0xbe, 0xef])).toBe("deadbeef");
    expect(hexToBytesArray("deadbeef")).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(hexToBytesArray(" DE AD be EF ")).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("rejects odd-length or non-hex input", () => {
    expect(hexToBytesArray("abc")).toEqual([]);
    expect(hexToBytesArray("zz")).toEqual([]);
  });
});
