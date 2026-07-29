import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hexToBytes } from "../../packet";
import { bytesToHex } from "../../hex";
import type { PacketDocument } from "../../types";
import type { ProjectionProps } from "../SemanticStage";
import type { FocusTarget } from "../focus";
import { fieldContainingBit, type FieldHit } from "../range-index";
import { canFlipBit, flipBitInField } from "../fieldEdit";

type ByteFocus = Extract<FocusTarget, { kind: "byte" }>;

export default function ByteInspector({
  document,
  focus,
  onDive,
  onSelect,
  onDocumentChange,
}: ProjectionProps<ByteFocus>) {
  const bytes = hexToBytes(document.buffer);

  // One pending flag for the whole component, not per row: each flip's closure captures the
  // render-time `document`, so two overlapping flips would send the second invoke with the
  // pre-first-flip document and silently drop flip one.
  const [pending, setPending] = useState(false);
  const [flipError, setFlipError] = useState<string | null>(null);

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

  async function commitFlip(hit: FieldHit, bitIndex: number) {
    const packed = flipBitInField(document, hit.field, bitIndex);
    if (!packed) {
      setFlipError("Couldn't compute the flipped value for this field.");
      return;
    }
    setPending(true);
    setFlipError(null);
    try {
      const result = await invoke<PacketDocument>("set_field_bytes", {
        document,
        layerId: Number(hit.layerId),
        fieldId: Number(hit.fieldId),
        bytesHex: bytesToHex(packed),
      });
      onDocumentChange(result);
    } catch (e) {
      setFlipError(String(e));
    } finally {
      setPending(false);
    }
  }

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
          const hit = fieldContainingBit(document, bitIndex, focus.ownerId);
          const flippable = hit !== null && canFlipBit(hit.field.range);
          const reason = !hit
            ? "No field owns this bit"
            : !flippable
              ? "Field too wide to flip"
              : `Flip bit ${bitIndex} (pins ${hit.field.name})`;
          return (
            <li
              key={bitIndex}
              className="bit-row"
              tabIndex={0}
              onClick={() => onSelect({ source: focus, range: { start_bit: bitIndex, len_bits: 1 } })}
              onDoubleClick={() => onDive({ kind: "bit", bitIndex, ownerId: focus.ownerId })}
              onKeyDown={(e) => {
                // Only act on keys targeted at the row itself — a focused flip button's Enter
                // must not also dive. (No stopPropagation on the button: React's root delegation
                // means that would also kill the window-level Escape/Alt+Arrow handlers.)
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter") onDive({ kind: "bit", bitIndex, ownerId: focus.ownerId });
              }}
            >
              <span className="loc">bit {bitIndex}</span>
              <button
                className="bit-flip-chip"
                disabled={!flippable || pending}
                title={reason}
                aria-label={reason}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hit) commitFlip(hit, bitIndex);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {bit}
              </button>
              <span className="bit-owner">{hit?.field.name ?? "—"}</span>
            </li>
          );
        })}
      </ul>
      {flipError && <p className="error">{flipError}</p>}
    </div>
  );
}
