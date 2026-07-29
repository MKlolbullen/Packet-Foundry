import { useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  type Operation,
  type OpKind,
  childLabels,
  controlFlowLayout,
  defaultOperation,
  getChildren,
  isReserved,
  opKind,
} from "./operation";
import { bytesToHex, hexToBytesArray } from "./hex";
import { PALETTE_KIND_MIME, SUBTREE_JSON_MIME } from "./dnd";

export interface BoxNodeProps {
  op: Operation;
  path: number[];
  /** Renders the tree for viewing only — no drag/drop, no param inputs, no list controls. Used
   * by the workspace's read-only computation-axis view. Defaults to false. */
  readOnly?: boolean;
  onChange?: (path: number[], newOp: Operation) => void;
  onInsert?: (parentPath: number[], index: number, newOp: Operation) => void;
  onRemoveItem?: (path: number[]) => void;
  onMoveItem?: (path: number[], direction: -1 | 1) => void;
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
function HexBytesField({
  value,
  onCommit,
  disabled,
}: {
  value: number[];
  onCommit: (bytes: number[]) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(bytesToHex(value));
  const parsed = hexToBytesArray(text);
  const valid = text.trim() === "" ? true : parsed.length > 0 || text.trim().replace(/\s+/g, "") === "";
  return (
    <input
      className={`box-input hex-input${valid ? "" : " invalid"}`}
      value={text}
      placeholder="hex bytes, e.g. deadbeef"
      disabled={disabled}
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

function NumberField({
  value,
  onCommit,
  min = 0,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <input
      className="box-input number-input"
      type="number"
      min={min}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const v = e.currentTarget.valueAsNumber;
        if (!Number.isNaN(v)) onCommit(Math.max(min, Math.trunc(v)));
      }}
    />
  );
}

function TextField({
  value,
  onCommit,
  disabled,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input className="box-input" value={value} disabled={disabled} onChange={(e) => onCommit(e.currentTarget.value)} />
  );
}

/** Kind-specific scalar parameter inputs — every leaf field an `Operation` variant carries that
 * isn't itself a child operation (bytes, ranges, widths, shift amounts, box/function names).
 * When `disabled`, the real values still render but every input is inert. */
function ParamInputs({
  op,
  onChange,
  disabled,
}: {
  op: Operation;
  onChange: (newOp: Operation) => void;
  disabled?: boolean;
}) {
  if ("Const" in op) {
    return <HexBytesField value={op.Const} onCommit={(bytes) => onChange({ Const: bytes })} disabled={disabled} />;
  }
  if ("ReadRange" in op) {
    const { start_bit, len_bits } = op.ReadRange;
    return (
      <>
        <label className="param-label">start bit</label>
        <NumberField
          value={start_bit}
          onCommit={(v) => onChange({ ReadRange: { start_bit: v, len_bits } })}
          disabled={disabled}
        />
        <label className="param-label">len bits</label>
        <NumberField
          value={len_bits}
          onCommit={(v) => onChange({ ReadRange: { start_bit, len_bits: v } })}
          disabled={disabled}
        />
      </>
    );
  }
  if ("ReadFrom" in op) {
    return (
      <>
        <label className="param-label">from byte</label>
        <NumberField
          value={op.ReadFrom.from_byte}
          onCommit={(v) => onChange({ ReadFrom: { from_byte: v } })}
          disabled={disabled}
        />
      </>
    );
  }
  if ("ByteLength" in op) {
    const { from_byte, width } = op.ByteLength;
    return (
      <>
        <label className="param-label">from byte</label>
        <NumberField
          value={from_byte}
          onCommit={(v) => onChange({ ByteLength: { from_byte: v, width } })}
          disabled={disabled}
        />
        <label className="param-label">width</label>
        <NumberField
          value={width}
          onCommit={(v) => onChange({ ByteLength: { from_byte, width: v } })}
          disabled={disabled}
        />
      </>
    );
  }
  if ("Shl" in op) {
    return (
      <>
        <label className="param-label">bits</label>
        <NumberField value={op.Shl[1]} onCommit={(v) => onChange({ Shl: [op.Shl[0], v] })} disabled={disabled} />
      </>
    );
  }
  if ("Shr" in op) {
    return (
      <>
        <label className="param-label">bits</label>
        <NumberField value={op.Shr[1]} onCommit={(v) => onChange({ Shr: [op.Shr[0], v] })} disabled={disabled} />
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
          disabled={disabled}
        />
      </>
    );
  }
  if ("Call" in op) {
    return (
      <>
        <label className="param-label">name</label>
        <TextField value={op.Call.name} onCommit={(name) => onChange({ Call: { name } })} disabled={disabled} />
      </>
    );
  }
  return null;
}

export default function BoxNode({
  op,
  path,
  readOnly = false,
  onChange,
  onInsert,
  onRemoveItem,
  onMoveItem,
}: BoxNodeProps) {
  const [dragOver, setDragOver] = useState(false);
  const [appendDragOver, setAppendDragOver] = useState(false);
  const kind = opKind(op);
  const labels = childLabels(op);
  const children = getChildren(op);
  const reserved = isReserved(op);
  const layout = controlFlowLayout(op);

  function handleDrop(e: DragEvent) {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = readDraggedOperation(e);
    if (dropped) onChange?.(path, dropped);
  }

  function handleAppendDrop(e: DragEvent) {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setAppendDragOver(false);
    const dropped = readDraggedOperation(e);
    if (dropped) onInsert?.(path, children.length, dropped);
  }

  function childAt(index: number) {
    return (
      <BoxNode
        op={children[index]}
        path={[...path, index]}
        readOnly={readOnly}
        onChange={onChange}
        onInsert={onInsert}
        onRemoveItem={onRemoveItem}
        onMoveItem={onMoveItem}
      />
    );
  }

  const containerClass = `box-node kind-${reserved ? "reserved" : "primitive"}${layout ? " control-flow" : ""}${dragOver ? " drag-over" : ""}`;
  const containerHandlers = readOnly
    ? {}
    : {
        onDragOver: (e: DragEvent) => {
          if (acceptsDrop(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        onDragEnter: (e: DragEvent) => {
          if (acceptsDrop(e)) setDragOver(true);
        },
        onDragLeave: () => setDragOver(false),
        onDrop: handleDrop,
      };
  function header(extraClass: string, content?: ReactNode) {
    return (
      <div
        className={`box-header${extraClass}`}
        draggable={!readOnly}
        onDragStart={
          readOnly
            ? undefined
            : (e: DragEvent) => {
                e.dataTransfer.setData(SUBTREE_JSON_MIME, JSON.stringify(op));
                e.dataTransfer.effectAllowed = "copy";
              }
        }
      >
        <span className="box-kind">{kind}</span>
        {reserved && <span className="box-reserved-badge">reserved</span>}
        {content}
      </div>
    );
  }

  // Control-flow kinds (Loop, If) render as a Scratch/Blockly-style "C-block": their scalar-ish
  // slot (count / cond) sits inline in the header, and each remaining slot becomes an indented,
  // rail-connected body section instead of a plain labeled slot.
  if (layout && Array.isArray(labels)) {
    const inlineContent = layout.inline.map((label) => {
      const i = labels.indexOf(label);
      return (
        <div className="cf-inline-slot" key={label}>
          <span className="slot-label">{label}</span>
          {childAt(i)}
        </div>
      );
    });
    return (
      <div className={containerClass} {...containerHandlers}>
        {header(" cf-header", inlineContent)}
        {layout.blocks.map(({ label, caption }) => {
          const i = labels.indexOf(label);
          return (
            <div className="cf-block" key={label}>
              <div className="cf-rail" />
              <div className="cf-block-inner">
                <span className="cf-caption">{caption}</span>
                {childAt(i)}
              </div>
            </div>
          );
        })}
        <div className="cf-close" />
      </div>
    );
  }

  return (
    <div className={containerClass} {...containerHandlers}>
      {header(
        "",
        <ParamInputs
          op={op}
          onChange={readOnly ? () => {} : (newOp) => onChange?.(path, newOp)}
          disabled={readOnly}
        />,
      )}

      {labels === "list" && (
        <div className="box-children list">
          {children.map((_, i) => (
            <div className="list-item" key={i}>
              {!readOnly && (
                <div className="list-item-controls">
                  <button
                    type="button"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => onMoveItem?.([...path, i], -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={i === children.length - 1}
                    onClick={() => onMoveItem?.([...path, i], 1)}
                  >
                    ↓
                  </button>
                  <button type="button" title="Remove" onClick={() => onRemoveItem?.([...path, i])}>
                    ×
                  </button>
                </div>
              )}
              {childAt(i)}
            </div>
          ))}
          {!readOnly && (
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
          )}
        </div>
      )}

      {Array.isArray(labels) && (
        <div className="box-children fixed">
          {labels.map((label, i) => (
            <div className="fixed-slot" key={label}>
              <span className="slot-label">{label}</span>
              {childAt(i)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
