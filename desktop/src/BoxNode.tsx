import { useState } from "react";
import type { DragEvent } from "react";
import {
  type Operation,
  type OpKind,
  bytesToHex,
  childLabels,
  defaultOperation,
  getChildren,
  hexToBytesArray,
  isReserved,
  opKind,
} from "./operation";
import { PALETTE_KIND_MIME, SUBTREE_JSON_MIME } from "./dnd";

export interface BoxNodeProps {
  op: Operation;
  path: number[];
  onChange: (path: number[], newOp: Operation) => void;
  onInsert: (parentPath: number[], index: number, newOp: Operation) => void;
  onRemoveItem: (path: number[]) => void;
  onMoveItem: (path: number[], direction: -1 | 1) => void;
}

function readDraggedOperation(e: DragEvent): Operation | null {
  const subtreeJson = e.dataTransfer.getData(SUBTREE_JSON_MIME);
  if (subtreeJson) {
    try {
      return JSON.parse(subtreeJson) as Operation;
    } catch {
      return null;
    }
  }
  const kind = e.dataTransfer.getData(PALETTE_KIND_MIME);
  return kind ? defaultOperation(kind as OpKind) : null;
}

function acceptsDrop(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(PALETTE_KIND_MIME) || e.dataTransfer.types.includes(SUBTREE_JSON_MIME);
}

/** A hex-bytes field that only pushes upward once the text parses cleanly, so mid-edit states
 * (odd digit count, stray characters) don't fight the caller's Operation. */
function HexBytesField({ value, onCommit }: { value: number[]; onCommit: (bytes: number[]) => void }) {
  const [text, setText] = useState(bytesToHex(value));
  const parsed = hexToBytesArray(text);
  const valid = text.trim() === "" ? true : parsed.length > 0 || text.trim().replace(/\s+/g, "") === "";
  return (
    <input
      className={`box-input hex-input${valid ? "" : " invalid"}`}
      value={text}
      placeholder="hex bytes, e.g. deadbeef"
      onChange={(e) => {
        const next = e.currentTarget.value;
        setText(next);
        const bytes = hexToBytesArray(next);
        if (next.trim() === "") onCommit([]);
        else if (bytes.length > 0) onCommit(bytes);
      }}
    />
  );
}

function NumberField({ value, onCommit, min = 0 }: { value: number; onCommit: (v: number) => void; min?: number }) {
  return (
    <input
      className="box-input number-input"
      type="number"
      min={min}
      value={value}
      onChange={(e) => {
        const v = e.currentTarget.valueAsNumber;
        if (!Number.isNaN(v)) onCommit(Math.max(min, Math.trunc(v)));
      }}
    />
  );
}

function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return (
    <input className="box-input" value={value} onChange={(e) => onCommit(e.currentTarget.value)} />
  );
}

/** Kind-specific scalar parameter inputs — every leaf field an `Operation` variant carries that
 * isn't itself a child operation (bytes, ranges, widths, shift amounts, box/function names). */
