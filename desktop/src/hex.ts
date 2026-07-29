// Shared, validated hex <-> bytes helpers — used by the box editor's Const field and by the
// packet tree's buffer decoding, so malformed hex fails clearly instead of silently decoding
// to zero bytes (a bare `parseInt` on a non-hex substring returns NaN, which Uint8Array/number
// coerce to 0 with no indication anything went wrong).

function normalizeHex(hex: string): string | null {
  const clean = hex.trim().replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  return clean;
}

export function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => (b & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

/** Parse a hex string into a plain byte array, or `[]` if malformed (whitespace-tolerant).
 * Callers that need to tell "malformed" apart from a legitimately empty buffer should use
 * `hexToBytes` instead, whose `null` is unambiguous. */
export function hexToBytesArray(hex: string): number[] {
  const clean = normalizeHex(hex);
  if (clean === null) return [];
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.substring(i, i + 2), 16));
  return out;
}

/** Parse a hex string into bytes, or `null` if malformed (odd length or non-hex characters). */
export function hexToBytes(hex: string): Uint8Array | null {
  const clean = normalizeHex(hex);
  if (clean === null) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}
