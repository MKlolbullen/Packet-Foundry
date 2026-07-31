import { useEffect, useState } from "react";
import type { ProtocolCatalogEntry } from "../types";
import { bytesToHex, hexToBytes, hexToBytesArray } from "../hex";
import { parseStructuredValue } from "../workspace/fieldEdit";
import {
  formControlsFor,
  formatFieldBytes,
  hasTriState,
  isUserEditable,
  type ComposerLayer,
  type ControlSpec,
  type FieldMode,
} from "./composerModel";

/** Right pane: a typed form for the selected layer, rendered entirely from the engine's field
 * descriptors — no per-protocol knowledge here. Editable fields get an input; auto-linked
 * next-protocol fields get an Auto/Pin/Invalid tri-state; derived/fixed fields are read-only. */
export default function LayerInspector({
  entry,
  layer,
  onValue,
  onMode,
}: {
  entry: ProtocolCatalogEntry | null;
  layer: ComposerLayer | null;
  onValue: (fieldName: string, hex: string) => void;
  onMode: (fieldName: string, mode: FieldMode) => void;
}) {
  if (!entry || !layer) {
    return (
      <div className="composer-inspector">
        <p className="hint">Select a layer to edit its fields.</p>
      </div>
    );
  }
  const controls = formControlsFor(entry, layer);
  return (
    <div className="composer-inspector">
      <h3>{entry.display_name}</h3>
      <div className="composer-fields">
        {controls.map((c) => (
          <ParameterField key={c.name} control={c} onValue={onValue} onMode={onMode} />
        ))}
      </div>
    </div>
  );
}

function ParameterField({
  control,
  onValue,
  onMode,
}: {
  control: ControlSpec;
  onValue: (fieldName: string, hex: string) => void;
  onMode: (fieldName: string, mode: FieldMode) => void;
}) {
  const { name, kind, role, widthBits, state } = control;
  const [draft, setDraft] = useState(() => formatFieldBytes(kind, hexToBytesArray(state.hex)));
  const [invalid, setInvalid] = useState(false);

  // Re-seed the draft whenever the underlying value/mode changes from outside (mode switch, layer
  // reselection) so the input never goes stale — mirrors FieldDetail's own reset discipline.
  useEffect(() => {
    setDraft(formatFieldBytes(kind, hexToBytesArray(state.hex)));
    setInvalid(false);
  }, [kind, state.hex, state.mode]);

  function commit(text: string) {
    setDraft(text);
    const bytes = kind === "bytes" ? hexToBytes(text) : parseStructuredValue(kind, text, widthBits);
    if (bytes === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onValue(name, bytesToHex(bytes));
  }

  const readOnly = !isUserEditable(role);
  const autoActive = state.mode === "auto";
  // Auto-linked fields disable their input while Auto (the assembler computes the value).
  const inputDisabled = readOnly || (hasTriState(role) && autoActive);

  return (
    <div className={invalid ? "composer-field invalid" : "composer-field"}>
      <label className="composer-field-name" htmlFor={`f-${name}`}>
        {name}
        <span className={`composer-field-role role-${role}`}>{roleLabel(role)}</span>
      </label>
      {hasTriState(role) && (
        <div className="composer-tristate" role="radiogroup" aria-label={`${name} mode`}>
          {(["auto", "pinned", "invalid"] as FieldMode[]).map((m) => (
            <button
              key={m}
              className={state.mode === m ? "theme-option active" : "theme-option"}
              aria-pressed={state.mode === m}
              onClick={() => onMode(name, m)}
            >
              {m === "auto" ? "Auto" : m === "pinned" ? "Pin" : "Invalid"}
            </button>
          ))}
        </div>
      )}
      <input
        id={`f-${name}`}
        className="box-input composer-field-input"
        value={inputDisabled && hasTriState(role) && autoActive ? "" : draft}
        placeholder={inputDisabled && hasTriState(role) && autoActive ? "auto (linked at assemble)" : undefined}
        disabled={inputDisabled}
        spellCheck={false}
        onChange={(e) => commit(e.currentTarget.value)}
      />
    </div>
  );
}

function roleLabel(role: ControlSpec["role"]): string {
  switch (role) {
    case "derived":
      return "derived";
    case "auto_linked":
      return "linked";
    case "fixed":
      return "fixed";
    case "editable":
      return "";
  }
}
