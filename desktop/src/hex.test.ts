import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, hexToBytesArray } from "./hex";

describe("bytesToHex / hexToBytesArray", () => {
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

  it("accepts an empty string as a legitimately empty buffer", () => {
    expect(hexToBytesArray("")).toEqual([]);
  });
});

describe("hexToBytes", () => {
  it("round-trips bytes through hex", () => {
    expect(hexToBytes("deadbeef")).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(hexToBytes(" DE AD be EF ")).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("returns null (not zero-filled bytes) on odd-length input", () => {
    // The bug this guards against: a bare parseInt on "c" would yield NaN -> 0, silently
    // producing a plausible-looking but wrong byte instead of failing.
    expect(hexToBytes("abc")).toBeNull();
  });

  it("returns null on non-hex characters", () => {
    expect(hexToBytes("zz")).toBeNull();
  });

  it("distinguishes a malformed buffer (null) from a legitimately empty one ([])", () => {
    expect(hexToBytes("")).toEqual(new Uint8Array(0));
    expect(hexToBytes("")).not.toBeNull();
  });
});
