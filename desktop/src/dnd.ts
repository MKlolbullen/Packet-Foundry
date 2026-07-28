// Drag payload MIME types shared between the palette and the box tree. A palette drag carries
// just a kind name (the drop target builds a fresh default instance); a box-header drag carries
// the dragged subtree's own JSON, so dropping it elsewhere copies that subtree — the source is
// left untouched, which sidesteps ever having an invalid, child-less fixed slot mid-drag.
export const PALETTE_KIND_MIME = "application/x-packet-foundry-op-kind";
export const SUBTREE_JSON_MIME = "application/x-packet-foundry-op-json";
