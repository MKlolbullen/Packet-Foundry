// Mirrors desktop/src-tauri/src/llm/mod.rs's serde shapes.

export type Provider = "openai_compatible" | "anthropic" | "google";

export interface LlmSettings {
  provider: Provider;
  api_key: string;
  model: string;
  /** Only consulted for the "openai_compatible" provider. */
  base_url: string;
}

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai_compatible: "OpenAI-compatible (OpenAI, Groq, OpenRouter, Ollama, ...)",
  anthropic: "Anthropic",
  google: "Google Gemini",
};
