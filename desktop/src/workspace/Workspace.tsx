import { useEffect, useMemo, useReducer, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PacketDocument, ProtocolSpec } from "../types";
import { formatFieldValue, hexToBytes, locationString } from "../packet";
import SplitPane from "../SplitPane";
import Composer from "../composer/Composer";
import Breadcrumbs from "./Breadcrumbs";
import PacketOutline from "./PacketOutline";
import SemanticStage from "./SemanticStage";
import DiagnosticsPanel from "./DiagnosticsPanel";
import HexBitRail from "./HexBitRail";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import { INITIAL_DOCUMENT_HISTORY, documentHistoryReducer } from "./documentHistory";
import "./workspace.css";

/** Document-mutation state and actions, grouped into one prop — these all move together (they
 * all touch the same undo/redo stack), the same way camera navigation callbacks already come
 * bundled through useWorkspace()'s WorkspaceApi rather than as loose props. */
interface DocumentEditApi {
  onDocumentChange: (document: PacketDocument) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

// The Inspect pane's document view — kept as the old flat, non-navigable tree this PR (paste a
// document's JSON, see its layers/fields/diagnostics). Not re-plumbed through WorkspaceContext:
// whether "Inspect" also gets the full semantic-camera treatment is scoped to a later PR.
function InspectPacketTree({ doc }: { doc: PacketDocument }) {
  const bytes = hexToBytes(doc.buffer);
  if (bytes === null) {
    return <p className="error">Malformed buffer: `{doc.buffer}` is not valid hex.</p>;
  }
  return (
    <div className="tree">
      <p className="tree-summary">
        {bytes.length} bytes · {doc.layers.length} layer{doc.layers.length === 1 ? "" : "s"}
      </p>
      {doc.layers.map((layer) => (
        <div className="layer" key={layer.id}>
          <div className="layer-name">
            {layer.name} <span className="loc">{locationString(layer.range)}</span>
          </div>
          <table className="fields">
            <tbody>
              {layer.fields.map((field) => (
                <tr key={field.id}>
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
        </div>
      ))}
      <DiagnosticsPanel diagnostics={doc.diagnostics} />
    </div>
  );
}

// The navigable structure-axis workspace — outline | stage | diagnostics, with a hex rail below
// and breadcrumbs above. Everything here reads `doc` via props; camera/focus state comes from
// WorkspaceContext.
function SemanticWorkspace({
  doc,
  active,
  edit,
}: {
  doc: PacketDocument | null;
  active: boolean;
  edit: DocumentEditApi;
}) {
  const { camera, dive, jump, rise, back, forward, selectRange } = useWorkspace();

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      const isTextEntry = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (and +Y as an alternate redo) drive document undo/redo —
      // gated off text-entry targets so native browser undo still wins inside the stack/inspect
      // JSON textareas and FieldDetail's hex-edit input, instead of being hijacked.
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
      if (e.key === "Escape") {
        rise();
      } else if (e.altKey && e.key === "ArrowLeft") {
        back();
      } else if (e.altKey && e.key === "ArrowRight") {
        forward();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, rise, back, forward, edit]);

  if (!doc) {
    return <p className="hint">Assemble a stack to explore it here.</p>;
  }

  return (
    <div className="semantic-workspace">
      <div className="row workspace-history-row">
        <Breadcrumbs document={doc} camera={camera} onJump={jump} />
        <div className="doc-history-controls">
          <button onClick={edit.onUndo} disabled={!edit.canUndo} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button onClick={edit.onRedo} disabled={!edit.canRedo} title="Redo (Ctrl+Shift+Z)">
            ↷ Redo
          </button>
        </div>
      </div>
      <div className="semantic-workspace-grid">
        <PacketOutline document={doc} focus={camera.target} onJump={jump} />
        <div className="semantic-workspace-stage">
          <SemanticStage
            document={doc}
            focus={camera.target}
            selection={camera.selectedRange ? { source: camera.target, range: camera.selectedRange } : undefined}
            onDive={dive}
            onSelect={(selection) => selectRange(selection.range)}
            onDocumentChange={edit.onDocumentChange}
          />
        </div>
        <div className="workspace-diagnostics">
          <DiagnosticsPanel diagnostics={doc.diagnostics} selectedRange={camera.selectedRange} />
        </div>
      </div>
      <HexBitRail buffer={doc.buffer} selectedRange={camera.selectedRange} diagnostics={doc.diagnostics} />
    </div>
  );
}

export default function Workspace({ active }: { active: boolean }) {
  const [stackText, setStackText] = useState("");
  // "compose" builds a stack visually (the default entry point); "spec" edits the raw
  // ProtocolSpec[] JSON; "bytes" dissects a raw hex capture backward. All three feed the same doc,
  // so the whole workspace works on any of them.
  const [inputMode, setInputMode] = useState<"compose" | "spec" | "bytes">("compose");
  const [hexText, setHexText] = useState("");
  const [docState, dispatchDoc] = useReducer(documentHistoryReducer, INITIAL_DOCUMENT_HISTORY);
  const doc = docState.current;
  const [error, setError] = useState<string | null>(null);

  const [inspectText, setInspectText] = useState("");
  const [inspectDoc, setInspectDoc] = useState<PacketDocument | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

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

  async function assemble(protocols: ProtocolSpec[]) {
    try {
      const built = await invoke<PacketDocument>("create_packet", { protocols });
      dispatchDoc({ type: "SET", document: built });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  // Seed the Spec-mode textarea with the default stack for when the user switches to it. The
  // initial assemble is driven by the Composer (the default mode), which seeds and builds the same
  // stack itself — so we don't also assemble here and race two SETs onto the document.
  useEffect(() => {
    (async () => {
      const stack = await invoke<ProtocolSpec[]>("default_stack");
      setStackText(JSON.stringify(stack, null, 2));
    })();
  }, []);

  async function onAssembleClick() {
    try {
      const protocols: ProtocolSpec[] = JSON.parse(stackText);
      await assemble(protocols);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onDissectClick() {
    try {
      const dissected = await invoke<PacketDocument>("dissect_hex", { hex: hexText });
      dispatchDoc({ type: "SET", document: dissected });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onInspectClick() {
    try {
      const loaded = await invoke<PacketDocument>("inspect_packet", { documentJson: inspectText });
      setInspectDoc(loaded);
      setInspectError(null);
    } catch (e) {
      setInspectError(String(e));
    }
  }

  function sendToInspector() {
    if (!doc) return;
    setInspectText(JSON.stringify(doc, null, 2));
  }

  return (
    <SplitPane
      direction="horizontal"
      defaultSize={760}
      minSize={480}
      minSecondSize={260}
      storageKey="split.build-inspect"
      active={active}
      first={
        <section className="pane">
          <h2>Build</h2>
          <div className="edit-mode-toggle" role="radiogroup" aria-label="Input mode">
            <button
              className={inputMode === "compose" ? "theme-option active" : "theme-option"}
              aria-pressed={inputMode === "compose"}
              onClick={() => setInputMode("compose")}
            >
              Compose
            </button>
            <button
              className={inputMode === "spec" ? "theme-option active" : "theme-option"}
              aria-pressed={inputMode === "spec"}
              onClick={() => setInputMode("spec")}
            >
              Spec JSON
            </button>
            <button
              className={inputMode === "bytes" ? "theme-option active" : "theme-option"}
              aria-pressed={inputMode === "bytes"}
              onClick={() => setInputMode("bytes")}
            >
              Dissect bytes
            </button>
          </div>
          {inputMode === "compose" && (
            <Composer onDocument={(d) => dispatchDoc({ type: "SET", document: d })} onError={setError} />
          )}
          {inputMode === "spec" && (
            <>
              <p className="hint">Edit the protocol stack (an array of `ProtocolSpec`) and assemble it.</p>
              <textarea
                className="json-editor small"
                value={stackText}
                onChange={(e) => setStackText(e.currentTarget.value)}
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onAssembleClick}>Assemble</button>
                <button onClick={sendToInspector} disabled={!doc}>
                  Send to Inspect →
                </button>
              </div>
            </>
          )}
          {inputMode === "bytes" && (
            <>
              <p className="hint">
                Paste a raw packet's hex (an Ethernet II frame — spaces and newlines are fine) and
                dissect it into layers and fields.
              </p>
              <textarea
                className="json-editor small"
                value={hexText}
                onChange={(e) => setHexText(e.currentTarget.value)}
                placeholder="ffffffffffff 020000000001 0800 4500 2c00 …"
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onDissectClick} disabled={!hexText.trim()}>
                  Dissect
                </button>
              </div>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <WorkspaceProvider>
            <SemanticWorkspace doc={doc} active={active} edit={edit} />
          </WorkspaceProvider>
        </section>
      }
      second={
        <section className="pane">
          <h2>Inspect</h2>
          <p className="hint">Paste a packet document's JSON and load it — bytes never change, only diagnostics.</p>
          <textarea
            className="json-editor"
            value={inspectText}
            onChange={(e) => setInspectText(e.currentTarget.value)}
            placeholder="Paste packet document JSON here…"
            spellCheck={false}
          />
          <div className="row">
            <button onClick={onInspectClick} disabled={!inspectText}>
              Inspect
            </button>
          </div>
          {inspectError && <p className="error">{inspectError}</p>}
          {inspectDoc && <InspectPacketTree doc={inspectDoc} />}
        </section>
      }
    />
  );
}
