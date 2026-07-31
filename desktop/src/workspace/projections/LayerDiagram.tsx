import type { BitRange } from "../../types";
import { formatFieldValue, locationString } from "../../packet";
import type { DiagramRow } from "../layerDiagram";

const RULER_TICKS = [0, 8, 16, 24];

/** A bit-width-aware layer view: fields tiled into 32-bit rows so the header reads as its wire
 * shape. Same interactions as the field table — click selects (cross-highlights the hex rail),
 * double-click / Enter dives into the field. */
export default function LayerDiagram({
  rows,
  bytes,
  selectedRange,
  onSelectRange,
  onDiveField,
}: {
  rows: DiagramRow[];
  bytes: Uint8Array;
  selectedRange?: BitRange;
  onSelectRange: (range: BitRange) => void;
  onDiveField: (fieldId: string) => void;
}) {
  return (
    <div className="layer-diagram">
      <div className="layer-diagram-ruler" aria-hidden="true">
        {RULER_TICKS.map((b) => (
          <span key={b} className="ruler-tick" style={{ gridColumn: `${b + 1} / span 8` }}>
            {b}
          </span>
        ))}
      </div>
      {rows.map((row, i) => (
        <div className="layer-diagram-row" role="row" key={i}>
          {row.segments.map((seg, j) => {
            const style = { gridColumn: `${seg.colStart + 1} / span ${seg.colSpan}` };
            const field = seg.field;
            if (!field) return <div className="diag-gap" style={style} key={j} />;

            const marker = field.override_bytes ? "pinned" : field.derivation ? "derived" : "";
            const value = formatFieldValue(bytes, field);
            const selected =
              selectedRange?.start_bit === field.range.start_bit &&
              selectedRange?.len_bits === field.range.len_bits;
            const cls = ["diag-field", marker && `diag-${marker}`, selected && "diag-selected"]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                className={cls}
                style={style}
                role="gridcell"
                tabIndex={0}
                title={`${field.name} ${locationString(field.range)} = ${value}${marker ? ` (${marker})` : ""}`}
                onClick={() => onSelectRange(field.range)}
                onDoubleClick={() => onDiveField(String(field.id))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onDiveField(String(field.id));
                }}
                key={j}
              >
                {seg.isLead && <span className="diag-name">{field.name}</span>}
                {seg.isLead && seg.colSpan >= 8 && <span className="diag-value">{value}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
