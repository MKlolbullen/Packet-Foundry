// pcapng (.pcapng) reader — the modern, block-structured capture format tcpdump/Wireshark write by
// default. Pure and client-side like pcap.ts, and it returns the same `PcapCapture` shape so the
// frame browser and per-frame `dissect_hex` path need no changes. Timestamps (which pcapng stores
// as a 64-bit tick count at a per-interface resolution) are normalized to the microsecond model
// pcap.ts already uses, so `frameTimestamp(frame, false)` works uniformly.
//
// Handled blocks: Section Header (SHB), Interface Description (IDB), Enhanced Packet (EPB), Simple
// Packet (SPB). Every other block type is skipped by its declared length. Every read is length-
// gated — a truncated or corrupt block stops parsing cleanly rather than throwing or over-reading.

import { LINKTYPE_ETHERNET, MAX_FRAMES, type PcapCapture, type PcapFrame } from "./pcap";

const BT_SHB = 0x0a0d0d0a;
const BT_IDB = 0x00000001;
const BT_SPB = 0x00000003;
const BT_EPB = 0x00000006;
const BYTE_ORDER_MAGIC = 0x1a2b3c4d;
const OPT_IF_TSRESOL = 9;
const DEFAULT_TICKS_PER_SEC = 1_000_000n; // 10^-6 resolution, the pcapng default

/** The SHB block type reads identically in both byte orders (0a 0d 0d 0a is order-symmetric), so a
 * file starts with pcapng iff its first four bytes are these — the dispatcher's detection test. */
export function isPcapng(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x0a && bytes[1] === 0x0d && bytes[2] === 0x0d && bytes[3] === 0x0a;
}

interface Interface {
  linkType: number;
  ticksPerSec: bigint;
}

function u16(d: Uint8Array, o: number, le: boolean): number {
  return le ? d[o] | (d[o + 1] << 8) : (d[o] << 8) | d[o + 1];
}
function u32(d: Uint8Array, o: number, le: boolean): number {
  return le
    ? (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0
    : ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

/** Read the byte-order magic at `o` and return whether the section is little-endian, or null if
 * neither orientation yields the expected magic. */
function detectEndian(d: Uint8Array, o: number): boolean | null {
  if (o + 4 > d.length) return null;
  if (u32(d, o, false) === BYTE_ORDER_MAGIC) return false;
  if (u32(d, o, true) === BYTE_ORDER_MAGIC) return true;
  return null;
}

/** Scan an IDB's options for `if_tsresol` (code 9) and return ticks-per-second. The byte is a power:
 * high bit clear → 10^value, high bit set → 2^value. Defaults to microseconds when absent. */
function readTicksPerSec(d: Uint8Array, start: number, end: number, le: boolean): bigint {
  let o = start;
  while (o + 4 <= end) {
    const code = u16(d, o, le);
    const len = u16(d, o + 2, le);
    if (code === 0) break; // opt_endofopt
    if (code === OPT_IF_TSRESOL && len >= 1 && o + 4 < d.length) {
      const b = d[o + 4];
      return b & 0x80 ? 1n << BigInt(b & 0x7f) : 10n ** BigInt(b);
    }
    o += 4 + Math.ceil(len / 4) * 4; // option value is padded to a 32-bit boundary
  }
  return DEFAULT_TICKS_PER_SEC;
}

/** Normalize a 64-bit tick timestamp (high/low halves) into whole seconds + microseconds, matching
 * pcap.ts's microsecond model. BigInt throughout so nanosecond-resolution captures don't lose
 * precision the way a 2^53-capped double would. */
function normalizeTimestamp(high: number, low: number, ticksPerSec: bigint): { tsSecs: number; tsFrac: number } {
  const raw = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
  const tsSecs = Number(raw / ticksPerSec);
  const tsFrac = Number(((raw % ticksPerSec) * 1_000_000n) / ticksPerSec);
  return { tsSecs, tsFrac };
}

/** Parse a pcapng file. Throws if it isn't one (no leading SHB, or a bad byte-order magic); a block
 * that runs past the end of the buffer stops parsing with `truncated: true`, never an error. */
export function parsePcapng(bytes: Uint8Array): PcapCapture {
  if (!isPcapng(bytes)) throw new Error("not a pcapng file: missing section header block");
  let little = detectEndian(bytes, 8);
  if (little === null) throw new Error("not a pcapng file: bad byte-order magic");

  let interfaces: Interface[] = [];
  let firstLinkType: number | null = null;
  const frames: PcapFrame[] = [];
  let off = 0;
  let truncated = false;
  let capped = false;
  let index = 0;

  while (off + 12 <= bytes.length) {
    const blockType = u32(bytes, off, little);
    const totalLen = u32(bytes, off + 4, little);
    // block_total_length includes the 12-byte frame and is 32-bit aligned; anything else is corrupt.
    if (totalLen < 12 || totalLen % 4 !== 0 || off + totalLen > bytes.length) {
      truncated = true;
      break;
    }
    const body = off + 8;
    const bodyEnd = off + totalLen - 4; // options/data end before the trailing block_total_length

    if (blockType === BT_SHB) {
      // A new section can re-declare byte order and its own interfaces.
      const e = detectEndian(bytes, body);
      if (e !== null) little = e;
      interfaces = [];
    } else if (blockType === BT_IDB && body + 8 <= bodyEnd) {
      const linkType = u16(bytes, body, little);
      const ticksPerSec = readTicksPerSec(bytes, body + 8, bodyEnd, little);
      interfaces.push({ linkType, ticksPerSec });
      if (firstLinkType === null) firstLinkType = linkType;
    } else if (blockType === BT_EPB && body + 20 <= bodyEnd) {
      const ifaceId = u32(bytes, body, little);
      const tsHigh = u32(bytes, body + 4, little);
      const tsLow = u32(bytes, body + 8, little);
      const capLen = u32(bytes, body + 12, little);
      const origLen = u32(bytes, body + 16, little);
      const dataStart = body + 20;
      if (dataStart + capLen <= bodyEnd) {
        if (frames.length >= MAX_FRAMES) {
          capped = true;
          break;
        }
        const iface = interfaces[ifaceId];
        const { tsSecs, tsFrac } = normalizeTimestamp(tsHigh, tsLow, iface ? iface.ticksPerSec : DEFAULT_TICKS_PER_SEC);
        frames.push({ index, tsSecs, tsFrac, capLen, origLen, data: bytes.subarray(dataStart, dataStart + capLen) });
        index += 1;
      }
    } else if (blockType === BT_SPB && body + 4 <= bodyEnd) {
      // A Simple Packet Block stores no captured length; the data fills the block (minus padding),
      // bounded by the original length.
      const origLen = u32(bytes, body, little);
      const dataStart = body + 4;
      const dataLen = Math.min(origLen, Math.max(0, bodyEnd - dataStart));
      if (frames.length >= MAX_FRAMES) {
        capped = true;
        break;
      }
      frames.push({ index, tsSecs: 0, tsFrac: 0, capLen: dataLen, origLen, data: bytes.subarray(dataStart, dataStart + dataLen) });
      index += 1;
    }
    // Any other block type is skipped by its declared length.
    off += totalLen;
  }

  return {
    linkType: firstLinkType ?? LINKTYPE_ETHERNET,
    nanos: false, // timestamps are normalized to the microsecond model
    frames,
    truncated,
    capped,
    frameCount: frames.length,
  };
}
