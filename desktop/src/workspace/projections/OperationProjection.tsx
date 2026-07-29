import { useEffect } from "react";
import BoxNode from "../../BoxNode";
import Viewport from "../../Viewport";
import { EVALUABLE_KINDS, RESERVED_KINDS, type Operation } from "../../operation";
import { locationString } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import { findField, type FocusTarget } from "../focus";

type OperationFocus = Extract<FocusTarget, { kind: "operation" }>;

const OP_KINDS = new Set<string>([...EVALUABLE_KINDS, ...RESERVED_KINDS]);

function looksLikeOperation(value: unknown): value is Operation {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && OP_KINDS.has(keys[0]);
}

// Read-only "computation axis" view: a field's derivation rendered with the same BoxNode the Box
// Editor uses, just non-interactive — no drag/drop, no param edits, no mutation. Per-operation-
// node addressing (diving into a sub-node of the tree) is future work; this shows the whole tree.
export default function OperationProjection({ document, focus, onSelect }: ProjectionProps<OperationFocus>) {
  const field = findField(document, focus.layerId, focus.fieldId);

  useEffect(() => {
    if (field) onSelect({ source: focus, range: field.range });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.layerId, focus.fieldId]);

  if (!field) {
    return <p className="hint">This field is no longer present — the stack was re-assembled.</p>;
  }
  if (!looksLikeOperation(field.derivation)) {
    return <p className="hint">This field has no derivation to inspect.</p>;
  }

  return (
    <div className="operation-projection">
      <p className="operation-projection-header">
        {field.name} <span className="loc">{locationString(field.range)}</span>
      </p>
      <Viewport>
        <BoxNode op={field.derivation} path={[]} readOnly />
      </Viewport>
    </div>
  );
}
