import { describe, expect, it } from "vitest";
import { LINKTYPE_ETHERNET, frameTimestamp, parsePcap } from "./pcap";

// --- helpers to hand-build a classic pcap byte buffer -------------------------------------------

function u32(value: number, little: boolean): number[] {
  const b = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  return little ? b.reverse() : b;
}

function u16(value: number, little: boolean): number[] {
  const b = [(value >>> 8) & 0xff, value & 0xff];
  return little ? b.reverse() : b;
}

const MAGIC = {
  beMicro: [0xa1, 0xb2, 0xc3, 0xd4],
  leMicro: [0xd4, 0xc3, 0xb2, 0xa1],
  beNano: [0xa1, 0xb2, 0x3c, 0x4d],
  leNano: [0x4d, 0x3c, 0xb2, 0xa1],
};

function globalHeader(magic: number[], little: boolean, linkType = LINKTYPE_ETHERNET): number[] {
  return [
    ...magic, // magic (4)
    ...u16(2, little), // version_major (2)
    ...u16(4, little), // version_minor (2)
    ...u32(0, little), // thiszone (4)
    ...u32(0, little), // sigfigs (4)
    ...u32(65535, little), // snaplen (4)
    ...u32(linkType, little), // network / linktype (4) — ends at offset 24
  ];
}

function record(tsSec: number, tsFrac: number, data: number[], little: boolean): number[] {
  return [
    ...u32(tsSec, little),
    ...u32(tsFrac, little),
    ...u32(data.length, little), // incl_len
    ...u32(data.length, little), // orig_len
    ...data,
  ];
}

const FRAME_A = [0xde, 0xad, 0xbe, 0xef];
const FRAME_B = [0x01, 0x02, 0x03];

describe("parsePcap", () => {
  it("reads little-endian microsecond captures with multiple frames", () => {
    const bytes = new Uint8Array([
      ...globalHeader(MAGIC.leMicro, true),
      ...record(100, 500000, FRAME_A, true),
      ...record(101, 250000, FRAME_B, true),
    ]);
    const cap = parsePcap(bytes);
    expect(cap.linkType).toBe(LINKTYPE_ETHERNET);
    expect(cap.nanos).toBe(false);
    expect(cap.truncated).toBe(false);
    expect(cap.frames).toHaveLength(2);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME_A);
    expect(cap.frames[0]).toMatchObject({ index: 0, tsSecs: 100, tsFrac: 500000, capLen: 4, origLen: 4 });
    expect(Array.from(cap.frames[1].data)).toEqual(FRAME_B);
    expect(cap.frames[1].index).toBe(1);
    expect(frameTimestamp(cap.frames[0], cap.nanos)).toBeCloseTo(100.5, 6);
  });

  it("reads big-endian captures identically", () => {
    const bytes = new Uint8Array([...globalHeader(MAGIC.beMicro, false), ...record(7, 1, FRAME_A, false)]);
    const cap = parsePcap(bytes);
    expect(cap.frames).toHaveLength(1);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME_A);
    expect(cap.frames[0].tsSecs).toBe(7);
  });

  it("flags nanosecond-resolution captures and scales the timestamp fraction", () => {
    const bytes = new Uint8Array([...globalHeader(MAGIC.leNano, true), ...record(5, 250000000, FRAME_A, true)]);
    const cap = parsePcap(bytes);
    expect(cap.nanos).toBe(true);
    expect(frameTimestamp(cap.frames[0], cap.nanos)).toBeCloseTo(5.25, 6);
  });

  it("exposes a non-Ethernet link type without rejecting the file", () => {
    const bytes = new Uint8Array([...globalHeader(MAGIC.leMicro, true, 113), ...record(0, 0, FRAME_A, true)]);
    const cap = parsePcap(bytes);
    expect(cap.linkType).toBe(113);
    expect(cap.frames).toHaveLength(1);
  });

  it("stops cleanly on a truncated final record, keeping earlier frames", () => {
    const good = record(1, 0, FRAME_A, true);
    // A second record header claiming 9 captured bytes but with only 2 present.
    const truncatedTail = [...u32(2, true), ...u32(0, true), ...u32(9, true), ...u32(9, true), 0xaa, 0xbb];
    const bytes = new Uint8Array([...globalHeader(MAGIC.leMicro, true), ...good, ...truncatedTail]);
    const cap = parsePcap(bytes);
    expect(cap.frames).toHaveLength(1);
    expect(cap.truncated).toBe(true);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME_A);
  });

  it("throws on an unrecognized magic number (e.g. pcapng)", () => {
    const bytes = new Uint8Array([0x0a, 0x0d, 0x0d, 0x0a, ...new Array(20).fill(0)]);
    expect(() => parsePcap(bytes)).toThrow(/not a pcap file/);
  });

  it("throws on a buffer too short to hold the global header", () => {
    expect(() => parsePcap(new Uint8Array([0xd4, 0xc3, 0xb2, 0xa1]))).toThrow(/shorter than/);
  });

  it("treats a header with no records as an empty capture", () => {
    const cap = parsePcap(new Uint8Array(globalHeader(MAGIC.leMicro, true)));
    expect(cap.frames).toHaveLength(0);
    expect(cap.truncated).toBe(false);
  });
});
