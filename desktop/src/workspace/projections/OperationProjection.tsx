import { useEffect } from "react";
import { locationString } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import { findField, type FocusTarget } from "../focus";
import DerivationView, { looksLikeOperation } from "./DerivationView";

type OperationFocus = Extract<FocusTarget, { kind: "operation" }>;

// Read-only "computation axis" view: a field's derivation rendered full-canvas with the same
// BoxNode the Box Editor uses, just non-interactive. Per-operation-node addressing (diving into a
// sub-node of the tree) is future work; this shows the whole tree.
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
      <DerivationView op={field.derivation} />
    </div>
  );
}
