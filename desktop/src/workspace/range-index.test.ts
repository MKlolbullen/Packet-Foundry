import { describe, expect, it } from "vitest";
import { overlaps, rangeOfTarget } from "./range-index";
import type { PacketDocument } from "../types";

describe("overlaps", () => {
  it("disjoint ranges do not overlap", () => {
    expect(overlaps({ start_bit: 0, len_bits: 8 }, { start_bit: 16, len_bits: 8 })).toBe(false);
  });

  it("adjacent-but-not-touching ranges do not overlap", () => {
    expect(overlaps({ start_bit: 0, len_bits: 8 }, { start_bit: 8, len_bits: 8 })).toBe(false);
  });

  it("partially overlapping ranges overlap", () => {
    expect(overlaps({ start_bit: 0, len_bits: 8 }, { start_bit: 4, len_bits: 8 })).toBe(true);
  });

  it("one range containing the other overlaps", () => {
    expect(overlaps({ start_bit: 0, len_bits: 32 }, { start_bit: 8, len_bits: 8 })).toBe(true);
    expect(overlaps({ start_bit: 8, len_bits: 8 }, { start_bit: 0, len_bits: 32 })).toBe(true);
  });

  it("identical ranges overlap", () => {
    expect(overlaps({ start_bit: 4, len_bits: 12 }, { start_bit: 4, len_bits: 12 })).toBe(true);
  });

  it("a zero-length range never overlaps anything", () => {
    expect(overlaps({ start_bit: 4, len_bits: 0 }, { start_bit: 0, len_bits: 32 })).toBe(false);
    expect(overlaps({ start_bit: 4, len_bits: 0 }, { start_bit: 4, len_bits: 0 })).toBe(false);
  });
});

const DOC: PacketDocument = {
  version: 1,
  buffer: "45000073",
  layers: [
    {
      id: 1,
      name: "IPv4",
      range: { start_bit: 0, len_bits: 32 },
      fields: [{ id: 2, name: "Version", range: { start_bit: 0, len_bits: 4 }, kind: "uint" }],
    },
  ],
  diagnostics: [],
};

describe("rangeOfTarget", () => {
  it("packet resolves to the whole decoded buffer", () => {
    expect(rangeOfTarget(DOC, { kind: "packet" })).toEqual({ start_bit: 0, len_bits: 32 });
  });

  it("an empty buffer's packet range is undefined", () => {
    expect(rangeOfTarget({ ...DOC, buffer: "" }, { kind: "packet" })).toBeUndefined();
  });

  it("layer resolves to that layer's range", () => {
    expect(rangeOfTarget(DOC, { kind: "layer", layerId: "1" })).toEqual({ start_bit: 0, len_bits: 32 });
  });

  it("field resolves to that field's range", () => {
    expect(rangeOfTarget(DOC, { kind: "field", layerId: "1", fieldId: "2" })).toEqual({
      start_bit: 0,
      len_bits: 4,
    });
  });

  it("an unknown layer/field id resolves to undefined", () => {
    expect(rangeOfTarget(DOC, { kind: "layer", layerId: "99" })).toBeUndefined();
    expect(rangeOfTarget(DOC, { kind: "field", layerId: "1", fieldId: "99" })).toBeUndefined();
  });

  it("byte resolves to a whole-byte range at its absolute position", () => {
    expect(rangeOfTarget(DOC, { kind: "byte", byteIndex: 3 })).toEqual({ start_bit: 24, len_bits: 8 });
  });

  it("bit resolves to a single-bit range at its absolute position", () => {
    expect(rangeOfTarget(DOC, { kind: "bit", bitIndex: 26 })).toEqual({ start_bit: 26, len_bits: 1 });
  });

  it("operation has no single meaningful range", () => {
    expect(
      rangeOfTarget(DOC, { kind: "operation", layerId: "1", fieldId: "2", operationId: "root" }),
    ).toBeUndefined();
  });
});
