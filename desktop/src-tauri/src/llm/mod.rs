//! A provider-agnostic LLM chat client — the box editor's "generate a tree from a description"
//! and the Assistant tab both go through here. One adapter (`providers::openai_compatible`)
//! covers every provider that speaks OpenAI's chat-completions shape (OpenAI itself, Groq,
//! OpenRouter, a local Ollama, ...) via a configurable `base_url`; Anthropic and Google Gemini
//! get their own adapters since their request/response shapes differ. No packet logic lives
//! here — `generate_operation` hands its result straight to `packet_core::Operation`'s own
//! `Deserialize`, so the LLM boundary and the engine boundary share one schema, not two.

pub mod providers;
pub mod settings;

use packet_core::Operation;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Which API shape to speak. `OpenAiCompatible` is deliberately the catch-all: point `base_url`
/// at any OpenAI-chat-completions-compatible endpoint (OpenAI, Groq, OpenRouter, a local Ollama,
/// ...) instead of adding a dedicated adapter per vendor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    OpenAiCompatible,
    Anthropic,
    Google,
}

fn default_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}

fn default_model() -> String {
    "gpt-4o-mini".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmSettings {
    pub provider: Provider,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    /// Only consulted for `Provider::OpenAiCompatible`.
    #[serde(default = "default_base_url")]
    pub base_url: String,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            provider: Provider::OpenAiCompatible,
            api_key: String::new(),
            model: default_model(),
            base_url: default_base_url(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

/// Errors from talking to an LLM provider. Never includes the API key.
#[derive(Debug, Error)]
pub enum LlmError {
    #[error("no API key configured for this provider")]
    MissingApiKey,
    #[error("request failed: {0}")]
    Request(String),
    #[error("provider returned an error: {0}")]
    ProviderError(String),
    #[error("couldn't parse the provider's response: {0}")]
    BadResponse(String),
    #[error("settings storage error: {0}")]
    Io(String),
}

/// Send a chat request through whichever adapter `settings.provider` selects.
pub async fn chat(settings: &LlmSettings, messages: &[ChatMessage]) -> Result<String, LlmError> {
    if settings.provider != Provider::OpenAiCompatible && settings.api_key.trim().is_empty() {
        return Err(LlmError::MissingApiKey);
    }
    match settings.provider {
        Provider::OpenAiCompatible => providers::openai_compatible::send(settings, messages).await,
        Provider::Anthropic => providers::anthropic::send(settings, messages).await,
        Provider::Google => providers::google::send(settings, messages).await,
    }
}

const OPERATION_SYSTEM_PROMPT: &str = r#"You translate a plain-language description of a wire-format computation into a single JSON value matching Packet Foundry's `Operation` IR. Reply with ONLY that JSON value — no prose, no markdown fences, no explanation.

`Operation` is a recursive, externally-tagged enum. Each variant is a JSON object with exactly one key (the variant name):

- {"Const": [<u8>, ...]}                             — a fixed byte string
- {"ReadRange": {"start_bit": <uint>, "len_bits": <uint>}}   — read bits from the buffer, MSB-first
- {"ReadFrom": {"from_byte": <uint>}}                 — read from a byte offset to the end of the buffer
- {"Concat": [<Operation>, ...]}                      — concatenate results
- {"And": [<Operation>, <Operation>]}                 — bitwise AND (shorter side zero-padded)
- {"Or": [<Operation>, <Operation>]}                  — bitwise OR
- {"Xor": [<Operation>, <Operation>]}                 — bitwise XOR
- {"Not": <Operation>}                                — bitwise NOT
- {"Shl": [<Operation>, <uint bits>]}                 — left shift, same length as input
- {"Shr": [<Operation>, <uint bits>]}                 — right shift
- {"OnesComplementSum": [<Operation>, ...]}           — RFC 1071 internet checksum over the concatenated operands, 2 big-endian bytes
- {"ByteLength": {"from_byte": <uint>, "width": <uint>}}     — bytes from from_byte to end of buffer, as `width` big-endian bytes
- {"Composite": {"name": <string>, "body": <Operation>}}     — a named wrapper, transparent to evaluation

These variants exist but are NOT YET EVALUABLE (the engine rejects them at runtime) — avoid them unless the description explicitly asks for control flow: {"Add":[...]}, {"Sub":[...]}, {"Shl"/"Shr" are fine, those ARE evaluable}, {"Loop": {"count": <Operation>, "body": <Operation>}}, {"If": {"cond": <Operation>, "then_branch": <Operation>, "else_branch": <Operation>}}, {"Call": {"name": <string>}}.

Example — "the internet checksum over the first 20 bytes":
{"Composite":{"name":"internet_checksum","body":{"OnesComplementSum":[{"ReadRange":{"start_bit":0,"len_bits":160}}]}}}

Reply with one JSON value implementing the user's description."#;

/// Ask the model for an `Operation` tree matching `description`, extracting the JSON if the
/// reply wraps it in markdown fences or a little prose, and validating it by deserializing
/// straight into the engine's own `Operation` type — no separate LLM-side schema to drift.
pub async fn generate_operation(settings: &LlmSettings, description: &str) -> Result<Operation, LlmError> {
    let messages = vec![
        ChatMessage { role: Role::System, content: OPERATION_SYSTEM_PROMPT.to_string() },
        ChatMessage { role: Role::User, content: description.to_string() },
    ];
    let reply = chat(settings, &messages).await?;
    let json = extract_json(&reply);
    serde_json::from_str(&json)
        .map_err(|e| LlmError::BadResponse(format!("model reply wasn't a valid Operation: {e}")))
}

/// Best-effort extraction of a JSON value from a chat reply: try it verbatim, then a fenced
/// ```json``` block, then the outermost `{...}` span.
fn extract_json(text: &str) -> String {
    let trimmed = text.trim();
    if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
        return trimmed.to_string();
    }
    if let Some(start) = trimmed.find("```") {
        let after_fence = &trimmed[start + 3..];
        let after_lang = after_fence.strip_prefix("json").unwrap_or(after_fence);
        let after_lang = after_lang.strip_prefix('\n').unwrap_or(after_lang);
        if let Some(end) = after_lang.find("```") {
            return after_lang[..end].trim().to_string();
        }
    }
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            return trimmed[start..=end].to_string();
        }
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_passes_through_plain_json() {
        assert_eq!(extract_json(r#"{"Const":[1,2]}"#), r#"{"Const":[1,2]}"#);
    }

    #[test]
    fn extract_json_strips_a_json_fence() {
        let reply = "Here you go:\n```json\n{\"Const\":[1,2]}\n```\nLet me know if you need changes.";
        assert_eq!(extract_json(reply), r#"{"Const":[1,2]}"#);
    }

    #[test]
    fn extract_json_strips_a_bare_fence() {
        let reply = "```\n{\"Const\":[1,2]}\n```";
        assert_eq!(extract_json(reply), r#"{"Const":[1,2]}"#);
    }

    #[test]
    fn extract_json_falls_back_to_outermost_braces() {
        let reply = "Sure, that would be {\"Const\":[1,2]} for that buffer.";
        assert_eq!(extract_json(reply), r#"{"Const":[1,2]}"#);
    }

    #[tokio::test]
    async fn chat_rejects_missing_key_for_key_required_providers() {
        let settings = LlmSettings { provider: Provider::Anthropic, ..LlmSettings::default() };
        let err = chat(&settings, &[]).await.unwrap_err();
        assert!(matches!(err, LlmError::MissingApiKey));
    }
}
