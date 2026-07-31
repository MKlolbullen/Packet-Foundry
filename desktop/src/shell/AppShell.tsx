import type { ReactNode } from "react";
import WorkspaceNavigation, { type WorkspaceView } from "./WorkspaceNavigation";
import CommandBar from "./CommandBar";

// The full-window workbench shell: a persistent left navigation rail spanning the full height, and
// a content column with a compact command bar above the active workspace. Phase 1 of the UI
// redesign — pure layout/chrome; the workspaces it hosts are unchanged and stay mounted.
export default function AppShell({
  view,
  onSelectView,
  onSettings,
  title,
  subtitle,
  actions,
  children,
}: {
  view: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  onSettings: () => void;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <WorkspaceNavigation view={view} onSelect={onSelectView} onSettings={onSettings} />
      <div className="app-main">
        <CommandBar title={title} subtitle={subtitle} actions={actions} />
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
