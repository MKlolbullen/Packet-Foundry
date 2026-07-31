// Classic libpcap (.pcap) reader — pure and client-side, mirroring strings.ts: the frontend
// already holds the file's bytes, so parsing needs no backend round-trip. Each frame's link-layer
// bytes feed the existing `dissect_hex` command one at a time, on demand. This module reads only
// the classic 24-byte-global-header layout; the block-structured pcapng format is handled by its
// sibling `pcapng.ts` (both return this module's `PcapCapture`), dispatched by `capture.ts`.

const GLOBAL_HEADER_LEN = 24;
const RECORD_HEADER_LEN = 16;
/** LINKTYPE_ETHERNET — the only link type `dissect()` reads as an Ethernet II frame. */
export const LINKTYPE_ETHERNET = 1;
/** Cap the number of frames surfaced from one file — a capture can hold millions; the picker
 * only needs a workable slice, and holding every frame's bytes in memory would be wasteful.
 * Shared with the pcapng reader so both formats cap identically. */
export const MAX_FRAMES = 5000;

export interface PcapFrame {
  /** 0-based position in the file. */
  index: number;
  /** Seconds since the Unix epoch (from the record header). */
  tsSecs: number;
  /** Sub-second fraction — microseconds, or nanoseconds when `nanos` is set on the capture. */
  tsFrac: number;
  /** Bytes actually stored for this frame (`incl_len`) — what `data` contains. */
  capLen: number;
  /** Original on-wire length (`orig_len`); larger than `capLen` for a snap-truncated capture. */
  origLen: number;
  /** The captured link-layer bytes, ready to hand to `dissect()`. */
  data: Uint8Array;
}

export interface PcapCapture {
  /** The file's link type; `dissect()` only makes sense for `LINKTYPE_ETHERNET`. */
  linkType: number;
  /** Whether record timestamps are nanosecond- (vs microsecond-) resolution. */
  nanos: boolean;
  frames: PcapFrame[];
  /** A record ran past the end of the file (a truncated capture), so parsing stopped early. */
  truncated: boolean;
  /** More than `MAX_FRAMES` frames were present; `frames` holds the first `MAX_FRAMES`. */
  capped: boolean;
  /** Total frames actually read (== `frames.length`; `>= frames.length` isn't tracked past the cap). */
  frameCount: number;
}

/** The four classic magic-number byte sequences: {big,little}-endian × {micro,nano}-second. */
function detectFormat(bytes: Uint8Array): { little: boolean; nanos: boolean } | null {
  const m = (a: number, b: number, c: number, d: number) =>
    bytes[0] === a && bytes[1] === b && bytes[2] === c && bytes[3] === d;
  if (m(0xa1, 0xb2, 0xc3, 0xd4)) return { little: false, nanos: false };
  if (m(0xd4, 0xc3, 0xb2, 0xa1)) return { little: true, nanos: false };
  if (m(0xa1, 0xb2, 0x3c, 0x4d)) return { little: false, nanos: true };
  if (m(0x4d, 0x3c, 0xb2, 0xa1)) return { little: true, nanos: true };
  return null;
}

function readU32(bytes: Uint8Array, off: number, little: boolean): number {
  // Unsigned; `>>> 0` keeps it non-negative for the high bit (lengths never exceed 2^32).
  return little
    ? (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0
    : ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
}

/** Parse a classic libpcap file. Throws on a non-pcap file (bad magic) or a header too short to
 * hold the 24-byte global header; a record that runs past the end of the buffer is treated as a
 * clean truncation (frames parsed so far are returned with `truncated: true`), never an error —
 * matching `dissect()`'s never-panic-on-partial-input philosophy. */
export function parsePcap(bytes: Uint8Array): PcapCapture {
  if (bytes.length < GLOBAL_HEADER_LEN) {
    throw new Error("not a pcap file: shorter than a 24-byte global header");
  }
  const fmt = detectFormat(bytes);
  if (!fmt) {
    throw new Error("not a pcap file: unrecognized magic number (pcapng is not supported)");
  }
  const { little, nanos } = fmt;
  const linkType = readU32(bytes, 20, little);

  const frames: PcapFrame[] = [];
  let off = GLOBAL_HEADER_LEN;
  let truncated = false;
  let capped = false;
  let index = 0;

  while (off + RECORD_HEADER_LEN <= bytes.length) {
    const tsSecs = readU32(bytes, off, little);
    const tsFrac = readU32(bytes, off + 4, little);
    const capLen = readU32(bytes, off + 8, little);
    const origLen = readU32(bytes, off + 12, little);
    const dataStart = off + RECORD_HEADER_LEN;
    if (dataStart + capLen > bytes.length) {
      // The record claims more bytes than remain — a truncated final record. Stop cleanly.
      truncated = true;
      break;
    }
    if (frames.length >= MAX_FRAMES) {
      capped = true;
      break;
    }
    frames.push({
      index,
      tsSecs,
      tsFrac,
      capLen,
      origLen,
      data: bytes.subarray(dataStart, dataStart + capLen),
    });
    off = dataStart + capLen;
    index += 1;
  }

  return { linkType, nanos, frames, truncated, capped, frameCount: frames.length };
}

/** A frame's timestamp as fractional seconds since the epoch (fraction scaled by resolution). */
export function frameTimestamp(frame: PcapFrame, nanos: boolean): number {
  return frame.tsSecs + frame.tsFrac / (nanos ? 1e9 : 1e6);
}
