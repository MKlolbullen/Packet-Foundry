// Structured (typed, per-FieldKind) editing helpers — mirrors packet.ts's formatFieldValue
// per-kind branching, but for editing instead of display. `bytes`-kind fields have no separate
// structured form (raw hex already is one), so every function here treats "bytes" as a no-op case
// handled by FieldDetail's existing raw-hex editor instead.
import type { BitRange, Field, FieldKind, PacketDocument } from "../types";
import { hexToBytes, readBytesRange, readUintBits } from "../packet";

export function hasStructuredEditor(kind: FieldKind): boolean {
  return kind !== "bytes";
}

/** Sub-byte fields are editable only as unsigned values — and only within readUintBits'/
 * write_uint's shared 64-bit cap; anything else gets the "not supported" hint. (Deliberately
 * narrower than hasStructuredEditor: a hypothetical sub-byte mac/ipv4 field would render a
 * permanently-erroring input, not an editor.) */
export function canEditSubByte(kind: FieldKind, lenBits: number): boolean {
  return (kind === "uint" || kind === "flags") && lenBits <= 64;
}

export function structuredPlaceholder(kind: FieldKind): string {
  switch (kind) {
    case "uint":
      return "e.g. 42";
    case "flags":
      return "e.g. 0x2a";
    case "mac_addr":
      return "AA:BB:CC:DD:EE:FF";
    case "ipv4_addr":
      return "192.168.1.1";
    case "ipv6_addr":
      return "2001:0db8:0000:0000:0000:0000:0000:0001";
    case "bytes":
      return "";
  }
}

// Distinct per kind, mirroring the raw-hex path's own two distinct messages ("Not valid hex." vs
// "Expected N bytes, got M.") rather than one generic string for all four kinds.
export function structuredErrorMessage(kind: FieldKind): string {
  switch (kind) {
    case "uint":
      return "Not a valid unsigned integer for this field's width.";
    case "flags":
      return "Not a valid hex value for this field's width.";
    case "mac_addr":
      return "Not a valid MAC address (e.g. AA:BB:CC:DD:EE:FF).";
    case "ipv4_addr":
      return "Not a valid IPv4 address (four dot-separated 0-255 octets).";
    case "ipv6_addr":
      return "Not a valid IPv6 address (eight colon-separated 1–4 digit hex groups; `::` shorthand not supported).";
    case "bytes":
      return "";
  }
}

// (document, field)-shaped, matching FieldDetail's existing draftBytesFor(document, range) for
// symmetry — both get called side by side from the same reset effect / afterMutation. "" (not an
// error string) on out-of-bounds/unaligned/malformed, since this feeds an editable input, not a
// display label. Zero-pads flags to match formatFieldValue's own `0x` padding exactly.
export function structuredDraftFor(document: PacketDocument, field: Field): string {
  const bytes = hexToBytes(document.buffer);
  const { start_bit, len_bits } = field.range;
  switch (field.kind) {
    case "mac_addr": {
      const b = bytes ? readBytesRange(bytes, start_bit, len_bits) : null;
      return b ? Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(":") : "";
    }
    case "ipv4_addr": {
      const b = bytes ? readBytesRange(bytes, start_bit, len_bits) : null;
      return b ? Array.from(b).join(".") : "";
    }
    case "ipv6_addr": {
      // Full 8-group form (no `::`), matching formatFieldValue so the draft round-trips.
      const b = bytes ? readBytesRange(bytes, start_bit, len_bits) : null;
      if (!b) return "";
      const groups: string[] = [];
      for (let i = 0; i < b.length; i += 2) groups.push(((b[i] << 8) | (b[i + 1] ?? 0)).toString(16).padStart(4, "0"));
      return groups.join(":");
    }
    case "flags": {
      const v = bytes ? readUintBits(bytes, start_bit, len_bits) : null;
      return v == null ? "" : `0x${v.toString(16).padStart(2, "0")}`;
    }
    case "uint": {
      const v = bytes ? readUintBits(bytes, start_bit, len_bits) : null;
      return v == null ? "" : v.toString();
    }
    case "bytes":
      return "";
  }
}

