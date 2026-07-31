import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PacketDocument, ProtocolCatalogEntry } from "../types";
import {
  EMPTY_MODEL,
  addLayer,
  moveLayer,
  paletteCandidates,
  removeLayer,
  setFieldMode,
  setFieldValue,
  toPayload,
  type ComposerLayer,
  type ComposerModel,
  type FieldMode,
} from "./composerModel";

// The protocols the composer seeds with on first load — the Ethernet/IPv4/TCP SYN the Spec mode's
// default_stack shows, so the workbench has something real to explore immediately.
const SEED_IDS = ["ethernet", "ipv4", "tcp"];

/** The composer's state and actions, lifted out of a single component so its palette, stack, and
 * layer inspector can be rendered in separate rails of the workbench (Phase 2 layout) rather than
 * boxed together. Owns the catalogue, the composer model, and the selected layer; assembling emits
 * `{ layers, pins }` to `create_packet_composed` and hands the document to `onDocument`. */
export interface ComposerApi {
  catalog: ProtocolCatalogEntry[];
  model: ComposerModel;
  selectedKey: string | null;
  candidates: string[];
  selectedEntry: ProtocolCatalogEntry | null;
  selectedLayer: ComposerLayer | null;
  payloadJson: string;
  add: (entry: ProtocolCatalogEntry) => void;
  remove: (key: string) => void;
  move: (key: string, dir: -1 | 1) => void;
  select: (key: string) => void;
  setValue: (field: string, hex: string) => void;
  setMode: (field: string, mode: FieldMode) => void;
  assemble: () => Promise<void>;
}

export function useComposer(
  onDocument: (doc: PacketDocument) => void,
  onError: (message: string | null) => void,
): ComposerApi {
  const [catalog, setCatalog] = useState<ProtocolCatalogEntry[]>([]);
  const [model, setModel] = useState<ComposerModel>(EMPTY_MODEL);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const keyCounter = useRef(0);
  const nextKey = () => `L${keyCounter.current++}`;

  const candidates = useMemo(() => paletteCandidates(catalog, model), [catalog, model]);
  const selectedLayer = model.layers.find((l) => l.key === selectedKey) ?? null;
  const selectedEntry = selectedLayer
    ? catalog.find((e) => e.id === selectedLayer.protocolId) ?? null
    : null;
  const payloadJson = useMemo(() => JSON.stringify(toPayload(model), null, 2), [model]);

  async function assembleModel(current: ComposerModel) {
    try {
      const { layers, pins } = toPayload(current);
      const doc = await invoke<PacketDocument>("create_packet_composed", { layers, pins });
      onDocument(doc);
      onError(null);
    } catch (e) {
      onError(String(e));
    }
  }

  // Load the catalogue once, seed the default stack, and assemble it.
  useEffect(() => {
    (async () => {
      try {
        const cat = await invoke<ProtocolCatalogEntry[]>("list_protocols");
        setCatalog(cat);
        let seeded = EMPTY_MODEL;
        for (const id of SEED_IDS) {
          const entry = cat.find((e) => e.id === id);
          if (entry) seeded = addLayer(seeded, entry, `L${keyCounter.current++}`);
        }
        setModel(seeded);
        setSelectedKey(seeded.layers[0]?.key ?? null);
        await assembleModel(seeded);
      } catch (e) {
        onError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    catalog,
    model,
    selectedKey,
    candidates,
    selectedEntry,
    selectedLayer,
    payloadJson,
    add: (entry) => {
      const key = nextKey();
      setModel((m) => addLayer(m, entry, key));
      setSelectedKey(key);
    },
    remove: (key) => {
      setModel((m) => removeLayer(m, key));
      setSelectedKey((cur) => (cur === key ? null : cur));
    },
    move: (key, dir) => setModel((m) => moveLayer(m, key, dir)),
    select: setSelectedKey,
    setValue: (field, hex) => selectedKey && setModel((m) => setFieldValue(m, selectedKey, field, hex)),
    setMode: (field, mode) => selectedKey && setModel((m) => setFieldMode(m, selectedKey, field, mode)),
    assemble: () => assembleModel(model),
  };
}
