import BoxNode from "../../BoxNode";
import Viewport from "../../Viewport";
import { EVALUABLE_KINDS, RESERVED_KINDS, type Operation } from "../../operation";

const OP_KINDS = new Set<string>([...EVALUABLE_KINDS, ...RESERVED_KINDS]);

/** A value is an Operation if it's a single-tag object whose tag is a known op kind — the shape
 * `Field.derivation` carries. Shared so FieldDetail's inline derivation and the full-screen
 * OperationProjection agree on what counts as inspectable. */
export function looksLikeOperation(value: unknown): value is Operation {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && OP_KINDS.has(keys[0]);
}

/** A field's derivation rendered read-only with the same BoxNode the Box Editor uses — no
 * drag/drop, param edits, or mutation. The single renderer behind both the in-place derivation
 * (inside FieldDetail) and the dedicated computation-axis view. */
export default function DerivationView({ op }: { op: Operation }) {
  return (
    <Viewport>
      <BoxNode op={op} path={[]} readOnly />
    </Viewport>
  );
}
