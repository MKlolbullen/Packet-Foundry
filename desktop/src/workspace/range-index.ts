// Range geometry for cross-highlighting: does a selection/diagnostic's BitRange touch a given
// field/byte/etc? Kept separate from focus.ts (navigation state) the same way bitrange.rs is
// kept separate from node.rs on the Rust side.
import type { BitRange, Field, PacketDocument } from "../types";
import { findField, findLayer, parseOwnerId, type FocusTarget } from "./focus";

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
export interface FieldHit {
  layerId: string;
  fieldId: string;
  field: Field;
}

function containsBit(range: BitRange, bitIndex: number): boolean {
  return bitIndex >= range.start_bit && bitIndex < range.start_bit + range.len_bits;
}

/** The field whose range contains the absolute bit, preferring the `ownerId`'s field when it
 * matches (a byte view is usually reached from a specific field), else the first match in
 * document order. Null when no field claims the bit (e.g. a protocol's reserved padding). */
export function fieldContainingBit(doc: PacketDocument, bitIndex: number, ownerId?: string): FieldHit | null {
  const owner = parseOwnerId(ownerId);
  if (owner) {
    const field = findField(doc, owner.layerId, owner.fieldId);
    if (field && containsBit(field.range, bitIndex)) {
      return { layerId: owner.layerId, fieldId: owner.fieldId, field };
    }
  }
  for (const layer of doc.layers) {
    for (const field of layer.fields) {
      if (containsBit(field.range, bitIndex)) {
        return { layerId: String(layer.id), fieldId: String(field.id), field };
      }
    }
  }
  return null;
}

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
