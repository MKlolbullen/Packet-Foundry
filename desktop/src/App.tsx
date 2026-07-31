import { useEffect, useState } from "react";
import BoxEditor from "./BoxEditor";
import Assistant from "./Assistant";
import SettingsModal from "./SettingsModal";
import Workspace from "./workspace/Workspace";
import AppShell from "./shell/AppShell";
import type { WorkspaceView } from "./shell/WorkspaceNavigation";
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

const VIEW_META: Record<WorkspaceView, { title: string; subtitle: string }> = {
  workbench: { title: "Packet Workbench", subtitle: "Compose · inspect · edit · derive" },
  operations: { title: "Operation Editor", subtitle: "Build and evaluate derivation trees" },
  assistant: { title: "Assistant", subtitle: "Ask about packets and protocols" },
};

function App() {
  const [view, setView] = useState<WorkspaceView>("workbench");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const meta = VIEW_META[view];

  return (
    <AppShell
      view={view}
      onSelectView={setView}
      onSettings={() => setSettingsOpen(true)}
      title={meta.title}
      subtitle={meta.subtitle}
      actions={<ThemeToggle />}
    >
      {/* All workspaces stay mounted so switching never loses a draft (the assembled stack, an
          in-progress box tree, pan/zoom position, a chat transcript, ...). */}
      <div style={{ display: view === "workbench" ? "block" : "none" }}>
        <Workspace active={view === "workbench"} />
      </div>
      <div style={{ display: view === "operations" ? "block" : "none" }}>
        <BoxEditor active={view === "operations"} />
      </div>
      <div style={{ display: view === "assistant" ? "block" : "none" }}>
        <Assistant />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </AppShell>
  );
}

export default App;
