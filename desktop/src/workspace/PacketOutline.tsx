import type { PacketDocument } from "../types";
import { targetKey, type FocusTarget } from "./focus";

// Always-visible left rail: every layer + its fields, independent of camera focus (it's a map,
// not a viewport). Every row calls onJump (teleport), not onDive (step) — that's what makes
// "jump" meaningfully distinct from "dive": outline/breadcrumb clicks jump, stage row
// double-clicks dive.
export default function PacketOutline({
  document,
  focus,
  onJump,
}: {
  document: PacketDocument;
  focus: FocusTarget;
  onJump: (target: FocusTarget) => void;
}) {
  const focusKey = targetKey(focus);

  return (
    <nav className="packet-outline" aria-label="Packet outline">
      {document.layers.map((layer) => {
        const layerTarget: FocusTarget = { kind: "layer", layerId: String(layer.id) };
        return (
          <div key={layer.id} className="outline-layer">
            <button
              className={targetKey(layerTarget) === focusKey ? "outline-row active" : "outline-row"}
              onClick={() => onJump(layerTarget)}
            >
              {layer.name}
            </button>
            <div className="outline-fields">
              {layer.fields.map((field) => {
                const fieldTarget: FocusTarget = {
                  kind: "field",
                  layerId: String(layer.id),
                  fieldId: String(field.id),
                };
                return (
                  <button
                    key={field.id}
                    className={targetKey(fieldTarget) === focusKey ? "outline-row active" : "outline-row"}
                    onClick={() => onJump(fieldTarget)}
                  >
                    {field.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
