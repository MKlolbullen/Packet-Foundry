// Persistent left-rail application navigation — the major workspaces only. Replaces the old
// centered tab strip. Settings opens the existing modal rather than being a workspace of its own.

export type WorkspaceView = "workbench" | "operations" | "assistant";

const NAV_ITEMS: { id: WorkspaceView; label: string; icon: string }[] = [
  { id: "workbench", label: "Packet Workbench", icon: "▤" },
  { id: "operations", label: "Operation Editor", icon: "◇" },
  { id: "assistant", label: "Assistant", icon: "✦" },
];

export default function WorkspaceNavigation({
  view,
  onSelect,
  onSettings,
}: {
  view: WorkspaceView;
  onSelect: (view: WorkspaceView) => void;
  onSettings: () => void;
}) {
  return (
    <nav className="app-nav" aria-label="Workspaces">
      <div className="app-nav-brand">
        <span className="app-nav-logo" aria-hidden="true">
          ◆
        </span>
        <div>
          <div className="app-nav-title">Packet Foundry</div>
          <div className="app-nav-tagline">Craft · Inspect · Derive</div>
        </div>
      </div>
      <div className="app-nav-group">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "app-nav-item active" : "app-nav-item"}
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <span className="app-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </div>
      <div className="app-nav-spacer" />
      <button className="app-nav-item" onClick={onSettings}>
        <span className="app-nav-icon" aria-hidden="true">
          ⚙
        </span>
        Settings
      </button>
    </nav>
  );
}
