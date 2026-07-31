// Pure, testable model for the visual protocol-stack composer. Holds no React state and does no
// IPC — it turns the engine's protocol catalogue plus user edits into the `{ layers, pins }`
// payload `create_packet_composed` consumes. Every user-entered value rides as a FieldPin, so this
// module needs zero per-protocol parameter knowledge (no `SrcPort`↔`src_port` mapping): a layer is
// just a protocol id, and its fields carry opaque hex bytes keyed by the catalogue field name.

import { bytesToHex, hexToBytesArray } from "../hex";
import type { FieldKind, FieldPin, ParameterDescriptor, ParameterRole, ProtocolCatalogEntry } from "../types";

/** Auto = let the assembler decide (no pin); Pinned = a chosen value; Invalid = a deliberately
 * wrong value. Pinned and Invalid are the same to the engine (both emit a pin) — the split is a UI
 * label so a user can mark intent. Editable fields only ever use "auto" (default) or "pinned". */
export type FieldMode = "auto" | "pinned" | "invalid";

export interface FieldState {
  mode: FieldMode;
  /** Current bytes as hex, in the FieldPin encoding; seeded from the descriptor default. */
  hex: string;
}

export interface ComposerLayer {
  /** Stable identity for React lists / selection — supplied by the caller (see `makeLayer`). */
  key: string;
  protocolId: string;
  /** Field state keyed by catalogue field name. */
  fields: Record<string, FieldState>;
}

export interface ComposerModel {
  layers: ComposerLayer[];
}

export interface ComposedLayerPayload {
  protocol: string;
  /** Only meaningful for `raw` — its payload bytes live in the spec, not a pin. */
  raw_bytes?: number[];
}

export interface ComposerPayload {
  layers: ComposedLayerPayload[];
  pins: FieldPin[];
}

/** A field's initial state: unedited (Auto), seeded with the engine default for display. */
export function defaultFieldState(desc: ParameterDescriptor): FieldState {
  return { mode: "auto", hex: bytesToHex(desc.default) };
}

function bytesToValue(bytes: number[]): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b & 0xff);
  return v;
}

/** Render a field's pin bytes as a per-kind display/edit string — the inverse of fieldEdit's
 * `parseStructuredValue` over the same right-aligned pin encoding, so the inspector round-trips.
 * (`bytes` fields — the Raw payload — are shown/edited as plain hex.) */
export function formatFieldBytes(kind: FieldKind, bytes: number[]): string {
  switch (kind) {
    case "uint":
      return bytesToValue(bytes).toString();
    case "flags":
      return `0x${bytesToValue(bytes).toString(16)}`;
    case "mac_addr":
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join(":");
    case "ipv4_addr":
      return bytes.join(".");
    case "ipv6_addr": {
      const groups: string[] = [];
      for (let i = 0; i < bytes.length; i += 2) {
        groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16).padStart(4, "0"));
      }
      return groups.join(":");
    }
    case "bytes":
      return bytesToHex(bytes);
  }
}

/** A fresh composer layer for `entry`, with `key` as its stable identity. */
export function makeLayer(entry: ProtocolCatalogEntry, key: string): ComposerLayer {
  const fields: Record<string, FieldState> = {};
  for (const desc of entry.fields) fields[desc.name] = defaultFieldState(desc);
  return { key, protocolId: entry.id, fields };
}

export const EMPTY_MODEL: ComposerModel = { layers: [] };

/** Whether a user can type a value into this field (Editable and AutoLinked); Derived/Fixed are
 * read-only. */
export function isUserEditable(role: ParameterRole): boolean {
  return role === "editable" || role === "auto_linked";
}

/** Whether this field shows the Auto/Pin/Invalid tri-state — only the auto-linked next-protocol
 * fields, whose value the assembler would otherwise compute. */
export function hasTriState(role: ParameterRole): boolean {
  return role === "auto_linked";
}

/** The protocol ids the palette should offer given the current stack: roots for an empty stack,
 * else the tail layer's allowed children (so ordering follows the engine's compatibility rules). */
