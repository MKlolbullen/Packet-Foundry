import { describe, expect, it } from "vitest";
import {
  hasStructuredEditor,
  parseStructuredValue,
  structuredDraftFor,
  structuredErrorMessage,
  structuredPlaceholder,
} from "./fieldEdit";
import type { Field, PacketDocument } from "../types";

function docWithField(buffer: string, field: Field): PacketDocument {
  return {
    version: 1,
    buffer,
    layers: [{ id: 1, name: "L", range: { start_bit: 0, len_bits: buffer.length * 4 }, fields: [field] }],
    diagnostics: [],
  };
}

describe("hasStructuredEditor", () => {
  it("is true for every kind except bytes", () => {
    expect(hasStructuredEditor("uint")).toBe(true);
    expect(hasStructuredEditor("flags")).toBe(true);
    expect(hasStructuredEditor("mac_addr")).toBe(true);
    expect(hasStructuredEditor("ipv4_addr")).toBe(true);
    expect(hasStructuredEditor("bytes")).toBe(false);
  });
});

describe("structuredPlaceholder / structuredErrorMessage", () => {
  it("returns a non-empty hint for every structured kind", () => {
    for (const kind of ["uint", "flags", "mac_addr", "ipv4_addr"] as const) {
      expect(structuredPlaceholder(kind).length).toBeGreaterThan(0);
      expect(structuredErrorMessage(kind).length).toBeGreaterThan(0);
    }
  });
});

describe("structuredDraftFor / parseStructuredValue round-trips", () => {
  it("uint: seeds a decimal draft that parses back to the same bytes", () => {
    const field: Field = { id: 2, name: "TTL", range: { start_bit: 0, len_bits: 8 }, kind: "uint" };
    const doc = docWithField("2a", field);
    const draft = structuredDraftFor(doc, field);
    expect(draft).toBe("42");
    expect(parseStructuredValue("uint", draft, 1)).toEqual(new Uint8Array([0x2a]));
  });

  it("flags: seeds a zero-padded 0x-hex draft matching formatFieldValue's own padding", () => {
    const field: Field = { id: 2, name: "Flags", range: { start_bit: 0, len_bits: 8 }, kind: "flags" };
    const doc = docWithField("01", field);
    expect(structuredDraftFor(doc, field)).toBe("0x01");
    expect(parseStructuredValue("flags", "0x01", 1)).toEqual(new Uint8Array([0x01]));
    expect(parseStructuredValue("flags", "01", 1)).toEqual(new Uint8Array([0x01]));
  });

  it("mac_addr: seeds colon-hex and round-trips", () => {
    const field: Field = { id: 2, name: "Src", range: { start_bit: 0, len_bits: 48 }, kind: "mac_addr" };
    const doc = docWithField("aabbccddeeff", field);
    const draft = structuredDraftFor(doc, field);
    expect(draft).toBe("aa:bb:cc:dd:ee:ff");
    expect(parseStructuredValue("mac_addr", draft, 6)).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]));
  });

  it("ipv4_addr: seeds dotted-decimal and round-trips", () => {
    const field: Field = { id: 2, name: "Dst", range: { start_bit: 0, len_bits: 32 }, kind: "ipv4_addr" };
    const doc = docWithField("c0a80114", field);
    const draft = structuredDraftFor(doc, field);
    expect(draft).toBe("192.168.1.20");
    expect(parseStructuredValue("ipv4_addr", draft, 4)).toEqual(new Uint8Array([192, 168, 1, 20]));
  });

  it("returns '' for an out-of-bounds field instead of an error sentinel", () => {
    const field: Field = { id: 2, name: "Ghost", range: { start_bit: 800, len_bits: 8 }, kind: "uint" };
    const doc = docWithField("2a", field);
    expect(structuredDraftFor(doc, field)).toBe("");
  });
});

describe("parseStructuredValue validation failures", () => {
  it("uint rejects negatives, decimals, overflow, and empty input", () => {
    expect(parseStructuredValue("uint", "-1", 1)).toBeNull();
    expect(parseStructuredValue("uint", "12.5", 1)).toBeNull();
    expect(parseStructuredValue("uint", "256", 1)).toBeNull();
    expect(parseStructuredValue("uint", "", 1)).toBeNull();
    expect(parseStructuredValue("uint", "255", 1)).toEqual(new Uint8Array([255]));
  });

  it("flags rejects a bare '0x' and non-hex chars", () => {
    expect(parseStructuredValue("flags", "0x", 1)).toBeNull();
    expect(parseStructuredValue("flags", "zz", 1)).toBeNull();
    expect(parseStructuredValue("flags", "0xff", 1)).toEqual(new Uint8Array([0xff]));
  });

  it("mac_addr rejects wrong part count and bad octets", () => {
    expect(parseStructuredValue("mac_addr", "aa:bb:cc:dd:ee", 6)).toBeNull();
    expect(parseStructuredValue("mac_addr", "aa:bb:cc:dd:ee:gg", 6)).toBeNull();
  });

  it("ipv4_addr rejects wrong part count and out-of-range octets", () => {
    expect(parseStructuredValue("ipv4_addr", "192.168.1", 4)).toBeNull();
    expect(parseStructuredValue("ipv4_addr", "256.0.0.1", 4)).toBeNull();
    expect(parseStructuredValue("ipv4_addr", "007.0.0.1", 4)).toEqual(new Uint8Array([7, 0, 0, 1]));
  });

  it("bytes kind has no structured form", () => {
    expect(parseStructuredValue("bytes", "aabb", 2)).toBeNull();
  });
});
