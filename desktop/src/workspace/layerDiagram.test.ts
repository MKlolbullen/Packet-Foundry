import { describe, expect, it } from "vitest";
import type { Field, Layer } from "../types";
import { ROW_BITS, computeLayerDiagram } from "./layerDiagram";

let nextId = 1;
function field(name: string, start: number, len: number): Field {
  return { id: nextId++, name, range: { start_bit: start, len_bits: len }, kind: "uint" };
}
function layer(start: number, len: number, fields: Field[]): Layer {
  return { id: 999, name: "L", range: { start_bit: start, len_bits: len }, fields };
}

// An IPv4 header (layer at bit offset 112 to prove layout is layer-relative), 20 bytes = 5 rows.
function ipv4At(base: number): Layer {
  return layer(base, 160, [
    field("Version", base + 0, 4),
    field("IHL", base + 4, 4),
    field("DSCP_ECN", base + 8, 8),
    field("TotalLength", base + 16, 16),
    field("Identification", base + 32, 16),
    field("FlagsFragment", base + 48, 16),
    field("TTL", base + 64, 8),
    field("Protocol", base + 72, 8),
    field("HeaderChecksum", base + 80, 16),
    field("SrcAddr", base + 96, 32),
    field("DstAddr", base + 128, 32),
  ]);
}

describe("computeLayerDiagram", () => {
  it("tiles an IPv4 header into 5 rows regardless of the layer's absolute offset", () => {
    const rows = computeLayerDiagram(ipv4At(112))!;
    expect(rows).not.toBeNull();
    expect(rows.length).toBe(5);

    // Row 0: Version | IHL | DSCP_ECN | TotalLength.
    const r0 = rows[0].segments;
    expect(r0.map((s) => s.field?.name)).toEqual(["Version", "IHL", "DSCP_ECN", "TotalLength"]);
    expect(r0.map((s) => [s.colStart, s.colSpan])).toEqual([
      [0, 4],
      [4, 4],
      [8, 8],
      [16, 16],
    ]);
    expect(r0.every((s) => s.isLead)).toBe(true);

    // A 32-bit address fills a whole row in one segment.
    expect(rows[3].segments).toHaveLength(1);
    expect(rows[3].segments[0].field?.name).toBe("SrcAddr");
    expect(rows[3].segments[0].colSpan).toBe(ROW_BITS);
  });

  it("splits a field that crosses a row boundary into lead + continuation segments", () => {
    // One 48-bit field (e.g. a MAC) starting at bit 16 spans into the next row.
    const rows = computeLayerDiagram(layer(0, 64, [field("Mac", 16, 48)]))!;
    expect(rows.length).toBe(2);
    // Row 0: gap [0,16) then Mac [16,32) as the lead.
    expect(rows[0].segments.map((s) => [s.field?.name, s.colStart, s.colSpan, s.isLead])).toEqual([
      [undefined, 0, 16, false],
      ["Mac", 16, 16, true],
    ]);
    // Row 1: Mac continues [0,32), not a lead.
    expect(rows[1].segments).toEqual([{ field: rows[1].segments[0].field, colStart: 0, colSpan: 32, isLead: false }]);
    expect(rows[1].segments[0].field?.name).toBe("Mac");
  });

  it("emits a gap segment for unfielded bits (e.g. reserved space)", () => {
    const rows = computeLayerDiagram(layer(0, 32, [field("A", 0, 8), field("B", 16, 8)]))!;
    const names = rows[0].segments.map((s) => s.field?.name ?? "<gap>");
    expect(names).toEqual(["A", "<gap>", "B", "<gap>"]);
  });

  it("falls back (null) on overlapping fields", () => {
    expect(computeLayerDiagram(layer(0, 32, [field("A", 0, 16), field("B", 8, 16)]))).toBeNull();
  });

  it("falls back (null) when a field extends past the layer", () => {
    expect(computeLayerDiagram(layer(0, 16, [field("A", 0, 32)]))).toBeNull();
  });

  it("falls back (null) for a single blob field covering the whole layer (Raw payload)", () => {
    expect(computeLayerDiagram(layer(0, 400, [field("Data", 0, 400)]))).toBeNull();
  });

  it("falls back (null) for an empty layer and for one taller than the row cap", () => {
    expect(computeLayerDiagram(layer(0, 32, []))).toBeNull();
    // 8-bit field then a large gap → > 16 rows → table is better.
    expect(computeLayerDiagram(layer(0, 640, [field("A", 0, 8)]))).toBeNull();
  });
});