export function paletteCandidates(catalog: ProtocolCatalogEntry[], model: ComposerModel): string[] {
  if (model.layers.length === 0) {
    return catalog.filter((e) => e.allowed_parents.length === 0).map((e) => e.id);
  }
  const tail = model.layers[model.layers.length - 1];
  const entry = catalog.find((e) => e.id === tail.protocolId);
  return entry ? [...entry.allowed_children] : [];
}

/** Turn the model into the `create_packet_composed` payload: protocol ids plus the pins for every
 * non-Auto field. `raw` layers carry their bytes in `raw_bytes` (its value is the spec, not a pin);
 * for every other protocol, a field emits a pin exactly when its mode is not "auto". */
export function toPayload(model: ComposerModel): ComposerPayload {
  const layers: ComposedLayerPayload[] = [];
  const pins: FieldPin[] = [];
  model.layers.forEach((layer, index) => {
    if (layer.protocolId === "raw") {
      const data = layer.fields.Data;
      layers.push({ protocol: "raw", raw_bytes: data ? hexToBytesArray(data.hex) : [] });
      return;
    }
    layers.push({ protocol: layer.protocolId });
    for (const [name, state] of Object.entries(layer.fields)) {
      if (state.mode !== "auto") {
        pins.push({ layer_index: index, field_name: name, bytes: hexToBytesArray(state.hex) });
      }
    }
  });
  return { layers, pins };
}

/** A per-field control plan the inspector renders — the catalogue descriptor zipped with its live
 * state, so the React layer stays declarative. */
export interface ControlSpec {
  name: string;
  kind: FieldKind;
  role: ParameterRole;
  widthBits: number;
  state: FieldState;
}

export function formControlsFor(entry: ProtocolCatalogEntry, layer: ComposerLayer): ControlSpec[] {
  return entry.fields.map((desc) => ({
    name: desc.name,
    kind: desc.kind,
    role: desc.role,
    widthBits: desc.width_bits,
    state: layer.fields[desc.name] ?? defaultFieldState(desc),
  }));
}

// --- Pure model transitions (return a new model; the React layer holds the current one) ---

export function addLayer(model: ComposerModel, entry: ProtocolCatalogEntry, key: string): ComposerModel {
  return { layers: [...model.layers, makeLayer(entry, key)] };
}

export function removeLayer(model: ComposerModel, key: string): ComposerModel {
  return { layers: model.layers.filter((l) => l.key !== key) };
}

/** Move the layer with `key` one step toward the head (`-1`) or tail (`+1`); a no-op at the edge. */
export function moveLayer(model: ComposerModel, key: string, dir: -1 | 1): ComposerModel {
  const i = model.layers.findIndex((l) => l.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= model.layers.length) return model;
  const layers = [...model.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { layers };
}

function updateField(
  model: ComposerModel,
  layerKey: string,
  fieldName: string,
  next: (s: FieldState) => FieldState,
): ComposerModel {
  return {
    layers: model.layers.map((l) => {
      if (l.key !== layerKey) return l;
      const current = l.fields[fieldName];
      if (!current) return l;
      return { ...l, fields: { ...l.fields, [fieldName]: next(current) } };
    }),
  };
}

/** Set a field's hex value. For an editable field this marks it Pinned; for an auto-linked field
 * already in Pinned/Invalid it just updates the bytes (mode unchanged). */
export function setFieldValue(
  model: ComposerModel,
  layerKey: string,
  fieldName: string,
  hex: string,
): ComposerModel {
  return updateField(model, layerKey, fieldName, (s) => ({
    mode: s.mode === "auto" ? "pinned" : s.mode,
    hex,
  }));
}

/** Set an auto-linked field's tri-state mode. Switching to Auto clears the pin; switching to
 * Pinned/Invalid keeps the current hex as the override value. */
export function setFieldMode(
  model: ComposerModel,
  layerKey: string,
  fieldName: string,
  mode: FieldMode,
): ComposerModel {
  return updateField(model, layerKey, fieldName, (s) => ({ ...s, mode }));
}
