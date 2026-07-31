import type { BitRange, PacketDiff, PacketDocument } from "../types";
import { changeBadgeLabel, fieldRangeInDoc, hasChanges, stateTransitionLabel } from "./diffView";

// The "Changes" panel: the semantic diff of the current document against its previous undo
// snapshot — "what did my last edit change, and what cascaded?". Each field change is labelled
// direct edit vs. derived consequence (the causal classification the engine computed); clicking a
// changed field cross-highlights it. Rendered in the right rail above diagnostics.
export default function ChangesPanel({
  diff,
  current,
  onSelectRange,
}: {
  diff: PacketDiff;
  current: PacketDocument;
  onSelectRange: (range: BitRange) => void;
}) {
  if (!hasChanges(diff)) {
    return null;
  }

  return (
    <div className="changes-panel">
      <h3>Changes</h3>
      {diff.layers.map((layer) => {
        if (
          layer.status === "unchanged" &&
          layer.fields_changed.length === 0 &&
          layer.fields_added.length === 0 &&
          layer.fields_removed.length === 0
        ) {
          return null;
        }
        return (
          <div className="changes-layer" key={layer.name}>
            <div className="changes-layer-name">
              {layer.status === "added" && <span className="changes-layer-added">+ </span>}
              {layer.status === "removed" && <span className="changes-layer-removed">− </span>}
              {layer.name}
            </div>

            {layer.fields_removed.map((f) => (
              <div className="changes-field changes-removed" key={`r-${f.name}`}>
                <span className="changes-field-name">− {f.name}</span>
                <span className="changes-field-value">{f.value}</span>
              </div>
            ))}
            {layer.fields_added.map((f) => (
              <div className="changes-field changes-added" key={`a-${f.name}`}>
                <span className="changes-field-name">+ {f.name}</span>
                <span className="changes-field-value">{f.value}</span>
              </div>
            ))}
            {layer.fields_changed.map((f) => {
              const range = fieldRangeInDoc(current, layer.name, f.name);
              const badge = changeBadgeLabel(f.change);
              return (
                <button
                  className="changes-field changes-changed"
                  key={`c-${f.name}`}
                  disabled={!range}
                  onClick={() => range && onSelectRange(range)}
                  title={`${f.name}: ${f.value_before} → ${f.value_after}`}
                >
                  <span className="changes-field-name">{f.name}</span>
                  {f.change === "state_only" ? (
                    <span className="changes-field-value">{stateTransitionLabel(f.state_before, f.state_after)}</span>
                  ) : (
                    <span className="changes-field-value">
                      {f.value_before} <span className="changes-arrow">→</span> {f.value_after}
                    </span>
                  )}
                  <span className={`changes-badge changes-badge-${f.change}`}>{badge}</span>
                </button>
              );
            })}
          </div>
        );
      })}

      {(diff.diagnostics.added.length > 0 || diff.diagnostics.removed.length > 0) && (
        <div className="changes-diagnostics">
          {diff.diagnostics.removed.map((d, i) => (
            <div className="changes-diag changes-removed" key={`dr-${i}`}>
              − <span className={`sev-${d.severity}`}>{d.code}</span>
            </div>
          ))}
          {diff.diagnostics.added.map((d, i) => (
            <div className="changes-diag changes-added" key={`da-${i}`}>
              + <span className={`sev-${d.severity}`}>{d.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
