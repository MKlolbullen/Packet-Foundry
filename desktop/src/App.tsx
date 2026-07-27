import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Diagnostic, PacketDocument, ProtocolSpec } from "./types";
import { formatFieldValue, hexToBytes, locationString } from "./packet";
import BoxEditor from "./BoxEditor";
import { type ThemeSetting, applyTheme, loadThemeSetting, saveThemeSetting } from "./theme";
import "./App.css";

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeSetting>(() => loadThemeSetting());

  useEffect(() => {
    applyTheme(theme);
    saveThemeSetting(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={theme === opt.value ? "theme-option active" : "theme-option"}
          aria-pressed={theme === opt.value}
          onClick={() => setTheme(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function PacketTree({ doc }: { doc: PacketDocument }) {
  const bytes = hexToBytes(doc.buffer);
  return (
    <div className="tree">
      <p className="tree-summary">
        {bytes.length} bytes · {doc.layers.length} layer{doc.layers.length === 1 ? "" : "s"}
      </p>
      {doc.layers.map((layer, i) => (
        <div className="layer" key={`${layer.name}-${i}`}>
          <div className="layer-name">
            {layer.name} <span className="loc">{locationString(layer.range)}</span>
          </div>
          <table className="fields">
            <tbody>
              {layer.fields.map((field) => (
                <tr key={field.name}>
                  <td className="field-name">{field.name}</td>
                  <td className="loc">{locationString(field.range)}</td>
                  <td className="field-value">{formatFieldValue(bytes, field)}</td>
                  <td className="field-marker">
                    {field.override_bytes ? "pinned" : field.derivation ? "derived" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <Diagnostics diagnostics={doc.diagnostics} />
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) {
    return <p className="diagnostics-none">Diagnostics: none</p>;
  }
  return (
    <div className="diagnostics">
      <p>Diagnostics ({diagnostics.length}):</p>
      <ul>
        {diagnostics.map((d, i) => (
          <li key={i} className={`sev-${d.severity}`}>
            <span className="sev-badge">{d.severity}</span> {d.code}: {d.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BuildAndInspect() {
  const [stackText, setStackText] = useState("");
  const [doc, setDoc] = useState<PacketDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inspectText, setInspectText] = useState("");
  const [inspectDoc, setInspectDoc] = useState<PacketDocument | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  async function assemble(protocols: ProtocolSpec[]) {
    try {
      const built = await invoke<PacketDocument>("create_packet", { protocols });
      setDoc(built);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    (async () => {
      const stack = await invoke<ProtocolSpec[]>("default_stack");
      setStackText(JSON.stringify(stack, null, 2));
      await assemble(stack);
    })();
  }, []);

  async function onAssembleClick() {
    try {
      const protocols: ProtocolSpec[] = JSON.parse(stackText);
      await assemble(protocols);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onInspectClick() {
    try {
      const loaded = await invoke<PacketDocument>("inspect_packet", { documentJson: inspectText });
      setInspectDoc(loaded);
      setInspectError(null);
    } catch (e) {
      setInspectError(String(e));
    }
  }

  function sendToInspector() {
    if (!doc) return;
    setInspectText(JSON.stringify(doc, null, 2));
  }

  return (
    <div className="panes">
      <section className="pane">
        <h2>Build</h2>
        <p className="hint">Edit the protocol stack (an array of `ProtocolSpec`) and assemble it.</p>
        <textarea
          className="json-editor"
          value={stackText}
          onChange={(e) => setStackText(e.currentTarget.value)}
          spellCheck={false}
        />
        <div className="row">
          <button onClick={onAssembleClick}>Assemble</button>
          <button onClick={sendToInspector} disabled={!doc}>
            Send to Inspect →
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {doc && <PacketTree doc={doc} />}
      </section>

      <section className="pane">
        <h2>Inspect</h2>
        <p className="hint">Paste a packet document's JSON and load it — bytes never change, only diagnostics.</p>
        <textarea
          className="json-editor"
          value={inspectText}
          onChange={(e) => setInspectText(e.currentTarget.value)}
          placeholder="Paste packet document JSON here…"
          spellCheck={false}
        />
        <div className="row">
          <button onClick={onInspectClick} disabled={!inspectText}>
            Inspect
          </button>
        </div>
        {inspectError && <p className="error">{inspectError}</p>}
        {inspectDoc && <PacketTree doc={inspectDoc} />}
      </section>
    </div>
  );
}

type Tab = "assemble" | "boxes";

function App() {
  const [tab, setTab] = useState<Tab>("assemble");

  return (
    <main className="container">
      <header>
        <div className="header-bar">
          <div className="header-spacer" />
          <div className="header-titles">
            <h1>Packet Foundry</h1>
            <p className="tagline">A bidirectional, non-lossy assembler for wire formats.</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "assemble" ? "tab active" : "tab"} onClick={() => setTab("assemble")}>
          Build &amp; Inspect
        </button>
        <button className={tab === "boxes" ? "tab active" : "tab"} onClick={() => setTab("boxes")}>
          Box Editor
        </button>
      </nav>

      {/* Both tabs stay mounted so switching back and forth never loses a draft (the assembled
          stack, an in-progress box tree, pan/zoom position, ...). */}
      <div style={{ display: tab === "assemble" ? "block" : "none" }}>
        <BuildAndInspect />
      </div>
      <div style={{ display: tab === "boxes" ? "block" : "none" }}>
        <BoxEditor />
      </div>
    </main>
  );
}

export default App;
