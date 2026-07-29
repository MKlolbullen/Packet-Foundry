import { locationString } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import type { FocusTarget } from "../focus";

type PacketFocus = Extract<FocusTarget, { kind: "packet" }>;

// Top-of-the-camera view: one summary row per layer. Diagnostics are deliberately not rendered
// here — they apply to the whole document regardless of camera position, so they render once, in
// Workspace.tsx's DiagnosticsPanel, not duplicated per-projection.
export default function PacketOverview({ document, onDive }: ProjectionProps<PacketFocus>) {
  if (document.layers.length === 0) {
    return <p className="hint">No layers — assemble a stack to see it here.</p>;
  }

  return (
    <div className="packet-overview">
      {document.layers.map((layer) => (
        <div
          key={layer.id}
          className="overview-row"
          tabIndex={0}
          onDoubleClick={() => onDive({ kind: "layer", layerId: String(layer.id) })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onDive({ kind: "layer", layerId: String(layer.id) });
          }}
        >
          <span className="overview-row-name">{layer.name}</span>
          <span className="loc">{locationString(layer.range)}</span>
          <span className="overview-row-count">
            {layer.fields.length} field{layer.fields.length === 1 ? "" : "s"}
          </span>
        </div>
      ))}
    </div>
  );
}