function ParamInputs({ op, onChange }: { op: Operation; onChange: (newOp: Operation) => void }) {
  if ("Const" in op) {
    return <HexBytesField value={op.Const} onCommit={(bytes) => onChange({ Const: bytes })} />;
  }
  if ("ReadRange" in op) {
    const { start_bit, len_bits } = op.ReadRange;
    return (
      <>
        <label className="param-label">start bit</label>
        <NumberField value={start_bit} onCommit={(v) => onChange({ ReadRange: { start_bit: v, len_bits } })} />
        <label className="param-label">len bits</label>
        <NumberField value={len_bits} onCommit={(v) => onChange({ ReadRange: { start_bit, len_bits: v } })} />
      </>
    );
  }
  if ("ReadFrom" in op) {
    return (
      <>
        <label className="param-label">from byte</label>
        <NumberField value={op.ReadFrom.from_byte} onCommit={(v) => onChange({ ReadFrom: { from_byte: v } })} />
      </>
    );
  }
  if ("ByteLength" in op) {
    const { from_byte, width } = op.ByteLength;
    return (
      <>
        <label className="param-label">from byte</label>
        <NumberField value={from_byte} onCommit={(v) => onChange({ ByteLength: { from_byte: v, width } })} />
        <label className="param-label">width</label>
        <NumberField value={width} onCommit={(v) => onChange({ ByteLength: { from_byte, width: v } })} />
      </>
    );
  }
  if ("Shl" in op) {
    return (
      <>
        <label className="param-label">bits</label>
        <NumberField value={op.Shl[1]} onCommit={(v) => onChange({ Shl: [op.Shl[0], v] })} />
      </>
    );
  }
  if ("Shr" in op) {
    return (
      <>
        <label className="param-label">bits</label>
        <NumberField value={op.Shr[1]} onCommit={(v) => onChange({ Shr: [op.Shr[0], v] })} />
      </>
    );
  }
  if ("Composite" in op) {
    return (
      <>
        <label className="param-label">name</label>
        <TextField
          value={op.Composite.name}
          onCommit={(name) => onChange({ Composite: { name, body: op.Composite.body } })}
        />
      </>
    );
  }
  if ("Call" in op) {
    return (
      <>
        <label className="param-label">name</label>
        <TextField value={op.Call.name} onCommit={(name) => onChange({ Call: { name } })} />
      </>
    );
  }
  return null;
}

export default function BoxNode({ op, path, onChange, onInsert, onRemoveItem, onMoveItem }: BoxNodeProps) {
  const [dragOver, setDragOver] = useState(false);
  const [appendDragOver, setAppendDragOver] = useState(false);
  const kind = opKind(op);
  const labels = childLabels(op);
  const children = getChildren(op);
  const reserved = isReserved(op);

  function handleDrop(e: DragEvent) {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = readDraggedOperation(e);
    if (dropped) onChange(path, dropped);
  }

  function handleAppendDrop(e: DragEvent) {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setAppendDragOver(false);
    const dropped = readDraggedOperation(e);
    if (dropped) onInsert(path, children.length, dropped);
  }

  return (
    <div
      className={`box-node kind-${reserved ? "reserved" : "primitive"}${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        if (acceptsDrop(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDragEnter={(e) => {
        if (acceptsDrop(e)) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div
        className="box-header"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SUBTREE_JSON_MIME, JSON.stringify(op));
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        <span className="box-kind">{kind}</span>
        {reserved && <span className="box-reserved-badge">reserved</span>}
        <ParamInputs op={op} onChange={(newOp) => onChange(path, newOp)} />
      </div>

      {labels === "list" && (
        <div className="box-children list">
          {children.map((child, i) => (
            <div className="list-item" key={i}>
              <div className="list-item-controls">
                <button
                  type="button"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => onMoveItem([...path, i], -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={i === children.length - 1}
                  onClick={() => onMoveItem([...path, i], 1)}
                >
                  ↓
                </button>
                <button type="button" title="Remove" onClick={() => onRemoveItem([...path, i])}>
                  ×
                </button>
              </div>
              <BoxNode
                op={child}
                path={[...path, i]}
                onChange={onChange}
                onInsert={onInsert}
                onRemoveItem={onRemoveItem}
                onMoveItem={onMoveItem}
              />
            </div>
          ))}
          <div
            className={`append-zone${appendDragOver ? " drag-over" : ""}`}
            onDragOver={(e) => {
              if (acceptsDrop(e)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onDragEnter={(e) => {
              if (acceptsDrop(e)) setAppendDragOver(true);
            }}
            onDragLeave={() => setAppendDragOver(false)}
            onDrop={handleAppendDrop}
          >
            + drop a box here to append
          </div>
        </div>
      )}

      {Array.isArray(labels) && (
        <div className="box-children fixed">
          {labels.map((label, i) => (
            <div className="fixed-slot" key={label}>
              <span className="slot-label">{label}</span>
              <BoxNode
                op={children[i]}
                path={[...path, i]}
                onChange={onChange}
                onInsert={onInsert}
                onRemoveItem={onRemoveItem}
                onMoveItem={onMoveItem}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
