import { describe, expect, it } from "vitest";
import { LINKTYPE_ETHERNET, frameTimestamp } from "./pcap";
import { isPcapng, parsePcapng } from "./pcapng";

// --- little-endian pcapng block builders -----------------------------------------------------

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
function pad4(bytes: number[]): number[] {
  const rem = bytes.length % 4;
  return rem === 0 ? bytes : [...bytes, ...new Array(4 - rem).fill(0)];
}
/** Wrap a block body with its type + total-length framing (LE). */
function block(type: number, body: number[]): number[] {
  const total = 12 + pad4(body).length;
  return [...u32(type), ...u32(total), ...pad4(body), ...u32(total)];
}

function shb(): number[] {
  // byte_order_magic + version 1.0 + section_length (-1, unknown) as two -1 words.
  return block(0x0a0d0d0a, [...u32(0x1a2b3c4d), ...u16(1), ...u16(0), ...u32(0xffffffff), ...u32(0xffffffff)]);
}
function idb(linkType = LINKTYPE_ETHERNET, tsresolByte?: number): number[] {
  const opts = tsresolByte === undefined ? [] : [...u16(9), ...u16(1), ...pad4([tsresolByte]), ...u16(0), ...u16(0)];
  return block(0x00000001, [...u16(linkType), ...u16(0), ...u32(65535), ...opts]);
}
function epb(ifId: number, tsHigh: number, tsLow: number, data: number[]): number[] {
  return block(0x00000006, [
    ...u32(ifId), ...u32(tsHigh), ...u32(tsLow), ...u32(data.length), ...u32(data.length), ...pad4(data),
  ]);
}
function spb(origLen: number, data: number[]): number[] {
  return block(0x00000003, [...u32(origLen), ...pad4(data)]);
}

const FRAME_A = [0xde, 0xad, 0xbe, 0xef, 0x01];
const FRAME_B = [0x11, 0x22, 0x33];

describe("parsePcapng", () => {
  it("reads SHB + IDB + EPB frames with data and default microsecond timestamps", () => {
    const bytes = new Uint8Array([...shb(), ...idb(), ...epb(0, 0, 1_000_000, FRAME_A), ...epb(0, 0, 2_500_000, FRAME_B)]);
    const cap = parsePcapng(bytes);
    expect(cap.linkType).toBe(LINKTYPE_ETHERNET);
    expect(cap.nanos).toBe(false);
    expect(cap.frames).toHaveLength(2);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME_A);
    expect(cap.frames[0]).toMatchObject({ index: 0, capLen: 5, origLen: 5 });
    // 1_000_000 ticks at 10^-6 s = 1.0 s.
    expect(frameTimestamp(cap.frames[0], cap.nanos)).toBeCloseTo(1.0, 6);
    expect(frameTimestamp(cap.frames[1], cap.nanos)).toBeCloseTo(2.5, 6);
    expect(Array.from(cap.frames[1].data)).toEqual(FRAME_B);
  });

  it("honours a nanosecond if_tsresol option", () => {
    // tsresol byte 9 → 10^-9 s; 500_000_000 low ticks = 0.5 s.
    const bytes = new Uint8Array([...shb(), ...idb(LINKTYPE_ETHERNET, 9), ...epb(0, 0, 500_000_000, FRAME_A)]);
    const cap = parsePcapng(bytes);
    expect(frameTimestamp(cap.frames[0], cap.nanos)).toBeCloseTo(0.5, 6);
  });

  it("reads a Simple Packet Block using the block length for the data", () => {
    const bytes = new Uint8Array([...shb(), ...idb(), ...spb(FRAME_A.length, FRAME_A)]);
    const cap = parsePcapng(bytes);
    expect(cap.frames).toHaveLength(1);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME_A);
    expect(cap.frames[0].origLen).toBe(FRAME_A.length);
  });

  it("exposes a non-Ethernet interface link type", () => {
    const bytes = new Uint8Array([...shb(), ...idb(113), ...epb(0, 0, 0, FRAME_A)]);
    expect(parsePcapng(bytes).linkType).toBe(113);
  });

  it("skips unknown block types by their declared length", () => {
    const junk = block(0x0badf00d, [1, 2, 3, 4, 5, 6, 7, 8]);
    const bytes = new Uint8Array([...shb(), ...idb(), ...junk, ...epb(0, 0, 0, FRAME_B)]);
    const cap = parsePcapng(bytes);
    expect(cap.frames).toHaveLength(1);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME_B);
  });

  it("reads a big-endian section", () => {
    // Hand-build a BE SHB + IDB + EPB by byte-swapping the 32/16-bit fields.
    const u32be = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    const u16be = (v: number) => [(v >>> 8) & 0xff, v & 0xff];
    const blockBE = (type: number, body: number[]) => {
      const total = 12 + (body.length % 4 === 0 ? body.length : body.length + (4 - (body.length % 4)));
      const padded = body.length % 4 === 0 ? body : [...body, ...new Array(4 - (body.length % 4)).fill(0)];
      return [...u32be(type), ...u32be(total), ...padded, ...u32be(total)];
    };
    const shbBE = blockBE(0x0a0d0d0a, [...u32be(0x1a2b3c4d), ...u16be(1), ...u16be(0), ...u32be(0xffffffff), ...u32be(0xffffffff)]);
    const idbBE = blockBE(0x00000001, [...u16be(1), ...u16be(0), ...u32be(65535)]);
    const epbBE = blockBE(0x00000006, [...u32be(0), ...u32be(0), ...u32be(0), ...u32be(FRAME_A.length), ...u32be(FRAME_A.length), ...FRAME_A, 0, 0, 0]);
    const cap = parsePcapng(new Uint8Array([...shbBE, ...idbBE, ...epbBE]));
    expect(cap.frames).toHaveLength(1);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME_A);
  });

  it("stops cleanly on a block that runs past the buffer", () => {
    const good = [...shb(), ...idb(), ...epb(0, 0, 0, FRAME_A)];
    // A trailing block claiming length 400 with only a few bytes present.
    const bytes = new Uint8Array([...good, ...u32(6), ...u32(400), 0, 0, 0, 0]);
    const cap = parsePcapng(bytes);
    expect(cap.frames).toHaveLength(1);
    expect(cap.truncated).toBe(true);
  });

  it("throws when the section header block is missing", () => {
    expect(() => parsePcapng(new Uint8Array([...idb(), ...epb(0, 0, 0, FRAME_A)]))).toThrow(/section header/);
  });

  it("detects the format via isPcapng", () => {
    expect(isPcapng(new Uint8Array([0x0a, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0]))).toBe(true);
    expect(isPcapng(new Uint8Array([0xd4, 0xc3, 0xb2, 0xa1]))).toBe(false);
  });
});
