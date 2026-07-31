import { useMemo } from "react";
import type { BitRange } from "../../types";
import { extractStrings } from "../../strings";

// Printable-ASCII strings found in an opaque layer's bytes (a Payload / raw region). Each hit is
// clickable and cross-highlights its bytes in the hex rail. Renders nothing when there are none.
export default function StringsPanel({
  bytes,
  startByte,
  endByte,
  onSelectRange,
}: {
  bytes: Uint8Array;
  startByte: number;
  endByte: number;
  onSelectRange: (range: BitRange) => void;
}) {
  const hits = useMemo(() => extractStrings(bytes, { start: startByte, end: endByte }), [bytes, startByte, endByte]);
  if (hits.length === 0) return null;

  return (
    <div className="strings-panel">
      <div className="strings-panel-title">Strings ({hits.length})</div>
      <ul className="strings-list">
        {hits.map((h, i) => (
          <li key={i}>
            <button
              className="string-hit"
              title={`bytes [${h.startByte}..${h.endByte}]`}
              onClick={() => onSelectRange({ start_bit: h.startByte * 8, len_bits: (h.endByte - h.startByte) * 8 })}
            >
              <span className="string-hit-offset">{h.startByte}</span>
              <span className="string-hit-text">{h.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
