import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PacketDocument, ProtocolCatalogEntry } from "../types";
import ProtocolPalette from "./ProtocolPalette";
import StackView from "./StackView";
import LayerInspector from "./LayerInspector";
import {
  EMPTY_MODEL,
  addLayer,
  moveLayer,
  paletteCandidates,
  removeLayer,
  setFieldMode,
  setFieldValue,
  toPayload,
  type ComposerModel,
  type FieldMode,
} from "./composerModel";

// The protocols the composer seeds with on first load — the same Ethernet/IPv4/TCP SYN the Spec
// mode's default_stack shows, so the workspace has something real to explore immediately.
const SEED_IDS = ["ethernet", "ipv4", "tcp"];

/** The visual protocol-stack composer: a palette, the ordered stack, and a descriptor-driven field
 * inspector. Emits `{ layers, pins }` to `create_packet_composed` and hands the resolved document
 * up via `onDocument`; all form metadata comes from the engine's `list_protocols` catalogue. */
export default function Composer({
  onDocument,
  onError,
}: {
  onDocument: (doc: PacketDocument) => void;
  onError: (message: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<ProtocolCatalogEntry[]>([]);
  const [model, setModel] = useState<ComposerModel>(EMPTY_MODEL);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const keyCounter = useRef(0);
  const nextKey = () => `L${keyCounter.current++}`;

  const candidates = useMemo(() => paletteCandidates(catalog, model), [catalog, model]);
  const selectedLayer = model.layers.find((l) => l.key === selectedKey) ?? null;
  const selectedEntry = selectedLayer
    ? catalog.find((e) => e.id === selectedLayer.protocolId) ?? null
    : null;

  async function assemble(current: ComposerModel) {
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
        await assemble(seeded);
      } catch (e) {
        onError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onAdd(entry: ProtocolCatalogEntry) {
    const key = nextKey();
    setModel((m) => addLayer(m, entry, key));
    setSelectedKey(key);
  }

  function onRemove(key: string) {
    setModel((m) => removeLayer(m, key));
    setSelectedKey((cur) => (cur === key ? null : cur));
  }

  const onMove = (key: string, dir: -1 | 1) => setModel((m) => moveLayer(m, key, dir));
  const onValue = (field: string, hex: string) =>
    selectedKey && setModel((m) => setFieldValue(m, selectedKey, field, hex));
  const onFieldMode = (field: string, mode: FieldMode) =>
    selectedKey && setModel((m) => setFieldMode(m, selectedKey, field, mode));

  return (
    <div className="composer">
      <p className="hint">
        Build a packet visually: add protocols from the palette, click a layer to edit its fields.
        Auto-linked fields (EtherType, IP protocol) fill in on assemble unless you pin them.
      </p>
      <div className="row composer-toolbar">
        <button onClick={() => assemble(model)} disabled={model.layers.length === 0}>
          Assemble
        </button>
        <button className="composer-code-toggle" onClick={() => setShowCode((v) => !v)}>
          {showCode ? "Hide JSON" : "Show JSON"}
        </button>
      </div>
      <div className="composer-panes">
        <ProtocolPalette catalog={catalog} candidates={candidates} onAdd={onAdd} />
        <StackView
          model={model}
          catalog={catalog}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          onMove={onMove}
          onRemove={onRemove}
        />
        <LayerInspector entry={selectedEntry} layer={selectedLayer} onValue={onValue} onMode={onFieldMode} />
      </div>
      {showCode && (
        <textarea
          className="json-editor small composer-code"
          readOnly
          value={JSON.stringify(toPayload(model), null, 2)}
          spellCheck={false}
          aria-label="Composed packet JSON (read-only)"
        />
      )}
    </div>
  );
}
