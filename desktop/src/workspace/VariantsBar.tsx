import { useState } from "react";
import type { DiffSummary } from "./diffView";
import type { Variant, VariantState } from "./variants";

// Branch-tab chip row for packet variants, at the top of the workbench center column. Each chip is
// a named snapshot; the base is tagged, the active one highlighted, and each non-base chip shows
// its change count vs. the base (`·N`). Clicking a chip loads that variant; the trailing chip saves
// the current working packet as a new variant.
export default function VariantsBar({
  state,
  summaries,
  hasWorkingDoc,
  onSelect,
  onSave,
  onRename,
  onDelete,
  onSetBase,
}: {
  state: VariantState;
  summaries: Record<string, DiffSummary>;
  hasWorkingDoc: boolean;
  onSelect: (id: string) => void;
  onSave: () => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onSetBase: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (state.items.length === 0 && !hasWorkingDoc) return null;

  function startRename(v: Variant) {
    setEditingId(v.id);
    setDraft(v.label);
  }
  function commitRename(v: Variant) {
    const label = draft.trim();
    if (label) onRename(v.id, label);
    setEditingId(null);
  }

  return (
    <div className="variants-bar" role="tablist" aria-label="Packet variants">
      {state.items.map((v) => {
        const isBase = v.id === state.baseId;
        const isActive = v.id === state.activeId;
        const count = summaries[v.id]?.total ?? 0;
        const cls = ["variant-chip", isActive && "active", isBase && "base"].filter(Boolean).join(" ");
        return (
          <div className={cls} key={v.id}>
            {editingId === v.id ? (
              <input
                className="variant-chip-input"
                value={draft}
                autoFocus
                spellCheck={false}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onBlur={() => commitRename(v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(v);
                  else if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button
                className="variant-chip-select"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(v.id)}
                onDoubleClick={() => startRename(v)}
                title={`Load "${v.label}" (double-click to rename)`}
              >
                <span className="variant-chip-label">{v.label}</span>
                {isBase && <span className="variant-chip-base-tag">base</span>}
                {!isBase && count > 0 && <span className="variant-chip-count">·{count}</span>}
              </button>
            )}
            {!isBase && (
              <button
                className="variant-chip-icon"
                title="Set as base"
                aria-label={`Set ${v.label} as base`}
                onClick={() => onSetBase(v.id)}
              >
                ⌂
              </button>
            )}
            <button
              className="variant-chip-icon"
              title="Delete variant"
              aria-label={`Delete ${v.label}`}
              onClick={() => onDelete(v.id)}
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="variant-chip variant-chip-save" disabled={!hasWorkingDoc} onClick={onSave}>
        + Save variant
      </button>
    </div>
  );
}
