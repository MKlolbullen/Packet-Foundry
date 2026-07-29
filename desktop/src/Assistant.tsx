import { useState } from "react";
import type { KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "./llm";

export default function Assistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSend() {
    const content = input.trim();
    if (!content || sending) return;
    const next = [...messages, { role: "user", content } as ChatMessage];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const reply = await invoke<string>("llm_chat", { messages: next });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <section className="pane assistant-pane">
      <h2>Assistant</h2>
      <p className="hint">
        Chats with whichever provider is configured in Settings (gear icon, top right). Nothing
        here reads your packet documents automatically — paste in whatever context you want.
      </p>

      <div className="assistant-messages">
        {messages.length === 0 && (
          <p className="hint">
            Ask about a protocol, a checksum algorithm, or how to structure an <code>Operation</code>{" "}
            tree — or use the Box Editor's own "Generate" box for that last one directly.
          </p>
        )}
        {messages.map((m, i) => (
          <div className={`assistant-message role-${m.role}`} key={i}>
            <span className="assistant-role">{m.role}</span>
            <div className="assistant-content">{m.content}</div>
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <textarea
        className="json-editor small"
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask something… (Enter to send, Shift+Enter for a new line)"
      />
      <div className="row">
        <button onClick={onSend} disabled={sending || !input.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
        <button onClick={() => setMessages([])} disabled={messages.length === 0}>
          Clear
        </button>
      </div>
    </section>
  );
}
