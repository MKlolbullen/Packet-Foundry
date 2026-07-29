import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PROVIDER_LABELS, type LlmSettings, type Provider } from "./llm";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<LlmSettings>("get_llm_settings")
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);

  async function onSave() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("save_llm_settings", { settings });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>LLM Settings</h2>
        <p className="hint">
          Used by the Assistant tab and the box editor's "Generate" action. Stored unencrypted in
          this app's local config directory — nowhere else.
        </p>

        {!settings ? (
          <p className="hint">Loading…</p>
        ) : (
          <>
            <label className="param-label">Provider</label>
            <select
              className="box-input"
              value={settings.provider}
              onChange={(e) => setSettings({ ...settings, provider: e.currentTarget.value as Provider })}
            >
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>

            {settings.provider === "openai_compatible" && (
              <>
                <label className="param-label">Base URL</label>
                <input
                  className="box-input"
                  value={settings.base_url}
                  onChange={(e) => setSettings({ ...settings, base_url: e.currentTarget.value })}
                  spellCheck={false}
                />
              </>
            )}

            <label className="param-label">Model</label>
            <input
              className="box-input"
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.currentTarget.value })}
              spellCheck={false}
            />

            <label className="param-label">API key</label>
            <input
              className="box-input"
              type="password"
              value={settings.api_key}
              onChange={(e) => setSettings({ ...settings, api_key: e.currentTarget.value })}
              placeholder={settings.provider === "openai_compatible" ? "not required for a local Ollama" : ""}
              spellCheck={false}
              autoComplete="off"
            />
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="row">
          <button onClick={onSave} disabled={!settings || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
