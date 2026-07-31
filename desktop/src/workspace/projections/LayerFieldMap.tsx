import { formatFieldValue, hexToBytes, locationString } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import { findLayer, type FocusTarget } from "../focus";
import { computeLayerDiagram } from "../layerDiagram";
import LayerDiagram from "./LayerDiagram";
import StringsPanel from "./StringsPanel";

type LayerFocus = Extract<FocusTarget, { kind: "layer" }>;

export default function LayerFieldMap({
  document,
  focus,
  selection,
  onDive,
  onSelect,
}: ProjectionProps<LayerFocus>) {
  const layer = findLayer(document, focus.layerId);
  if (!layer) {
    return <p className="hint">This layer is no longer present — the stack was re-assembled.</p>;
  }

  const bytes = hexToBytes(document.buffer);
  if (bytes === null) {
    return <p className="error">Malformed buffer: `{document.buffer}` is not valid hex.</p>;
  }

  // Bit-width-aware diagram when the fields tile a clean grid; the field table otherwise (opaque
  // blobs, overlaps, oversized payloads).
  const rows = computeLayerDiagram(layer);
  if (rows) {
    return (
      <LayerDiagram
        rows={rows}
        bytes={bytes}
        selectedRange={selection?.range}
        onSelectRange={(range) => onSelect({ source: focus, range })}
        onDiveField={(fieldId) => onDive({ kind: "field", layerId: focus.layerId, fieldId })}
      />
    );
  }

  // An opaque layer (a single Bytes field spanning the whole layer — a Payload / Options / Unknown
  // region) gets a strings view under its table.
  const isOpaque =
    layer.fields.length === 1 &&
    layer.fields[0].kind === "bytes" &&
    layer.fields[0].range.len_bits === layer.range.len_bits;

  return (
    <>
      <table className="fields">
        <tbody>
          {layer.fields.map((field) => (
            <tr
              key={field.id}
              onClick={() => onSelect({ source: focus, range: field.range })}
              onDoubleClick={() => onDive({ kind: "field", layerId: focus.layerId, fieldId: String(field.id) })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onDive({ kind: "field", layerId: focus.layerId, fieldId: String(field.id) });
                }
              }}
              tabIndex={0}
            >
              <td className="field-name">{field.name}</td>
              <td className="loc">{locationString(field.range)}</td>
              <td className="field-value">{formatFieldValue(bytes, field)}</td>
              <td className="field-marker">
                {field.override_bytes ? "pinned" : field.derivation ? "derived" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isOpaque && (
        <StringsPanel
          bytes={bytes}
          startByte={layer.range.start_bit / 8}
          endByte={(layer.range.start_bit + layer.range.len_bits) / 8}
          onSelectRange={(range) => onSelect({ source: focus, range })}
        />
      )}
    </>
  );
}
