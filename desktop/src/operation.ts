// The `Operation` IR, mirrored from crates/packet-core/src/operation.rs's serde (default,
// externally-tagged) JSON shape. This file is the box editor's whole data model: a plain,
// immutable JSON tree that round-trips byte-for-byte through the Tauri IPC boundary — no
// translation layer, what you edit here is what gets sent to `evaluate_operation`.
import type { BitRange } from "./types";

export type Operation =
  | { Const: number[] }
  | { ReadRange: BitRange }
  | { ReadFrom: { from_byte: number } }
  | { Concat: Operation[] }
  | { And: [Operation, Operation] }
  | { Or: [Operation, Operation] }
  | { Xor: [Operation, Operation] }
  | { Not: Operation }
  | { Shl: [Operation, number] }
  | { Shr: [Operation, number] }
  | { OnesComplementSum: Operation[] }
  | { ByteLength: { from_byte: number; width: number } }
  | { Composite: { name: string; body: Operation } }
  | { Add: [Operation, Operation] }
  | { Sub: [Operation, Operation] }
  | { Loop: { count: Operation; body: Operation } }
  | { If: { cond: Operation; then_branch: Operation; else_branch: Operation } }
  | { Call: { name: string } };

export type OpKind =
  | "Const"
  | "ReadRange"
  | "ReadFrom"
  | "Concat"
  | "And"
  | "Or"
  | "Xor"
  | "Not"
  | "Shl"
  | "Shr"
  | "OnesComplementSum"
  | "ByteLength"
  | "Composite"
  | "Add"
  | "Sub"
  | "Loop"
  | "If"
  | "Call";

/** Kinds the Phase 1 evaluator executes today. */
export const EVALUABLE_KINDS: OpKind[] = [
  "Const",
  "ReadRange",
  "ReadFrom",
  "Concat",
  "And",
  "Or",
  "Xor",
  "Not",
  "Shl",
  "Shr",
  "OnesComplementSum",
  "ByteLength",
  "Composite",
];

/** Kinds parsed/serialized but rejected by the evaluator — see `Operation::is_reserved`. */
export const RESERVED_KINDS: OpKind[] = ["Add", "Sub", "Loop", "If", "Call"];

export function opKind(op: Operation): OpKind {
  return Object.keys(op)[0] as OpKind;
}

export function isReserved(op: Operation): boolean {
  return RESERVED_KINDS.includes(opKind(op));
}

/**
 * Child slot labels for a kind: `null` for leaves with no operation children, `"list"` for
 * variable-length children (Concat/OnesComplementSum), or the fixed slot names in order.
 */
export function childLabels(op: Operation): string[] | "list" | null {
  if ("Concat" in op || "OnesComplementSum" in op) return "list";
  if ("And" in op || "Or" in op || "Xor" in op || "Add" in op || "Sub" in op) return ["a", "b"];
  if ("Not" in op) return ["value"];
  if ("Shl" in op || "Shr" in op) return ["value"];
  if ("Composite" in op) return ["body"];
  if ("Loop" in op) return ["count", "body"];
  if ("If" in op) return ["cond", "then", "else"];
  return null;
}

/** This node's operation children, in order — the uniform addressing scheme every path-based
 * helper below walks. Kinds with scalar-only data (Const, ReadRange, ReadFrom, ByteLength, Call)
 * have none. */
export function getChildren(op: Operation): Operation[] {
  if ("Concat" in op) return op.Concat;
  if ("OnesComplementSum" in op) return op.OnesComplementSum;
  if ("And" in op) return op.And;
  if ("Or" in op) return op.Or;
  if ("Xor" in op) return op.Xor;
  if ("Add" in op) return op.Add;
  if ("Sub" in op) return op.Sub;
  if ("Not" in op) return [op.Not];
  if ("Shl" in op) return [op.Shl[0]];
  if ("Shr" in op) return [op.Shr[0]];
  if ("Composite" in op) return [op.Composite.body];
  if ("Loop" in op) return [op.Loop.count, op.Loop.body];
  if ("If" in op) return [op.If.cond, op.If.then_branch, op.If.else_branch];
  return [];
}

/** Rebuild `op` with its operation children replaced, preserving every scalar field (bits,
 * width, name, ...). `children.length` must match `getChildren(op).length` for fixed-arity
 * kinds; list kinds (Concat/OnesComplementSum) accept any length. */