// Inverse: a kind-appropriate string -> the field's value packed into ceil(lenBits/8) bytes
// (right-aligned for sub-byte widths — the encoding set_field_bytes expects), or null on any
// validation failure. Uses BigInt throughout (not a bare JS number) so a uint/flags field up to
// readUintBits' own 64-bit cap round-trips exactly, matching its bigint semantics rather than
// losing precision above 2^53 the way a plain-number input would.
export function parseStructuredValue(kind: FieldKind, text: string, lenBits: number): Uint8Array | null {
  const trimmed = text.trim();
  switch (kind) {
    case "uint":
      return parseDecimalUint(trimmed, lenBits);
    case "flags":
      return parseHexUint(trimmed, lenBits);
    // mac/ipv4 are byte-shaped by nature; lenBits is a whole-byte multiple for every real field
    // of these kinds, and a fractional part count fails the parsers' exact-count checks anyway.
    case "mac_addr":
      return parseColonHex(trimmed, lenBits / 8);
    case "ipv4_addr":
      return parseDottedDecimal(trimmed, lenBits / 8);
    // Full-form only (exactly 8 colon-separated groups) — no `::` shorthand — so parse is the
    // exact inverse of formatFieldValue/structuredDraftFor's display, not a superset of it.
    case "ipv6_addr":
      return parseIpv6Groups(trimmed);
    case "bytes":
      return null;
  }
}

/** Mirror of the Rust check_field_bytes gate: aligned fields of any width can flip (bytes
 * path); unaligned fields only within read_uint/write_uint's shared 64-bit cap (value path). */
export function canFlipBit(range: BitRange): boolean {
  const aligned = range.start_bit % 8 === 0 && range.len_bits % 8 === 0;
  return aligned || range.len_bits <= 64;
}

/** The pinned bytes for `field` after flipping the absolute bit `bitIndex`, in the packing
 * set_field_bytes expects (raw bytes for aligned fields, right-aligned value for unaligned) —
 * or null if the buffer is malformed, the bit is outside the field, or an unaligned field
 * exceeds the 64-bit read cap. The flipped result always stays within `len_bits`, so it can
 * never fail the backend's width check. */
export function flipBitInField(doc: PacketDocument, field: Field, bitIndex: number): Uint8Array | null {
  const { start_bit, len_bits } = field.range;
  const k = bitIndex - start_bit;
  if (k < 0 || k >= len_bits) return null;
  const bytes = hexToBytes(doc.buffer);
  if (!bytes) return null;
  if (start_bit % 8 === 0 && len_bits % 8 === 0) {
    // Bytes path — required for arbitrarily long fields (a Raw payload exceeds the 64-bit cap).
    const fieldBytes = readBytesRange(bytes, start_bit, len_bits);
    if (!fieldBytes) return null;
    const out = fieldBytes.slice();
    out[k >> 3] ^= 1 << (7 - (k % 8));
    return out;
  }
  // Unaligned path (not just sub-byte — a 13-bit field or one starting mid-byte lands here too):
  // flip within the value, MSB-first to match readUintBits' bit order, pack right-aligned.
  const value = readUintBits(bytes, start_bit, len_bits);
  if (value === null) return null;
  return packBigEndian(value ^ (1n << BigInt(len_bits - 1 - k)), Math.ceil(len_bits / 8));
}

function packBigEndian(value: bigint, nbytes: number): Uint8Array {
  const out = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes; i++) out[nbytes - 1 - i] = Number((value >> BigInt(i * 8)) & 0xffn);
  return out;
}

function parseDecimalUint(text: string, lenBits: number): Uint8Array | null {
  if (!/^\d+$/.test(text)) return null;
  const value = BigInt(text);
  if (value >= 1n << BigInt(lenBits)) return null;
  return packBigEndian(value, Math.ceil(lenBits / 8));
}

function parseHexUint(text: string, lenBits: number): Uint8Array | null {
  const hex = text.replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const value = BigInt(`0x${hex}`);
  if (value >= 1n << BigInt(lenBits)) return null;
  return packBigEndian(value, Math.ceil(lenBits / 8));
}

function parseColonHex(text: string, nbytes: number): Uint8Array | null {
  const parts = text.split(":");
  if (parts.length !== nbytes) return null;
  const out = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes; i++) {
    if (!/^[0-9a-fA-F]{1,2}$/.test(parts[i])) return null;
    out[i] = parseInt(parts[i], 16);
  }
  return out;
}

// Full-form IPv6 only: exactly 8 colon-separated groups, each 1–4 hex digits, two bytes per
// group (16 bytes total). `::` compression is deliberately unsupported — the display side never
// emits it, so accepting it here would make parse a non-inverse of format. lenBits is implied
// (always 128 for a real ipv6_addr field); the group count is the real check.
function parseIpv6Groups(text: string): Uint8Array | null {
  const parts = text.split(":");
  if (parts.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(parts[i])) return null;
    const v = parseInt(parts[i], 16);
    out[i * 2] = (v >> 8) & 0xff;
    out[i * 2 + 1] = v & 0xff;
  }
  return out;
}

function parseDottedDecimal(text: string, nbytes: number): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== nbytes) return null;
  const out = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const v = Number(parts[i]);
    if (v > 255) return null;
    out[i] = v;
  }
  return out;
}
