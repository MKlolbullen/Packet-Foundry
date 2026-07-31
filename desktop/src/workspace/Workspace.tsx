import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PacketDiff, PacketDocument, ProtocolSpec } from "../types";
import { bytesToHex } from "../hex";
import { LINKTYPE_ETHERNET, frameTimestamp, type PcapFrame } from "../pcap";
import { parseCapture } from "../capture";
import { summarizeFrame } from "../framePeek";
import ProtocolPalette from "../composer/ProtocolPalette";
import StackView from "../composer/StackView";
import LayerInspector from "../composer/LayerInspector";
import { useComposer } from "../composer/useComposer";
import Breadcrumbs from "./Breadcrumbs";
import SemanticStage from "./SemanticStage";
import ChangesPanel from "./ChangesPanel";
import VariantsBar from "./VariantsBar";
import DiagnosticsPanel from "./DiagnosticsPanel";
import HexBitRail from "./HexBitRail";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import { INITIAL_DOCUMENT_HISTORY, documentHistoryReducer } from "./documentHistory";
import { diffSummary, type DiffSummary } from "./diffView";
import {
  INITIAL_VARIANT_STATE,
  variantById,
  variantsReducer,
  type VariantState,
} from "./variants";
import "./workspace.css";

/** Variant store + actions, grouped for the chip bar. */
interface VariantsApi {
  state: VariantState;
  summaries: Record<string, DiffSummary>;
  hasWorkingDoc: boolean;
  onSelect: (id: string) => void;
  onSave: () => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onSetBase: (id: string) => void;
}

type InputMode = "compose" | "spec" | "dissect" | "load" | "pcap";

/** Metadata about an opened capture, shown above the frame list. */
interface PcapMeta {
  linkType: number;
  nanos: boolean;
  truncated: boolean;
  capped: boolean;
  fileName: string;
}

/** Document-mutation state and actions, grouped into one object — they all touch the same
 * undo/redo stack, mirroring how camera navigation callbacks come bundled through useWorkspace(). */
interface DocumentEditApi {
  onDocumentChange: (document: PacketDocument) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

type ComposerApi = ReturnType<typeof useComposer>;

// The center + right rails + hex rail: the always-visible semantic view of the current document,
// its per-field/per-layer inspector, diagnostics, and the byte rail. Reads `doc` via props; the
// camera/focus state comes from WorkspaceContext.
function WorkbenchStage({
  doc,
  active,
  edit,
  composer,
  mode,
  diff,
  variants,
}: {
  doc: PacketDocument | null;
  active: boolean;
  edit: DocumentEditApi;
  composer: ComposerApi;
  mode: InputMode;
  diff: PacketDiff | null;
  variants: VariantsApi;
}) {
  const { camera, dive, jump, rise, back, forward, selectRange } = useWorkspace();

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      const isTextEntry = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      // Ctrl/Cmd+Z / +Shift+Z (and +Y) drive document undo/redo — gated off text entry so native
      // undo still wins inside the JSON/hex textareas and field inputs.
      if (!isTextEntry && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) edit.onRedo();
        else edit.onUndo();
        return;
      }
      if (!isTextEntry && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        edit.onRedo();
        return;
      }
      if (e.key === "Escape") rise();
      else if (e.altKey && e.key === "ArrowLeft") back();
      else if (e.altKey && e.key === "ArrowRight") forward();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, rise, back, forward, edit]);

  const selection = camera.selectedRange
    ? { source: camera.target, range: camera.selectedRange }
    : undefined;

  return (
    <>
      <div className="workbench-center">
        <VariantsBar
          state={variants.state}
          summaries={variants.summaries}
          hasWorkingDoc={variants.hasWorkingDoc}
          onSelect={variants.onSelect}
          onSave={variants.onSave}
          onRename={variants.onRename}
          onDelete={variants.onDelete}
          onSetBase={variants.onSetBase}
        />
        <div className="row workbench-history-row">
          {doc ? <Breadcrumbs document={doc} camera={camera} onJump={jump} /> : <span className="breadcrumbs" />}
          <div className="doc-history-controls">
            <button onClick={edit.onUndo} disabled={!edit.canUndo} title="Undo (Ctrl+Z)">
              ↶ Undo
            </button>
            <button onClick={edit.onRedo} disabled={!edit.canRedo} title="Redo (Ctrl+Shift+Z)">
              ↷ Redo
            </button>
          </div>
        </div>
        <div className="workbench-stage">
          {doc ? (
            <SemanticStage
              document={doc}
              focus={camera.target}
              selection={selection}
              onDive={dive}
              onSelect={(sel) => selectRange(sel.range)}
              onDocumentChange={edit.onDocumentChange}
            />
          ) : (
            <p className="hint">Build or load a packet to explore it here.</p>
          )}
        </div>
      </div>

      <aside className="workbench-right">
        {mode === "compose" && (
          <LayerInspector
            entry={composer.selectedEntry}
            layer={composer.selectedLayer}
            onValue={composer.setValue}
            onMode={composer.setMode}
          />
        )}
        {doc && diff && <ChangesPanel diff={diff} current={doc} onSelectRange={selectRange} />}
        <div className="workbench-diagnostics">
          <DiagnosticsPanel diagnostics={doc?.diagnostics ?? []} selectedRange={camera.selectedRange} />
        </div>
      </aside>

      <div className="workbench-rail">
        <HexBitRail
          buffer={doc?.buffer ?? ""}
          document={doc ?? undefined}
          selectedRange={camera.selectedRange}
          diagnostics={doc?.diagnostics ?? []}
          onSelectRange={selectRange}
        />
      </div>
    </>
  );
}

