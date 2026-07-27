import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import BoxNode from "./BoxNode";
import Viewport, { type ViewportHandle } from "./Viewport";
import {
  EVALUABLE_KINDS,
  RESERVED_KINDS,
  type Operation,
  type OpKind,
  defaultOperation,
  insertAtPath,
  moveListItem,
  removeAtPath,
  setAtPath,
} from "./operation";
import { PALETTE_KIND_MIME } from "./dnd";

// The known-good IPv4 header vector from protocol-engine's eval tests (checksum field zeroed) —
// evaluating the starter tree against it should print `b861`, the documented reference checksum.
const STARTER_BUFFER =
  "450000730000400040110000c0a80001c0a800c7";

const STARTER_OP: Operation = {
  Composite: {
    name: "internet_checksum",
    body: { OnesComplementSum: [{ ReadRange: { start_bit: 0, len_bits: 160 } }] },
  },
};

// A For-loop-shaped example (Loop is reserved — Evaluate will report it as such — but this gives
// the C-block control-flow styling something realistic to show off): repeat a Const body Const-N
// times.
const LOOP_EXAMPLE_OP: Operation = {
  Loop: { count: { Const: [4] }, body: { Const: [0xaa] } },
};

function PaletteChip({ kind }: { kind: OpKind }) {
  return (
    <div
      className="palette-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_KIND_MIME, kind);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={`Drag onto a box to drop a ${kind}`}
    >
      {kind}
    </div>
  );
}

export default function BoxEditor() {
  const [root, setRoot] = useState<Operation>(STARTER_OP);
  const [bufferHex, setBufferHex] = useState(STARTER_BUFFER);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scalePct, setScalePct] = useState(100);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const viewportRef = useRef<ViewportHandle>(null);

  function onChange(path: number[], newOp: Operation) {
    setRoot((r) => setAtPath(r, path, newOp));
  }
  function onInsert(parentPath: number[], index: number, newOp: Operation) {
    setRoot((r) => insertAtPath(r, parentPath, index, newOp));
  }
  function onRemoveItem(path: number[]) {
    setRoot((r) => removeAtPath(r, path));
  }
  function onMoveItem(path: number[], direction: -1 | 1) {
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1];
    setRoot((r) => moveListItem(r, parentPath, index, direction));
  }

  async function onEvaluate() {
    try {
      const hex = await invoke<string>("evaluate_operation", { op: root, bufferHex });
      setResult(hex);
      setError(null);
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  }

  function onClear() {
    setRoot(defaultOperation("Const"));
    setResult(null);
    setError(null);
  }

  async function onCopyJson() {
    const text = JSON.stringify(root, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("Copied");
    } catch {
      setCopyFeedback("Copy failed — clipboard unavailable");
    }
    setTimeout(() => setCopyFeedback(null), 1500);
  }

  function onImport() {
    try {
      const parsed = JSON.parse(importText) as Operation;
      setRoot(parsed);
      setImportError(null);
      setImportOpen(false);
      setImportText("");
    } catch (e) {
      setImportError(String(e));
    }
  }

  return (
    <div className="box-editor">
      <aside className="palette">
        <h2>Boxes</h2>
        <p className="hint">Drag a box onto the canvas — onto a slot to fill it, or onto an existing box to replace it.</p>
        <h3>Evaluable</h3>
        <div className="palette-group">
          {EVALUABLE_KINDS.map((k) => (
            <PaletteChip kind={k} key={k} />
          ))}
        </div>
        <h3>Reserved (not yet evaluable)</h3>
        <p className="hint">
          Parsed &amp; serialized, but the Phase 1 evaluator rejects them — see{" "}
          <code>Operation::is_reserved</code>.
        </p>
        <div className="palette-group">
          {RESERVED_KINDS.map((k) => (
            <PaletteChip kind={k} key={k} />
          ))}
        </div>
        <h3>Presets</h3>
        <div className="row wrap">
          <button onClick={() => setRoot(STARTER_OP)}>Checksum example</button>
          <button onClick={() => setRoot(LOOP_EXAMPLE_OP)}>Loop example</button>
          <button onClick={onClear}>Empty</button>
        </div>
      </aside>

      <section className="canvas">
        <div className="canvas-toolbar">
          <h2>Canvas</h2>
          <div className="toolbar-controls">
            <button title="Zoom out" onClick={() => viewportRef.current?.zoomOut()}>
              −
            </button>
            <span className="zoom-readout">{scalePct}%</span>
            <button title="Zoom in" onClick={() => viewportRef.current?.zoomIn()}>
              +
            </button>
            <button title="Reset view" onClick={() => viewportRef.current?.reset()}>
              Reset
            </button>
            <button title="Fit to view" onClick={() => viewportRef.current?.fit()}>
              Fit
            </button>
            <span className="toolbar-sep" />
            <button title="Reset the canvas to an empty box" onClick={onClear}>
              Clear
            </button>
            <button title="Copy this tree's JSON to the clipboard" onClick={onCopyJson}>
              Copy JSON
            </button>
            <button title="Load a tree from pasted JSON" onClick={() => setImportOpen((v) => !v)}>
              Import JSON
            </button>
            {copyFeedback && <span className="toolbar-feedback">{copyFeedback}</span>}
          </div>
        </div>

        {importOpen && (
          <div className="import-bar">
            <textarea
              className="json-editor small"
              value={importText}
              onChange={(e) => setImportText(e.currentTarget.value)}
              placeholder="Paste an Operation JSON tree…"
              spellCheck={false}
            />
            <div className="row">
              <button onClick={onImport}>Load</button>
              <button onClick={() => setImportOpen(false)}>Cancel</button>
            </div>
            {importError && <p className="error">{importError}</p>}
          </div>
        )}

        <p className="hint">Drag empty canvas to pan, scroll to zoom.</p>
        <Viewport ref={viewportRef} className="canvas-tree" onTransformChange={(t) => setScalePct(Math.round(t.scale * 100))}>
          <BoxNode
            op={root}
            path={[]}
            onChange={onChange}
            onInsert={onInsert}
            onRemoveItem={onRemoveItem}
            onMoveItem={onMoveItem}
          />
        </Viewport>

        <div className="evaluate-bar">
          <label className="param-label">scratch buffer (hex)</label>
          <input
            className="box-input hex-input"
            value={bufferHex}
            onChange={(e) => setBufferHex(e.currentTarget.value)}
            spellCheck={false}
          />
          <button onClick={onEvaluate}>Evaluate</button>
        </div>
        {error && <p className="error">{error}</p>}
        {result !== null && (
          <p className="eval-result">
            = <code>{result || "(empty)"}</code>
          </p>
        )}
      </section>
    </div>
  );
}
