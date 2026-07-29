import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PacketDocument, ProtocolSpec } from "../types";
import { formatFieldValue, hexToBytes, locationString } from "../packet";
import SplitPane from "../SplitPane";
import Breadcrumbs from "./Breadcrumbs";
import PacketOutline from "./PacketOutline";
import SemanticStage from "./SemanticStage";
import DiagnosticsPanel from "./DiagnosticsPanel";
import HexBitRail from "./HexBitRail";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import "./workspace.css";

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
function SemanticWorkspace({ doc, active }: { doc: PacketDocument | null; active: boolean }) {
  const { camera, dive, jump, rise, back, forward, selectRange } = useWorkspace();

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
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
  }, [active, rise, back, forward]);

  if (!doc) {
    return <p className="hint">Assemble a stack to explore it here.</p>;
  }

  return (
    <div className="semantic-workspace">
      <Breadcrumbs document={doc} camera={camera} onJump={jump} />
      <div className="semantic-workspace-grid">
        <PacketOutline document={doc} focus={camera.target} onJump={jump} />
        <div className="semantic-workspace-stage">
          <SemanticStage
            document={doc}
            focus={camera.target}
            selection={camera.selectedRange ? { source: camera.target, range: camera.selectedRange } : undefined}
            onDive={dive}
            onSelect={(selection) => selectRange(selection.range)}
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
  const [doc, setDoc] = useState<PacketDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inspectText, setInspectText] = useState("");
  const [inspectDoc, setInspectDoc] = useState<PacketDocument | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  async function assemble(protocols: ProtocolSpec[]) {
    try {
      const built = await invoke<PacketDocument>("create_packet", { protocols });
      setDoc(built);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    (async () => {
      const stack = await invoke<ProtocolSpec[]>("default_stack");
      setStackText(JSON.stringify(stack, null, 2));
      await assemble(stack);
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
          {error && <p className="error">{error}</p>}
          <WorkspaceProvider>
            <SemanticWorkspace doc={doc} active={active} />
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
