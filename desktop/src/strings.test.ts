import { describe, expect, it } from "vitest";
import { extractStrings } from "./strings";

function b(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe("extractStrings", () => {
  it("extracts runs of at least minLen printable bytes with absolute offsets", () => {
    const bytes = b(0x00, ...ascii("hello"), 0x00, 0x01);
    expect(extractStrings(bytes)).toEqual([{ text: "hello", startByte: 1, endByte: 6 }]);
  });

  it("ignores runs shorter than minLen", () => {
    expect(extractStrings(b(...ascii("abc"), 0), { minLen: 4 })).toEqual([]);
    expect(extractStrings(b(...ascii("abcd"), 0), { minLen: 4 })).toHaveLength(1);
  });

  it("flushes a run that ends at the buffer's end", () => {
    expect(extractStrings(b(...ascii("GET /")))).toEqual([{ text: "GET /", startByte: 0, endByte: 5 }]);
  });

  it("treats 0x20 and 0x7e as printable, 0x1f and 0x7f as not", () => {
    // "  ab" (0x20 space is printable) — a 4-run.
    expect(extractStrings(b(0x20, 0x20, 0x61, 0x62))).toEqual([{ text: "  ab", startByte: 0, endByte: 4 }]);
    // 0x7f breaks the run.
    expect(extractStrings(b(...ascii("abcd"), 0x7f, ...ascii("efgh")))).toEqual([
      { text: "abcd", startByte: 0, endByte: 4 },
      { text: "efgh", startByte: 5, endByte: 9 },
    ]);
  });

  it("scans only within [start, end)", () => {
    const bytes = b(...ascii("aaaaBBBBcccc"));
    expect(extractStrings(bytes, { start: 4, end: 8 })).toEqual([{ text: "BBBB", startByte: 4, endByte: 8 }]);
  });

  it("returns nothing for all-non-printable or empty input", () => {
    expect(extractStrings(b(0, 1, 2, 3))).toEqual([]);
    expect(extractStrings(b())).toEqual([]);
  });
});
