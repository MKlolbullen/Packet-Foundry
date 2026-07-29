import { useEffect } from "react";
import { formatFieldValue, hexToBytes, locationString } from "../../packet";
import type { BitRange } from "../../types";
import type { ProjectionProps } from "../SemanticStage";
import { findField, type FocusTarget } from "../focus";

type FieldFocus = Extract<FocusTarget, { kind: "field" }>;

/** The inclusive-exclusive byte span a bit range touches, rounded out to whole bytes — a
 * sub-byte field (e.g. a 4-bit Version field) still touches one whole byte shared with a
 * sibling, which is fine here: this is "here are the raw bytes this field's range spans," not a
 * claim about which bits within them are this field's own. */
function byteSpanOf(range: BitRange): { startByte: number; endByte: number } {
  return {
    startByte: Math.floor(range.start_bit / 8),
    endByte: Math.ceil((range.start_bit + range.len_bits) / 8),
  };
}

// Read-only single-field detail — no editing controls here, pinning/deriving is a later PR.
export default function FieldDetail({ document, focus, onDive, onSelect }: ProjectionProps<FieldFocus>) {
  const field = findField(document, focus.layerId, focus.fieldId);

  // Arriving at a field via dive auto-highlights its range elsewhere (hex rail, diagnostics)
  // without requiring an extra click.
  useEffect(() => {
    if (field) onSelect({ source: focus, range: field.range });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.layerId, focus.fieldId]);

  if (!field) {
    return <p className="hint">This field is no longer present — the stack was re-assembled.</p>;
  }

  const bytes = hexToBytes(document.buffer);
  const value = bytes ? formatFieldValue(bytes, field) : "<malformed buffer>";
  const state = field.override_bytes ? "pinned" : field.derivation ? "derived" : "plain";
  const { startByte, endByte } = byteSpanOf(field.range);
  const ownerId = `${focus.layerId}:${focus.fieldId}`;

  return (
    <>
      <dl className="field-detail">
        <dt>Name</dt>
        <dd>{field.name}</dd>
        <dt>Range</dt>
        <dd className="loc">{locationString(field.range)}</dd>
        <dt>Kind</dt>
        <dd>{field.kind}</dd>
        <dt>Value</dt>
        <dd className="field-value">{value}</dd>
        <dt>State</dt>
        <dd>{state}</dd>
      </dl>

      <div className="field-bytes">
        <span className="field-bytes-label">Bytes</span>
        <div className="byte-chip-row">
          {Array.from({ length: endByte - startByte }, (_, i) => startByte + i).map((byteIndex) => (
            <button
              key={byteIndex}
              className="byte-chip"
              tabIndex={0}
              onClick={() => onSelect({ source: focus, range: { start_bit: byteIndex * 8, len_bits: 8 } })}
              onDoubleClick={() => onDive({ kind: "byte", byteIndex, ownerId })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onDive({ kind: "byte", byteIndex, ownerId });
              }}
            >
              {byteIndex}
            </button>
          ))}
        </div>
      </div>

      {field.derivation && (
        <button
          className="view-derivation"
          onClick={() =>
            onDive({ kind: "operation", layerId: focus.layerId, fieldId: focus.fieldId, operationId: "root" })
          }
        >
          View derivation →
        </button>
      )}
    </>
  );
}
