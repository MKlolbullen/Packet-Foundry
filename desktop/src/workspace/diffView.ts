// Pure presentation/lookup helpers for the Changes panel. No causality logic lives here — that's
// the engine's; this only labels the diff the Rust `diff_packets` produced and maps a changed-field
// row back to its BitRange in the current document (so clicking it can cross-highlight).

import type { BitRange, FieldChange, FieldState, PacketDiff, PacketDocument } from "../types";

/** A short badge label for a field change — the causal classification made human. */
export function changeBadgeLabel(change: FieldChange): string {
  switch (change) {
    case "direct_edit":
      return "direct";
    case "derived_consequence":
      return "consequence";
    case "state_only":
      return "state";
    case "unchanged":
      return "";
  }
}

/** A state transition like "plain → pinned", for the state-only rows. */
export function stateTransitionLabel(before: FieldState, after: FieldState): string {
  return `${before} → ${after}`;
}

/** Whether the diff has anything worth showing (any layer status change, field change, byte range,
 * or diagnostics delta). */
export function hasChanges(diff: PacketDiff): boolean {
  const layerChange = diff.layers.some(
    (l) =>
      l.status === "added" ||
      l.status === "removed" ||
      l.fields_changed.length > 0 ||
      l.fields_added.length > 0 ||
      l.fields_removed.length > 0,
  );
  return (
    layerChange ||
    diff.bytes.changed.length > 0 ||
    diff.diagnostics.added.length > 0 ||
    diff.diagnostics.removed.length > 0
  );
}

/** The BitRange of `fieldName` within `layerName` in `doc`, for cross-highlighting a changed-field
 * row — or undefined if that layer/field isn't present (e.g. a removed field). */
export function fieldRangeInDoc(
  doc: PacketDocument,
  layerName: string,
  fieldName: string,
): BitRange | undefined {
  const layer = doc.layers.find((l) => l.name === layerName);
  return layer?.fields.find((f) => f.name === fieldName)?.range;
}
