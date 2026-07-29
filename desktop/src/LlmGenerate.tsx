import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Operation } from "./operation";

// The box editor's "describe it, get a box tree" action — asks the configured provider (see
// SettingsModal) to turn a plain-language description into an `Operation`, deserialized straight
// into the engine's real type so an incompatible reply surfaces as an error here.
export default function LlmGenerate({ onGenerated }: { onGenerated: (op: Operation) => void }) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onGenerate() {
    const text = description.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const op = await invoke<Operation>("llm_generate_operation", { description: text });
      onGenerated(op);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="llm-generate">
      <textarea
        className="json-editor small"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        placeholder="Describe a box tree, e.g. “sum four big-endian u16 fields as a ones' complement checksum”…"
        spellCheck={false}
      />
      <div className="row">
        <button onClick={onGenerate} disabled={loading || !description.trim()}>
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
