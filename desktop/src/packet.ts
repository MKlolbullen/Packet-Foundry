// Client-side mirror of packet-core's BitRange semantics (MSB-first, network/big-endian order)
// — see crates/packet-core/src/bitrange.rs. Read-only: the engine stays the source of truth,
// this just decodes the hex buffer the engine already resolved for display.
import type { Field } from "./types";

export { hexToBytes } from "./hex";

/** Read `lenBits` bits starting at `startBit` as an unsigned integer, MSB-first. */
export function readUintBits(bytes: Uint8Array, startBit: number, lenBits: number): bigint | null {
  if (lenBits > 64 || startBit + lenBits > bytes.length * 8) return null;
  let val = 0n;
  for (let i = startBit; i < startBit + lenBits; i++) {
    const bit = (bytes[i >> 3] >> (7 - (i % 8))) & 1;
    val = (val << 1n) | BigInt(bit);
  }
  return val;
}

/** Read a byte-aligned bit range as raw bytes, or null if unaligned/out-of-bounds. */
export function readBytesRange(bytes: Uint8Array, startBit: number, lenBits: number): Uint8Array | null {
  if (startBit % 8 !== 0 || lenBits % 8 !== 0) return null;
  const start = startBit / 8;
  const end = start + lenBits / 8;
  if (end > bytes.length) return null;
  return bytes.slice(start, end);
}

function toHexPairs(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Format a field's current bytes for display, mirroring packet-cli's `format_value`. */
export function formatFieldValue(bytes: Uint8Array, field: Field): string {
  const { start_bit, len_bits } = field.range;
  switch (field.kind) {
    case "mac_addr": {
      const b = readBytesRange(bytes, start_bit, len_bits);
      return b ? Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(":") : "<out-of-bounds>";
    }
    case "ipv4_addr": {
      const b = readBytesRange(bytes, start_bit, len_bits);
      return b ? Array.from(b).join(".") : "<out-of-bounds>";
    }
    case "ipv6_addr": {
      // Full 8-group form (no `::` compression) so display and the structured editor round-trip.
      const b = readBytesRange(bytes, start_bit, len_bits);
      if (!b) return "<out-of-bounds>";
      const groups: string[] = [];
      for (let i = 0; i < b.length; i += 2) {
        groups.push(((b[i] << 8) | (b[i + 1] ?? 0)).toString(16).padStart(4, "0"));
      }
      return groups.join(":");
    }
    case "flags": {
      const v = readUintBits(bytes, start_bit, len_bits);
      return v === null ? "<out-of-bounds>" : `0x${v.toString(16).padStart(2, "0")}`;
    }
    case "bytes": {
      const b = readBytesRange(bytes, start_bit, len_bits);
      if (!b) return "<out-of-bounds>";
      const hex = toHexPairs(b);
      return hex.length > 32 ? `${hex.slice(0, 32)}…` : hex;
    }
    case "uint":
    default: {
      const v = readUintBits(bytes, start_bit, len_bits);
      return v === null ? "<out-of-bounds>" : v.toString();
    }
  }
}

/** Location string for a field/diagnostic range, mirroring packet-cli's `loc_str`. */
export function locationString(range: { start_bit: number; len_bits: number }): string {
  const { start_bit, len_bits } = range;
  if (start_bit % 8 === 0 && len_bits % 8 === 0) {
    return `[${start_bit / 8}..${(start_bit + len_bits) / 8}]`;
  }
  return `bit[${start_bit}..${start_bit + len_bits}]`;
}
