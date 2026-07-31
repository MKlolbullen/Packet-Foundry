// Bit-width-aware layer layout: tile a layer's fields into 32-bit rows so a header renders as its
// real wire shape (field width ∝ bit width), the way RFC header diagrams are drawn. Pure and
// data-driven — it reads only each field's BitRange, so it works for any protocol (VLAN, ICMPv6,
// …) with no per-protocol code. Returns null when the fields don't tile a clean grid (overlap,
// out-of-range, a single blob field, or too tall), and the caller falls back to the field table.

import type { Field, Layer } from "../types";

/** Bits per diagram row — the classic 32-bit-wide packet header layout. */
export const ROW_BITS = 32;

/** Rows past this are almost certainly an opaque payload, not a structured header — fall back. */
const MAX_ROWS = 16;

export interface DiagramSegment {
  /** The field this segment belongs to, or undefined for an unfielded gap. */
  field?: Field;
  /** 0-based bit column within the row, and how many columns it spans. */
  colStart: number;
  colSpan: number;
  /** True on a field's first (leftmost/topmost) segment — where the label anchors. */
  isLead: boolean;
}

export interface DiagramRow {
  segments: DiagramSegment[];
}

/** Lay a layer's fields out into 32-bit rows, or null if they don't form a clean grid. */
export function computeLayerDiagram(layer: Layer): DiagramRow[] | null {
  const layerStart = layer.range.start_bit;
  const layerLen = layer.range.len_bits;
  if (layerLen <= 0 || layer.fields.length === 0) return null;

  // A single field covering the whole layer is an opaque blob (Raw/Payload/Options) — the table
  // says more than a one-cell diagram would.
  if (layer.fields.length === 1 && layer.fields[0].range.len_bits === layerLen) return null;

  if (Math.ceil(layerLen / ROW_BITS) > MAX_ROWS) return null;

  // Build a hole-free sequence of runs over [0, layerLen): each field, with gaps filled in.
  const sorted = [...layer.fields].sort((a, b) => a.range.start_bit - b.range.start_bit);
  const runs: { start: number; len: number; field?: Field }[] = [];
  let cursor = 0;
  for (const field of sorted) {
    const rel = field.range.start_bit - layerStart;
    const len = field.range.len_bits;
    if (rel < cursor) return null; // overlap
    if (rel + len > layerLen) return null; // extends past the layer
    if (rel > cursor) runs.push({ start: cursor, len: rel - cursor }); // gap
    runs.push({ start: rel, len, field });
    cursor = rel + len;
  }
  if (cursor < layerLen) runs.push({ start: cursor, len: layerLen - cursor }); // trailing gap

  // Split each run at row boundaries into per-row segments.
  const rows: DiagramRow[] = Array.from({ length: Math.ceil(layerLen / ROW_BITS) }, () => ({
    segments: [],
  }));
  for (const run of runs) {
    let pos = run.start;
    let remaining = run.len;
    let lead = true;
    while (remaining > 0) {
      const rowIndex = Math.floor(pos / ROW_BITS);
      const col = pos % ROW_BITS;
      const span = Math.min(remaining, ROW_BITS - col);
      rows[rowIndex].segments.push({
        field: run.field,
        colStart: col,
        colSpan: span,
        isLead: lead && run.field !== undefined,
      });
      pos += span;
      remaining -= span;
      lead = false;
    }
  }
  return rows;
}
