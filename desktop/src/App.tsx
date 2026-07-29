import { useEffect, useState } from "react";
import BoxEditor from "./BoxEditor";
import Assistant from "./Assistant";
import SettingsModal from "./SettingsModal";
import Workspace from "./workspace/Workspace";
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

type Tab = "assemble" | "boxes" | "assistant";

function App() {
  const [tab, setTab] = useState<Tab>("assemble");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="container">
      <header>
        <div className="header-bar">
          <div className="header-spacer">
            <button
              className="settings-button"
              onClick={() => setSettingsOpen(true)}
              title="LLM settings"
              aria-label="LLM settings"
            >
              ⚙
            </button>
          </div>
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
        <button className={tab === "assistant" ? "tab active" : "tab"} onClick={() => setTab("assistant")}>
          Assistant
        </button>
      </nav>

      {/* All tabs stay mounted so switching back and forth never loses a draft (the assembled
          stack, an in-progress box tree, pan/zoom position, a chat transcript, ...). */}
      <div style={{ display: tab === "assemble" ? "block" : "none" }}>
        <Workspace active={tab === "assemble"} />
      </div>
      <div style={{ display: tab === "boxes" ? "block" : "none" }}>
        <BoxEditor active={tab === "boxes"} />
      </div>
      <div style={{ display: tab === "assistant" ? "block" : "none" }}>
        <Assistant />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

export default App;