export default function Workspace({ active }: { active: boolean }) {
  const [docState, dispatchDoc] = useReducer(documentHistoryReducer, INITIAL_DOCUMENT_HISTORY);
  const doc = docState.current;
  const [error, setError] = useState<string | null>(null);

  const [inputMode, setInputMode] = useState<InputMode>("compose");
  const [stackText, setStackText] = useState("");
  const [hexText, setHexText] = useState("");
  const [loadText, setLoadText] = useState("");
  const [pcapFrames, setPcapFrames] = useState<PcapFrame[] | null>(null);
  const [pcapMeta, setPcapMeta] = useState<PcapMeta | null>(null);
  const [pcapFrameIndex, setPcapFrameIndex] = useState<number | null>(null);
  const [pcapFilter, setPcapFilter] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [diff, setDiff] = useState<PacketDiff | null>(null);
  const [variants, dispatchVariants] = useReducer(variantsReducer, INITIAL_VARIANT_STATE);
  const [summaries, setSummaries] = useState<Record<string, DiffSummary>>({});
  const variantIdCounter = useRef(0);

  const edit = useMemo<DocumentEditApi>(
    () => ({
      onDocumentChange: (document) => dispatchDoc({ type: "MUTATE", document }),
      canUndo: docState.undoStack.length > 0,
      canRedo: docState.redoStack.length > 0,
      onUndo: () => dispatchDoc({ type: "UNDO" }),
      onRedo: () => dispatchDoc({ type: "REDO" }),
    }),
    [docState],
  );

  // Shallow protocol peek per frame for the list labels; recomputed only when a new file is opened.
  const pcapRows = useMemo(
    () => (pcapFrames ?? []).map((frame) => ({ frame, summary: summarizeFrame(frame.data) })),
    [pcapFrames],
  );
  const visiblePcapRows = useMemo(() => {
    const q = pcapFilter.trim().toLowerCase();
    if (!q) return pcapRows;
    return pcapRows.filter(
      ({ frame, summary }) =>
        `#${frame.index} ${summary.label} ${summary.info}`.toLowerCase().includes(q),
    );
  }, [pcapRows, pcapFilter]);

  const composer = useComposer(
    (d) => dispatchDoc({ type: "SET", document: d }),
    setError,
  );

  // Seed the Spec-mode textarea with the default stack for when the user switches to it. The
  // initial assemble is driven by the composer (the default mode), which seeds the same stack.
  useEffect(() => {
    (async () => {
      const stack = await invoke<ProtocolSpec[]>("default_stack");
      setStackText(JSON.stringify(stack, null, 2));
    })();
  }, []);

  // The "Changes" diff: current document against its previous undo snapshot ("what did my last
  // edit change, and what cascaded?"). Empty undo stack (a fresh assemble/dissect/load resets it)
  // → no diff. The ignore flag drops a stale async result if a fast edit sequence outruns it.
  useEffect(() => {
    const base = docState.undoStack[docState.undoStack.length - 1];
    if (!base || !docState.current) {
      setDiff(null);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const d = await invoke<PacketDiff>("diff_packets", { base, variant: docState.current });
        if (!ignore) setDiff(d);
      } catch {
        if (!ignore) setDiff(null);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [docState.current, docState.undoStack]);

  // Per-variant diff against the base — the `·N` change count on each chip. One invoke per non-base
  // variant; fine for a handful (a future batch command could scale it). Stale-guarded, and keyed on
  // items/baseId so merely switching the active variant doesn't recompute every diff.
  useEffect(() => {
    const base = variantById(variants, variants.baseId);
    if (!base) {
      setSummaries({});
      return;
    }
    let ignore = false;
    (async () => {
      const next: Record<string, DiffSummary> = {};
      for (const v of variants.items) {
        if (v.id === base.id) continue;
        try {
          const d = await invoke<PacketDiff>("diff_packets", { base: base.doc, variant: v.doc });
          next[v.id] = diffSummary(d);
        } catch {
          // Leave this variant without a count rather than failing the whole map.
        }
      }
      if (!ignore) setSummaries(next);
    })();
    return () => {
      ignore = true;
    };
  }, [variants.items, variants.baseId]);

  const variantsApi = useMemo<VariantsApi>(
    () => ({
      state: variants,
      summaries,
      hasWorkingDoc: doc !== null,
      onSelect: (id) => {
        const v = variantById(variants, id);
        if (!v) return;
        dispatchVariants({ type: "SELECT", id });
        dispatchDoc({ type: "SET", document: v.doc });
      },
      onSave: () => {
        if (!doc) return;
        variantIdCounter.current += 1;
        const n = variantIdCounter.current;
        dispatchVariants({ type: "SAVE", id: `v${n}`, label: `Variant ${n}`, doc });
      },
      onRename: (id, label) => dispatchVariants({ type: "RENAME", id, label }),
      onDelete: (id) => dispatchVariants({ type: "DELETE", id }),
      onSetBase: (id) => dispatchVariants({ type: "SET_BASE", id }),
    }),
    [variants, summaries, doc],
  );

  async function onAssembleSpec() {
    try {
      const protocols: ProtocolSpec[] = JSON.parse(stackText);
      const built = await invoke<PacketDocument>("create_packet", { protocols });
      dispatchDoc({ type: "SET", document: built });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onDissect() {
    try {
      const dissected = await invoke<PacketDocument>("dissect_hex", { hex: hexText });
      dispatchDoc({ type: "SET", document: dissected });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onLoad() {
    try {
      const loaded = await invoke<PacketDocument>("inspect_packet", { documentJson: loadText });
      dispatchDoc({ type: "SET", document: loaded });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onPickPcap(file: File | undefined) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cap = parseCapture(bytes);
      setPcapFrames(cap.frames);
      setPcapMeta({
        linkType: cap.linkType,
        nanos: cap.nanos,
        truncated: cap.truncated,
        capped: cap.capped,
        fileName: file.name,
      });
      setPcapFrameIndex(null);
      setPcapFilter(""); // a filter from a previous file must not hide the new capture's frames
      setError(cap.frames.length === 0 ? "No frames in this capture." : null);
    } catch (e) {
      setPcapFrames(null);
      setPcapMeta(null);
      setError(String(e));
    }
  }

  // Dissecting a picked frame reuses the same `dissect_hex` command as paste-hex — the frame's
  // captured link-layer bytes are exactly what `dissect()` expects.
  async function onPickFrame(frame: PcapFrame) {
    try {
      const dissected = await invoke<PacketDocument>("dissect_hex", { hex: bytesToHex(frame.data) });
      dispatchDoc({ type: "SET", document: dissected });
      setPcapFrameIndex(frame.index);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const MODES: { id: InputMode; label: string }[] = [
    { id: "compose", label: "Compose" },
    { id: "spec", label: "Spec JSON" },
    { id: "dissect", label: "Dissect bytes" },
    { id: "load", label: "Load JSON" },
    { id: "pcap", label: "Open .pcap" },
  ];

  return (
    <WorkspaceProvider>
      <div className="workbench">
        <aside className="workbench-left">
          <div className="edit-mode-toggle workbench-modes" role="radiogroup" aria-label="Input mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={inputMode === m.id ? "theme-option active" : "theme-option"}
                aria-pressed={inputMode === m.id}
                onClick={() => setInputMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {inputMode === "compose" && (
            <div className="workbench-compose">
              <div className="row workbench-compose-actions">
                <button onClick={() => composer.assemble()} disabled={composer.model.layers.length === 0}>
                  Assemble
                </button>
                <button className="composer-code-toggle" onClick={() => setShowJson((v) => !v)}>
                  {showJson ? "Hide JSON" : "Show JSON"}
                </button>
              </div>
              <StackView
                model={composer.model}
                catalog={composer.catalog}
                selectedKey={composer.selectedKey}
                onSelect={composer.select}
                onMove={composer.move}
                onRemove={composer.remove}
              />
              <ProtocolPalette catalog={composer.catalog} candidates={composer.candidates} onAdd={composer.add} />
              {showJson && (
                <textarea
                  className="json-editor small composer-code"
                  readOnly
                  value={composer.payloadJson}
                  spellCheck={false}
                  aria-label="Composed packet JSON (read-only)"
                />
              )}
            </div>
          )}

          {inputMode === "spec" && (
            <div className="workbench-input">
              <p className="hint">Edit the protocol stack (an array of `ProtocolSpec`) and assemble it.</p>
              <textarea
                className="json-editor small"
                value={stackText}
                onChange={(e) => setStackText(e.currentTarget.value)}
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onAssembleSpec}>Assemble</button>
              </div>
            </div>
          )}

          {inputMode === "dissect" && (
            <div className="workbench-input">
              <p className="hint">
                Paste a raw packet's hex (an Ethernet II frame — spaces and newlines are fine) and dissect it.
              </p>
              <textarea
                className="json-editor small"
                value={hexText}
                onChange={(e) => setHexText(e.currentTarget.value)}
                placeholder="ffffffffffff 020000000001 0800 4500 2c00 …"
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onDissect} disabled={!hexText.trim()}>
                  Dissect
                </button>
              </div>
            </div>
          )}

          {inputMode === "load" && (
            <div className="workbench-input">
              <p className="hint">Paste a packet document's JSON and load it — bytes never change, only diagnostics.</p>
              <textarea
                className="json-editor small"
                value={loadText}
                onChange={(e) => setLoadText(e.currentTarget.value)}
                placeholder="Paste packet document JSON here…"
                spellCheck={false}
              />
              <div className="row">
                <button onClick={onLoad} disabled={!loadText.trim()}>
                  Load
                </button>
              </div>
            </div>
          )}

          {inputMode === "pcap" && (
            <div className="workbench-input">
              <p className="hint">
                Open a <code>.pcap</code> or <code>.pcapng</code> capture and pick a frame to
                dissect. Each frame is read as an Ethernet II packet.
              </p>
              <input
                type="file"
                className="pcap-file"
                accept=".pcap,.pcapng,.cap,application/vnd.tcpdump.pcap,application/octet-stream"
                onChange={(e) => onPickPcap(e.currentTarget.files?.[0])}
              />
              {pcapMeta && pcapFrames && (
                <div className="pcap-result">
                  <div className="pcap-meta">
                    <span className="pcap-file-name">{pcapMeta.fileName}</span>
                    <span className="pcap-frame-count">
                      {pcapFrames.length} frame{pcapFrames.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {pcapMeta.linkType !== LINKTYPE_ETHERNET && (
                    <p className="hint pcap-warn">
                      Link type {pcapMeta.linkType} isn't Ethernet — dissection still assumes an
                      Ethernet II frame, so results may be off.
                    </p>
                  )}
                  {pcapMeta.truncated && <p className="hint pcap-warn">Capture was truncated; showing the frames read.</p>}
                  {pcapMeta.capped && <p className="hint pcap-warn">Large capture — showing the first {pcapFrames.length} frames.</p>}
                  {pcapFrames.length > 1 && (
                    <input
                      className="pcap-filter"
                      type="text"
                      value={pcapFilter}
                      onChange={(e) => setPcapFilter(e.currentTarget.value)}
                      placeholder="Filter (e.g. TCP, DNS, 192.168…)"
                      spellCheck={false}
                    />
                  )}
                  <ul className="pcap-frames">
                    {(() => {
                      const t0 = frameTimestamp(pcapFrames[0], pcapMeta.nanos);
                      return visiblePcapRows.map(({ frame: f, summary }) => {
                      const delta = frameTimestamp(f, pcapMeta.nanos) - t0;
                      return (
                        <li key={f.index}>
                          <button
                            className={pcapFrameIndex === f.index ? "pcap-frame active" : "pcap-frame"}
                            onClick={() => onPickFrame(f)}
                            title={`#${f.index} · +${delta.toFixed(6)}s · ${summary.info || summary.label}`}
                          >
                            <span className="pcap-frame-idx">#{f.index}</span>
                            <span className="pcap-frame-proto">{summary.label}</span>
                            <span className="pcap-frame-info">{summary.info}</span>
                            <span className="pcap-frame-len">{f.origLen} B</span>
                          </button>
                        </li>
                      );
                      });
                    })()}
                    {visiblePcapRows.length === 0 && <li className="hint pcap-empty">No frames match “{pcapFilter}”.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && <p className="error">{error}</p>}
        </aside>

        <WorkbenchStage doc={doc} active={active} edit={edit} composer={composer} mode={inputMode} diff={diff} variants={variantsApi} />
      </div>
    </WorkspaceProvider>
  );
}
