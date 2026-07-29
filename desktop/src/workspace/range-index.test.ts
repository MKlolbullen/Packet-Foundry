import { describe, expect, it } from "vitest";
import { fieldContainingBit, overlaps, rangeOfTarget } from "./range-index";
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

describe("fieldContainingBit", () => {
  const NIBBLES: PacketDocument = {
    version: 1,
    buffer: "45ff",
    layers: [
      {
        id: 1,
        name: "IPv4",
        range: { start_bit: 0, len_bits: 16 },
        fields: [
          { id: 2, name: "Version", range: { start_bit: 0, len_bits: 4 }, kind: "uint" },
          { id: 3, name: "IHL", range: { start_bit: 4, len_bits: 4 }, kind: "uint" },
        ],
      },
    ],
    diagnostics: [],
  };

  it("finds the field containing a bit", () => {
    expect(fieldContainingBit(NIBBLES, 2)?.field.name).toBe("Version");
  });

  it("a byte spanning two fields resolves per bit", () => {
    expect(fieldContainingBit(NIBBLES, 3)?.field.name).toBe("Version");
    expect(fieldContainingBit(NIBBLES, 4)?.field.name).toBe("IHL");
  });

  it("prefers the ownerId's field when two fields overlap the bit", () => {
    const overlapping: PacketDocument = {
      ...NIBBLES,
      layers: [
        {
          id: 1,
          name: "L",
          range: { start_bit: 0, len_bits: 16 },
          fields: [
            { id: 2, name: "A", range: { start_bit: 0, len_bits: 8 }, kind: "uint" },
            { id: 3, name: "B", range: { start_bit: 4, len_bits: 8 }, kind: "uint" },
          ],
        },
      ],
    };
    expect(fieldContainingBit(overlapping, 6)?.field.name).toBe("A");
    expect(fieldContainingBit(overlapping, 6, "1:3")?.field.name).toBe("B");
  });

  it("returns null for an unfielded bit", () => {
    expect(fieldContainingBit(NIBBLES, 12)).toBeNull();
  });

  it("a garbage or stale ownerId falls back to the document-order scan", () => {
    expect(fieldContainingBit(NIBBLES, 2, "no-colons-here")?.field.name).toBe("Version");
    expect(fieldContainingBit(NIBBLES, 2, "9:9")?.field.name).toBe("Version");
    // Owner exists but doesn't contain the bit -> scan wins.
    expect(fieldContainingBit(NIBBLES, 5, "1:2")?.field.name).toBe("IHL");
  });
});
