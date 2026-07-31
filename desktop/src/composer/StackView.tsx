import type { ProtocolCatalogEntry } from "../types";
import type { ComposerModel } from "./composerModel";

/** Center pane: the ordered stack. Click a layer to edit it; reorder / remove with the row
 * controls. A badge shows how many of a layer's fields carry an explicit (non-Auto) value. */
export default function StackView({
  model,
  catalog,
  selectedKey,
  onSelect,
  onMove,
  onRemove,
}: {
  model: ComposerModel;
  catalog: ProtocolCatalogEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="composer-stack">
      <h3>Stack</h3>
      {model.layers.length === 0 && <p className="hint">Add a protocol from the palette to start.</p>}
      <ol className="composer-stack-list">
        {model.layers.map((layer, i) => {
          const entry = catalog.find((e) => e.id === layer.protocolId);
          const pinned = Object.values(layer.fields).filter((f) => f.mode !== "auto").length;
          return (
            <li
              key={layer.key}
              className={layer.key === selectedKey ? "composer-layer selected" : "composer-layer"}
              onClick={() => onSelect(layer.key)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(layer.key);
                }
              }}
            >
              <span className="composer-layer-name">{entry?.display_name ?? layer.protocolId}</span>
              {pinned > 0 && <span className="composer-layer-badge">{pinned} set</span>}
              <span className="composer-layer-controls">
                <button
                  title="Move up"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(layer.key, -1);
                  }}
                >
                  ↑
                </button>
                <button
                  title="Move down"
                  disabled={i === model.layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(layer.key, 1);
                  }}
                >
                  ↓
                </button>
                <button
                  title="Remove layer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(layer.key);
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
