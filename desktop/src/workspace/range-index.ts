// Range geometry for cross-highlighting: does a selection/diagnostic's BitRange touch a given
// field/byte/etc? Kept separate from focus.ts (navigation state) the same way bitrange.rs is
// kept separate from node.rs on the Rust side.
import type { BitRange, PacketDocument } from "../types";
import { findField, findLayer, type FocusTarget } from "./focus";

/** TS mirror of `BitRange::overlaps` in crates/packet-core/src/bitrange.rs. A zero-length range
 * contains no bit positions, so it never overlaps anything, including another zero-length range. */
export function overlaps(a: BitRange, b: BitRange): boolean {
  if (a.len_bits === 0 || b.len_bits === 0) return false;
  const aEnd = a.start_bit + a.len_bits;
  const bEnd = b.start_bit + b.len_bits;
  return a.start_bit < bEnd && b.start_bit < aEnd;
}

/** The BitRange a given focus target occupies, or undefined if it has none (unknown id, or a
 * kind with no single meaningful range — an operation tree isn't one contiguous range, so it
 * doesn't participate in cross-highlighting). Deliberately decode-free for `packet` — derives
 * the packet's byte length from the hex string's length rather than importing hexToBytes;
 * callers that already have decoded bytes in scope can pass a byte count in directly instead. */
export function rangeOfTarget(doc: PacketDocument, target: FocusTarget): BitRange | undefined {
  switch (target.kind) {
    case "packet": {
      const byteLen = doc.buffer.length / 2;
      return byteLen > 0 ? { start_bit: 0, len_bits: byteLen * 8 } : undefined;
    }
    case "layer":
      return findLayer(doc, target.layerId)?.range;
    case "field":
      return findField(doc, target.layerId, target.fieldId)?.range;
    case "byte":
      return { start_bit: target.byteIndex * 8, len_bits: 8 };
    case "bit":
      return { start_bit: target.bitIndex, len_bits: 1 };
    case "operation":
      return undefined;
  }
}
