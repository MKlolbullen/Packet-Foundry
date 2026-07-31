import type { ProtocolCatalogEntry, ProtocolCategory } from "../types";

const CATEGORY_ORDER: ProtocolCategory[] = ["link", "network", "transport", "application", "payload"];
const CATEGORY_LABEL: Record<ProtocolCategory, string> = {
  link: "Link",
  network: "Network",
  transport: "Transport",
  application: "Application",
  payload: "Payload",
};

/** Left pane: every protocol grouped by category. Only the ones that can legally follow the
 * current stack tail (`candidates`, from the engine's compatibility rules) are enabled. */
export default function ProtocolPalette({
  catalog,
  candidates,
  onAdd,
}: {
  catalog: ProtocolCatalogEntry[];
  candidates: string[];
  onAdd: (entry: ProtocolCatalogEntry) => void;
}) {
  const candidateSet = new Set(candidates);
  return (
    <div className="composer-palette">
      <h3>Protocols</h3>
      {CATEGORY_ORDER.map((cat) => {
        const entries = catalog.filter((e) => e.category === cat);
        if (entries.length === 0) return null;
        return (
          <div className="composer-palette-group" key={cat}>
            <div className="composer-palette-cat">{CATEGORY_LABEL[cat]}</div>
            {entries.map((entry) => {
              const enabled = candidateSet.has(entry.id);
              return (
                <button
                  key={entry.id}
                  className="composer-palette-item"
                  disabled={!enabled}
                  title={enabled ? `Add ${entry.display_name}` : `${entry.display_name} can't follow the current layer`}
                  onClick={() => onAdd(entry)}
                >
                  {entry.display_name}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
