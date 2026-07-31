// Ghidra-style "strings": runs of printable ASCII in an opaque byte region (a Payload, a raw
// capture — anywhere the structure is unknown). Pure and client-side: the frontend already holds
// the decoded buffer, so this needs no backend round-trip. ASCII only for now; UTF-16LE is a
// possible follow-up.

export interface StringHit {
  text: string;
  /** Absolute byte offsets [startByte, endByte) so a hit maps straight onto a BitRange. */
  startByte: number;
  endByte: number;
}

/** Extract printable-ASCII runs of at least `minLen` bytes within `[start, end)`. Offsets are
 * absolute (into `bytes`), so a hit's range highlights directly in the hex rail. */
export function extractStrings(
  bytes: Uint8Array,
  opts?: { minLen?: number; start?: number; end?: number },
): StringHit[] {
  const minLen = opts?.minLen ?? 4;
  const start = Math.max(0, opts?.start ?? 0);
  const end = Math.min(bytes.length, opts?.end ?? bytes.length);
  const hits: StringHit[] = [];
  let runStart = -1;
  // Iterate one past `end` so a run ending exactly at `end` gets flushed.
  for (let i = start; i <= end; i++) {
    const printable = i < end && bytes[i] >= 0x20 && bytes[i] <= 0x7e;
    if (printable) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0 && i - runStart >= minLen) {
        let text = "";
        for (let j = runStart; j < i; j++) text += String.fromCharCode(bytes[j]);
        hits.push({ text, startByte: runStart, endByte: i });
      }
      runStart = -1;
    }
  }
  return hits;
}
