import { useEffect } from "react";
import { formatFieldValue, hexToBytes, locationString } from "../../packet";
import type { ProjectionProps } from "../SemanticStage";
import { findField, type FocusTarget } from "../focus";

type FieldFocus = Extract<FocusTarget, { kind: "field" }>;

// Read-only single-field detail — no editing controls here, pinning/deriving is a later PR.
export default function FieldDetail({ document, focus, onSelect }: ProjectionProps<FieldFocus>) {
  const field = findField(document, focus.layerId, focus.fieldId);

  // Arriving at a field via dive auto-highlights its range elsewhere (hex rail, diagnostics)
  // without requiring an extra click.
  useEffect(() => {
    if (field) onSelect({ source: focus, range: field.range });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.layerId, focus.fieldId]);

  if (!field) {
    return <p className="hint">This field is no longer present — the stack was re-assembled.</p>;
  }

  const bytes = hexToBytes(document.buffer);
  const value = bytes ? formatFieldValue(bytes, field) : "<malformed buffer>";
  const state = field.override_bytes ? "pinned" : field.derivation ? "derived" : "plain";

  return (
    <dl className="field-detail">
      <dt>Name</dt>
      <dd>{field.name}</dd>
      <dt>Range</dt>
      <dd className="loc">{locationString(field.range)}</dd>
      <dt>Kind</dt>
      <dd>{field.kind}</dd>
      <dt>Value</dt>
      <dd className="field-value">{value}</dd>
      <dt>State</dt>
      <dd>{state}</dd>
    </dl>
  );
}