export function setChildren(op: Operation, children: Operation[]): Operation {
  if ("Concat" in op) return { Concat: children };
  if ("OnesComplementSum" in op) return { OnesComplementSum: children };
  if ("And" in op) return { And: [children[0], children[1]] };
  if ("Or" in op) return { Or: [children[0], children[1]] };
  if ("Xor" in op) return { Xor: [children[0], children[1]] };
  if ("Add" in op) return { Add: [children[0], children[1]] };
  if ("Sub" in op) return { Sub: [children[0], children[1]] };
  if ("Not" in op) return { Not: children[0] };
  if ("Shl" in op) return { Shl: [children[0], op.Shl[1]] };
  if ("Shr" in op) return { Shr: [children[0], op.Shr[1]] };
  if ("Composite" in op) return { Composite: { name: op.Composite.name, body: children[0] } };
  if ("Loop" in op) return { Loop: { count: children[0], body: children[1] } };
  if ("If" in op) {
    return { If: { cond: children[0], then_branch: children[1], else_branch: children[2] } };
  }
  return op;
}

/** Read the node at `path`, where each element is an index into `getChildren` at that level. */
export function getAtPath(root: Operation, path: number[]): Operation {
  let node = root;
  for (const i of path) node = getChildren(node)[i];
  return node;
}

/** Functional update: replace the node at `path` with `value`, rebuilding every ancestor. */
export function setAtPath(root: Operation, path: number[], value: Operation): Operation {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const children = getChildren(root);
  const newChildren = children.slice();
  newChildren[head] = setAtPath(children[head], rest, value);
  return setChildren(root, newChildren);
}

/** Remove the node at `path` from its parent's child list. Only valid when the parent is a
 * list-kind (Concat/OnesComplementSum) — callers gate this on `childLabels(parent) === "list"`. */
export function removeAtPath(root: Operation, path: number[]): Operation {
  if (path.length === 0) throw new Error("cannot remove the root box");
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = getAtPath(root, parentPath);
  const children = getChildren(parent).slice();
  children.splice(index, 1);
  return setAtPath(root, parentPath, setChildren(parent, children));
}

/** Insert `value` at `index` in the list-kind node at `parentPath`. */
export function insertAtPath(
  root: Operation,
  parentPath: number[],
  index: number,
  value: Operation,
): Operation {
  const parent = getAtPath(root, parentPath);
  const children = getChildren(parent).slice();
  children.splice(index, 0, value);
  return setAtPath(root, parentPath, setChildren(parent, children));
}

/** Swap a list item with its previous (`-1`) or next (`+1`) sibling. */
export function moveListItem(
  root: Operation,
  parentPath: number[],
  index: number,
  direction: -1 | 1,
): Operation {
  const parent = getAtPath(root, parentPath);
  const children = getChildren(parent).slice();
  const target = index + direction;
  if (target < 0 || target >= children.length) return root;
  [children[index], children[target]] = [children[target], children[index]];
  return setAtPath(root, parentPath, setChildren(parent, children));
}

/** A fresh, evaluable default instance of `kind` — what dropping a palette chip creates. */
export function defaultOperation(kind: OpKind): Operation {
  switch (kind) {
    case "Const":
      return { Const: [0] };
    case "ReadRange":
      return { ReadRange: { start_bit: 0, len_bits: 8 } };
    case "ReadFrom":
      return { ReadFrom: { from_byte: 0 } };
    case "Concat":
      return { Concat: [] };
    case "And":
      return { And: [{ Const: [0xff] }, { Const: [0xff] }] };
    case "Or":
      return { Or: [{ Const: [0] }, { Const: [0] }] };
    case "Xor":
      return { Xor: [{ Const: [0] }, { Const: [0] }] };
    case "Not":
      return { Not: { Const: [0] } };
    case "Shl":
      return { Shl: [{ Const: [1] }, 1] };
    case "Shr":
      return { Shr: [{ Const: [1] }, 1] };
    case "OnesComplementSum":
      return { OnesComplementSum: [] };
    case "ByteLength":
      return { ByteLength: { from_byte: 0, width: 2 } };
    case "Composite":
      return { Composite: { name: "box", body: { Const: [0] } } };
    case "Add":
      return { Add: [{ Const: [0] }, { Const: [0] }] };
    case "Sub":
      return { Sub: [{ Const: [0] }, { Const: [0] }] };
    case "Loop":
      return { Loop: { count: { Const: [0] }, body: { Const: [0] } } };
    case "If":
      return { If: { cond: { Const: [0] }, then_branch: { Const: [0] }, else_branch: { Const: [0] } } };
    case "Call":
      return { Call: { name: "" } };
  }
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
}

export function hexToBytesArray(hex: string): number[] {
  const clean = hex.trim().replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return [];
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.substring(i, i + 2), 16));
  return out;
}
