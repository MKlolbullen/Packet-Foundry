import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hexToBytes } from "../../packet";
import { bytesToHex } from "../../hex";
import type { PacketDocument } from "../../types";
import type { ProjectionProps } from "../SemanticStage";
import type { FocusTarget } from "../focus";
import { fieldContainingBit } from "../range-index";
import { canFlipBit, flipBitInField } from "../fieldEdit";

type BitFocus = Extract<FocusTarget, { kind: "bit" }>;

export default function BitInspector({
  document,
  focus,
  onDive,
  onSelect,
  onDocumentChange,
}: ProjectionProps<BitFocus>) {
  const bytes = hexToBytes(document.buffer);
  const byteIndex = Math.floor(focus.bitIndex / 8);

  const [pending, setPending] = useState(false);
  const [flipError, setFlipError] = useState<string | null>(null);

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
  const hit = fieldContainingBit(document, focus.bitIndex, focus.ownerId);
  const flippable = hit !== null && canFlipBit(hit.field.range);

  async function flip() {
    if (!hit) return;
    const packed = flipBitInField(document, hit.field, focus.bitIndex);
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

  // The "Flip bit" button isn't nested inside anything interactive here (unlike ByteInspector's
  // in-row chips), so no stopPropagation guards are needed.
  return (
    <div>
      <dl className="field-detail">
        <dt>Bit</dt>
        <dd className="loc">{focus.bitIndex}</dd>
        <dt>Value</dt>
        <dd className="field-value">{bit}</dd>
        <dt>Field</dt>
        <dd>{hit ? hit.field.name : "— (reserved)"}</dd>
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
      <button
        className="flip-bit"
        disabled={!flippable || pending}
        title={!hit ? "No field owns this bit" : !flippable ? "Field too wide to flip" : `Pins ${hit.field.name}`}
        onClick={flip}
      >
        Flip bit → {bit ^ 1}
      </button>
      {flipError && <p className="error">{flipError}</p>}
    </div>
  );
}
