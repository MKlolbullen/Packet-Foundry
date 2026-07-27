import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import BoxNode from "./BoxNode";
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
        <div className="row">
          <button onClick={() => setRoot(STARTER_OP)}>Checksum example</button>
          <button onClick={() => setRoot(defaultOperation("Const"))}>Empty</button>
        </div>
      </aside>

      <section className="canvas">
        <h2>Canvas</h2>
        <div className="canvas-tree">
          <BoxNode
            op={root}
            path={[]}
            onChange={onChange}
            onInsert={onInsert}
            onRemoveItem={onRemoveItem}
            onMoveItem={onMoveItem}
          />
        </div>

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
