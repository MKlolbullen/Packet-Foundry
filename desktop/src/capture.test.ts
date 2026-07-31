import { describe, expect, it } from "vitest";
import { parseCapture } from "./capture";
import { LINKTYPE_ETHERNET } from "./pcap";

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

// Minimal classic little-endian pcap: global header + one 4-byte frame.
function classicPcap(frame: number[]): Uint8Array {
  return new Uint8Array([
    0xd4, 0xc3, 0xb2, 0xa1, ...u16(2), ...u16(4), ...u32(0), ...u32(0), ...u32(65535), ...u32(1),
    ...u32(1), ...u32(0), ...u32(frame.length), ...u32(frame.length), ...frame,
  ]);
}

// Minimal little-endian pcapng: SHB + IDB + EPB with one frame.
function pcapng(frame: number[]): Uint8Array {
  const block = (type: number, body: number[]) => {
    const total = 12 + body.length;
    return [...u32(type), ...u32(total), ...body, ...u32(total)];
  };
  const shb = block(0x0a0d0d0a, [...u32(0x1a2b3c4d), ...u16(1), ...u16(0), ...u32(0xffffffff), ...u32(0xffffffff)]);
  const idb = block(0x00000001, [...u16(1), ...u16(0), ...u32(65535)]);
  const epb = block(0x00000006, [...u32(0), ...u32(0), ...u32(0), ...u32(frame.length), ...u32(frame.length), ...frame]);
  return new Uint8Array([...shb, ...idb, ...epb]);
}

const FRAME = [0xaa, 0xbb, 0xcc, 0xdd];

describe("parseCapture", () => {
  it("routes a classic .pcap file to the classic reader", () => {
    const cap = parseCapture(classicPcap(FRAME));
    expect(cap.linkType).toBe(LINKTYPE_ETHERNET);
    expect(cap.frames).toHaveLength(1);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME);
  });

  it("routes a .pcapng file to the pcapng reader", () => {
    const cap = parseCapture(pcapng(FRAME));
    expect(cap.linkType).toBe(LINKTYPE_ETHERNET);
    expect(cap.frames).toHaveLength(1);
    expect(Array.from(cap.frames[0].data)).toEqual(FRAME);
  });
});
