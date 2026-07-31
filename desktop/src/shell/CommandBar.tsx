import type { ReactNode } from "react";

// Compact top bar inside the content column: the current workspace title on the left, contextual
// actions (theme, later: history/search/mode) on the right. Deliberately thin — this is chrome,
// not a dashboard.
export default function CommandBar({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="command-bar">
      <div className="command-bar-titles">
        <span className="command-bar-title">{title}</span>
        {subtitle && <span className="command-bar-subtitle">{subtitle}</span>}
      </div>
      <div className="command-bar-actions">{actions}</div>
    </header>
  );
}
