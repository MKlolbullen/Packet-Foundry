// Structured (typed, per-FieldKind) editing helpers — mirrors packet.ts's formatFieldValue
// per-kind branching, but for editing instead of display. `bytes`-kind fields have no separate
// structured form (raw hex already is one), so every function here treats "bytes" as a no-op case
// handled by FieldDetail's existing raw-hex editor instead.
import type { Field, FieldKind, PacketDocument } from "../types";
import { hexToBytes, readBytesRange, readUintBits } from "../packet";

export function hasStructuredEditor(kind: FieldKind): boolean {
  return kind !== "bytes";
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

// Inverse: a kind-appropriate string -> exactly `expectedBytes` raw bytes, or null on any
// validation failure. Uses BigInt throughout (not a bare JS number) so a uint/flags field up to
// readUintBits' own 64-bit cap round-trips exactly, matching its bigint semantics rather than
// losing precision above 2^53 the way a plain-number input would.
export function parseStructuredValue(kind: FieldKind, text: string, expectedBytes: number): Uint8Array | null {
  const trimmed = text.trim();
  switch (kind) {
    case "uint":
      return parseDecimalUint(trimmed, expectedBytes);
    case "flags":
      return parseHexUint(trimmed, expectedBytes);
    case "mac_addr":
      return parseColonHex(trimmed, expectedBytes);
    case "ipv4_addr":
      return parseDottedDecimal(trimmed, expectedBytes);
    case "bytes":
      return null;
  }
}

function packBigEndian(value: bigint, nbytes: number): Uint8Array {
  const out = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes; i++) out[nbytes - 1 - i] = Number((value >> BigInt(i * 8)) & 0xffn);
  return out;
}

function parseDecimalUint(text: string, nbytes: number): Uint8Array | null {
  if (!/^\d+$/.test(text)) return null;
  const value = BigInt(text);
  if (value >= 1n << BigInt(nbytes * 8)) return null;
  return packBigEndian(value, nbytes);
}

function parseHexUint(text: string, nbytes: number): Uint8Array | null {
  const hex = text.replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const value = BigInt(`0x${hex}`);
  if (value >= 1n << BigInt(nbytes * 8)) return null;
  return packBigEndian(value, nbytes);
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
