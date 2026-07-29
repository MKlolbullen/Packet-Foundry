import type { BitRange, Diagnostic } from "../types";
import { overlaps } from "./range-index";

// Ported from App.tsx's old `Diagnostics` component, extended to cross-highlight a diagnostic
// when its `location` overlaps the current selection — rendered once here rather than per
// projection, since diagnostics apply to the whole document regardless of camera position.
export default function DiagnosticsPanel({
  diagnostics,
  selectedRange,
}: {
  diagnostics: Diagnostic[];
  selectedRange?: BitRange;
}) {
  if (diagnostics.length === 0) {
    return <p className="diagnostics-none">Diagnostics: none</p>;
  }
  return (
    <div className="diagnostics">
      <p>Diagnostics ({diagnostics.length}):</p>
      <ul>
        {diagnostics.map((d, i) => {
          const highlighted = Boolean(selectedRange && d.location && overlaps(d.location, selectedRange));
          return (
            <li key={i} className={`sev-${d.severity}${highlighted ? " diagnostic-highlighted" : ""}`}>
              <span className="sev-badge">{d.severity}</span> {d.code}: {d.message}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
