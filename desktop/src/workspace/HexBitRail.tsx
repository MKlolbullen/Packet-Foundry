import { hexToBytes } from "../packet";
import type { BitRange, Diagnostic } from "../types";
import { overlaps } from "./range-index";

// Bottom strip: the decoded buffer as byte cells, cross-highlighted against the current
// selection and any diagnostic locations — the concrete, visible "cross-highlighting via BitRange
// overlap" deliverable. Display-only in this PR; byte-level dive is a later PR.
export default function HexBitRail({
  buffer,
  selectedRange,
  diagnostics,
}: {
  buffer: string;
  selectedRange?: BitRange;
  diagnostics: Diagnostic[];
}) {
  const bytes = hexToBytes(buffer);
  if (bytes === null) {
    return <p className="error">Malformed buffer: `{buffer}` is not valid hex.</p>;
  }

  return (
    <div className="hex-bit-rail">
      {Array.from(bytes).map((byte, i) => {
        const byteRange: BitRange = { start_bit: i * 8, len_bits: 8 };
        const selected = selectedRange ? overlaps(byteRange, selectedRange) : false;
        const diagnosed = diagnostics.some((d) => d.location && overlaps(byteRange, d.location));
        const classes = ["hex-byte"];
        if (selected) classes.push("hex-byte-selected");
        if (diagnosed) classes.push("hex-byte-diagnosed");
        return (
          <span key={i} className={classes.join(" ")} title={`byte ${i}`}>
            {byte.toString(16).padStart(2, "0")}
          </span>
        );
      })}
    </div>
  );
}
