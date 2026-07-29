import { formatFieldValue, hexToBytes, locationString } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import { findLayer, type FocusTarget } from "../focus";

type LayerFocus = Extract<FocusTarget, { kind: "layer" }>;

export default function LayerFieldMap({ document, focus, onDive, onSelect }: ProjectionProps<LayerFocus>) {
  const layer = findLayer(document, focus.layerId);
  if (!layer) {
    return <p className="hint">This layer is no longer present — the stack was re-assembled.</p>;
  }

  const bytes = hexToBytes(document.buffer);
  if (bytes === null) {
    return <p className="error">Malformed buffer: `{document.buffer}` is not valid hex.</p>;
  }

  return (
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
  );
}
