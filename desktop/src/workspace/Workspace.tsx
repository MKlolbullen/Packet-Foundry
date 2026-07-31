import { useEffect, useMemo, useReducer, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PacketDocument, ProtocolSpec } from "../types";
import ProtocolPalette from "../composer/ProtocolPalette";
import StackView from "../composer/StackView";
import LayerInspector from "../composer/LayerInspector";
import { useComposer } from "../composer/useComposer";
import Breadcrumbs from "./Breadcrumbs";
import SemanticStage from "./SemanticStage";
import DiagnosticsPanel from "./DiagnosticsPanel";
import HexBitRail from "./HexBitRail";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import { INITIAL_DOCUMENT_HISTORY, documentHistoryReducer } from "./documentHistory";
import "./workspace.css";

type InputMode = "compose" | "spec" | "dissect" | "load";

/** Document-mutation state and actions, grouped into one object — they all touch the same
 * undo/redo stack, mirroring how camera navigation callbacks come bundled through useWorkspace(). */
interface DocumentEditApi {
  onDocumentChange: (document: PacketDocument) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

type ComposerApi = ReturnType<typeof useComposer>;

// The center + right rails + hex rail: the always-visible semantic view of the current document,
// its per-field/per-layer inspector, diagnostics, and the byte rail. Reads `doc` via props; the
// camera/focus state comes from WorkspaceContext.
function WorkbenchStage({
  doc,
  active,
  edit,
  composer,
  mode,
}: {
  doc: PacketDocument | null;
  active: boolean;
  edit: DocumentEditApi;
  composer: ComposerApi;
  mode: InputMode;
}) {
  const { camera, dive, jump, rise, back, forward, selectRange } = useWorkspace();

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      const isTextEntry = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      // Ctrl/Cmd+Z / +Shift+Z (and +Y) drive document undo/redo — gated off text entry so native
      // undo still wins inside the JSON/hex textareas and field inputs.
      if (!isTextEntry && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) edit.onRedo();
        else edit.onUndo();
        return;
      }
      if (!isTextEntry && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        edit.onRedo();
        return;
      }
      if (e.key === "Escape") rise();
      else if (e.altKey && e.key === "ArrowLeft") back();
      else if (e.altKey && e.key === "ArrowRight") forward();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, rise, back, forward, edit]);

  const selection = camera.selectedRange
    ? { source: camera.target, range: camera.selectedRange }
    : undefined;

  return (
    <>
      <div className="workbench-center">
        <div className="row workbench-history-row">
          {doc ? <Breadcrumbs document={doc} camera={camera} onJump={jump} /> : <span className="breadcrumbs" />}
          <div className="doc-history-controls">
            <button onClick={edit.onUndo} disabled={!edit.canUndo} title="Undo (Ctrl+Z)">
              ↶ Undo
            </button>
            <button onClick={edit.onRedo} disabled={!edit.canRedo} title="Redo (Ctrl+Shift+Z)">
              ↷ Redo
            </button>
          </div>
        </div>
        <div className="workbench-stage">
          {doc ? (
            <SemanticStage
              document={doc}
              focus={camera.target}
              selection={selection}
              onDive={dive}
              onSelect={(sel) => selectRange(sel.range)}
              onDocumentChange={edit.onDocumentChange}
            />
          ) : (
            <p className="hint">Build or load a packet to explore it here.</p>
          )}
        </div>
      </div>

      <aside className="workbench-right">
        {mode === "compose" && (
          <LayerInspector
            entry={composer.selectedEntry}
            layer={composer.selectedLayer}
            onValue={composer.setValue}
            onMode={composer.setMode}
          />
        )}
        <div className="workbench-diagnostics">
          <DiagnosticsPanel diagnostics={doc?.diagnostics ?? []} selectedRange={camera.selectedRange} />
        </div>
      </aside>

      <div className="workbench-rail">
        <HexBitRail
          buffer={doc?.buffer ?? ""}
          document={doc ?? undefined}
          selectedRange={camera.selectedRange}
          diagnostics={doc?.diagnostics ?? []}
          onSelectRange={selectRange}
        />
      </div>
    </>
  );
}

