import { useEffect } from "react";
import { hexToBytes } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import type { FocusTarget } from "../focus";

type ByteFocus = Extract<FocusTarget, { kind: "byte" }>;

export default function ByteInspector({ document, focus, onDive, onSelect }: ProjectionProps<ByteFocus>) {
  const bytes = hexToBytes(document.buffer);

  useEffect(() => {
    onSelect({ source: focus, range: { start_bit: focus.byteIndex * 8, len_bits: 8 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.byteIndex]);

  if (bytes === null) {
    return <p className="error">Malformed buffer: `{document.buffer}` is not valid hex.</p>;
  }
  if (focus.byteIndex < 0 || focus.byteIndex >= bytes.length) {
    return <p className="hint">This byte is no longer present — the stack was re-assembled.</p>;
  }

  const value = bytes[focus.byteIndex];

  return (
    <div>
      <dl className="field-detail">
        <dt>Byte</dt>
        <dd className="loc">{focus.byteIndex}</dd>
        <dt>Value</dt>
        <dd className="field-value">0x{value.toString(16).padStart(2, "0")}</dd>
      </dl>
      <ul className="byte-bits">
        {Array.from({ length: 8 }, (_, i) => {
          const bitIndex = focus.byteIndex * 8 + i;
          const bit = (value >> (7 - i)) & 1;
          return (
            <li
              key={bitIndex}
              className="bit-row"
              tabIndex={0}
              onClick={() => onSelect({ source: focus, range: { start_bit: bitIndex, len_bits: 1 } })}
              onDoubleClick={() => onDive({ kind: "bit", bitIndex, ownerId: focus.ownerId })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onDive({ kind: "bit", bitIndex, ownerId: focus.ownerId });
              }}
            >
              <span className="loc">bit {bitIndex}</span>
              <span className="field-value">{bit}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
