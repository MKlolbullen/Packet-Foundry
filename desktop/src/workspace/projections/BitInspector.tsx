import { useEffect } from "react";
import { hexToBytes } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import type { FocusTarget } from "../focus";

type BitFocus = Extract<FocusTarget, { kind: "bit" }>;

export default function BitInspector({ document, focus, onDive, onSelect }: ProjectionProps<BitFocus>) {
  const bytes = hexToBytes(document.buffer);
  const byteIndex = Math.floor(focus.bitIndex / 8);

  useEffect(() => {
    onSelect({ source: focus, range: { start_bit: focus.bitIndex, len_bits: 1 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.bitIndex]);

  if (bytes === null) {
    return <p className="error">Malformed buffer: `{document.buffer}` is not valid hex.</p>;
  }
  if (focus.bitIndex < 0 || byteIndex >= bytes.length) {
    return <p className="hint">This bit is no longer present — the stack was re-assembled.</p>;
  }

  const bit = (bytes[byteIndex] >> (7 - (focus.bitIndex % 8))) & 1;

  return (
    <dl className="field-detail">
      <dt>Bit</dt>
      <dd className="loc">{focus.bitIndex}</dd>
      <dt>Value</dt>
      <dd className="field-value">{bit}</dd>
      <dt>Byte</dt>
      <dd>
        <button
          className="byte-chip"
          tabIndex={0}
          onClick={() => onSelect({ source: focus, range: { start_bit: byteIndex * 8, len_bits: 8 } })}
          onDoubleClick={() => onDive({ kind: "byte", byteIndex, ownerId: focus.ownerId })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onDive({ kind: "byte", byteIndex, ownerId: focus.ownerId });
          }}
        >
          Byte {byteIndex}
        </button>
      </dd>
    </dl>
  );
}
