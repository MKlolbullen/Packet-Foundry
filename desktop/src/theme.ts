export type ThemeSetting = "system" | "light" | "dark";

const STORAGE_KEY = "packet-foundry-theme";

export function loadThemeSetting(): ThemeSetting {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function saveThemeSetting(setting: ThemeSetting): void {
  localStorage.setItem(STORAGE_KEY, setting);
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve `setting` against the OS preference (for "system") and stamp it onto `<html>` as
 * `data-theme` — the sole thing App.css keys off, so there is exactly one source of truth for
 * which palette is active. */
export function applyTheme(setting: ThemeSetting): void {
  const effective = setting === "system" ? (systemPrefersDark() ? "dark" : "light") : setting;
  document.documentElement.setAttribute("data-theme", effective);
}