export default function Workspace({ active }: { active: boolean }) {
  const [docState, dispatchDoc] = useReducer(documentHistoryReducer, INITIAL_DOCUMENT_HISTORY);
  const doc = docState.current;
  const [error, setError] = useState<string | null>(null);

  const [inputMode, setInputMode] = useState<InputMode>("compose");
  const [stackText, setStackText] = useState("");
  const [hexText, setHexText] = useState("");
  const [loadText, setLoadText] = useState("");
  const [showJson, setShowJson] = useState(false);

  const edit = useMemo<DocumentEditApi>(
    () => ({
      onDocumentChange: (document) => dispatchDoc({ type: "MUTATE", document }),
      canUndo: docState.undoStack.length > 0,
      canRedo: docState.redoStack.length > 0,
      onUndo: () => dispatchDoc({ type: "UNDO" }),
      onRedo: () => dispatchDoc({ type: "REDO" }),
    }),
    [docState],
  );

  const composer = useComposer(
    (d) => dispatchDoc({ type: "SET", document: d }),
    setError,
  );

  // Seed the Spec-mode textarea with the default stack for when the user switches to it. The
  // initial assemble is driven by the composer (the default mode), which seeds the same stack.
  useEffect(() => {
    (async () => {
      const stack = await invoke<ProtocolSpec[]>("default_stack");
      setStackText(JSON.stringify(stack, null, 2));
    })();
  }, []);

  async function onAssembleSpec() {
    try {
      const protocols: ProtocolSpec[] = JSON.parse(stackText);
      const built = await invoke<PacketDocument>("create_packet", { protocols });
      dispatchDoc({ type: "SET", document: built });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onDissect() {
    try {
      const dissected = await invoke<PacketDocument>("dissect_hex", { hex: hexText });
      dispatchDoc({ type: "SET", document: dissected });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onLoad() {
    try {
      const loaded = await invoke<PacketDocument>("inspect_packet", { documentJson: loadText });
      dispatchDoc({ type: "SET", document: loaded });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const MODES: { id: InputMode; label: string }[] = [
    { id: "compose", label: "Compose" },
    { id: "spec", label: "Spec JSON" },
    { id: "dissect", label: "Dissect bytes" },
    { id: "load", label: "Load JSON" },
  ];

  return (
    <WorkspaceProvider>
      <div className="workbench">
        <aside className="workbench-left">
          <div className="edit-mode-toggle workbench-modes" role="radiogroup" aria-label="Input mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={inputMode === m.id ? "theme-option active" : "theme-option"}
                aria-pressed={inputMode === m.id}
                onClick={() => setInputMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {inputMode === "compose" && (
            <div className="workbench-compose">
              <div className="row workbench-compose-actions">
                <button onClick={() => composer.assemble()} disabled={composer.model.layers.length === 0}>
                  Assemble
                </button>
                <button className="composer-code-toggle" onClick={() => setShowJson((v) => !v)}>
                  {showJson ? "Hide JSON" : "Show JSON"}
                </button>
              </div>
              <StackView
                model={composer.model}
                catalog={composer.catalog}
                selectedKey={composer.selectedKey}
                onSelect={composer.select}
                onMove={composer.move}
                onRemove={composer.remove}
              />
              <ProtocolPalette catalog={composer.catalog} candidates={composer.candidates} onAdd={composer.add} />
              {showJson && (
                <textarea
                  className="json-editor small composer-code"
                  readOnly
                  value={composer.payloadJson}
                  spellCheck={false}
                  aria-label="Composed packet JSON (read-only)"
                />
              )}
            </div>
          )}

          {inputMode === "spec" && (
            <div className="workbench-input">
              <p className="hint">Edit the protocol stack (an array of `ProtocolSpec`) and assemble it.</p>
              <textarea
                className="json-editor small"
                value={stackText}
                onChange={(e) => setStackText(e.currentTarget.value)}
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onAssembleSpec}>Assemble</button>
              </div>
            </div>
          )}

          {inputMode === "dissect" && (
            <div className="workbench-input">
              <p className="hint">
                Paste a raw packet's hex (an Ethernet II frame — spaces and newlines are fine) and dissect it.
              </p>
              <textarea
                className="json-editor small"
                value={hexText}
                onChange={(e) => setHexText(e.currentTarget.value)}
                placeholder="ffffffffffff 020000000001 0800 4500 2c00 …"
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onDissect} disabled={!hexText.trim()}>
                  Dissect
                </button>
              </div>
            </div>
          )}

          {inputMode === "load" && (
            <div className="workbench-input">
              <p className="hint">Paste a packet document's JSON and load it — bytes never change, only diagnostics.</p>
              <textarea
                className="json-editor small"
                value={loadText}
                onChange={(e) => setLoadText(e.currentTarget.value)}
                placeholder="Paste packet document JSON here…"
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onLoad} disabled={!loadText.trim()}>
                  Load
                </button>
              </div>
            </div>
          )}

          {error && <p className="error">{error}</p>}
        </aside>

        <WorkbenchStage doc={doc} active={active} edit={edit} composer={composer} mode={inputMode} />
      </div>
    </WorkspaceProvider>
  );
}
