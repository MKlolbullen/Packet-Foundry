//! Adapter for Anthropic's Messages API. Unlike the OpenAI shape, the system prompt is a
//! top-level field rather than a message with `role: "system"`, so it's split out here.

use serde::Serialize;
use serde_json::Value;

use crate::llm::{ChatMessage, LlmError, LlmSettings, Role};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 4096;

#[derive(Serialize)]
struct RequestBody<'a> {
    model: &'a str,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    messages: Vec<WireMessage<'a>>,
}

#[derive(Serialize)]
struct WireMessage<'a> {
    role: &'static str,
    content: &'a str,
}

pub fn build_request_body(settings: &LlmSettings, messages: &[ChatMessage]) -> Value {
    let system = messages.iter().find(|m| m.role == Role::System).map(|m| m.content.as_str());
    let wire = messages
        .iter()
        .filter(|m| m.role != Role::System)
        .map(|m| WireMessage {
            role: if m.role == Role::Assistant { "assistant" } else { "user" },
            content: &m.content,
        })
        .collect();
    let body = RequestBody { model: &settings.model, max_tokens: MAX_TOKENS, system, messages: wire };
    serde_json::to_value(body).expect("RequestBody only contains strings and a Vec, always serializable")
}

pub fn parse_response(body: &str) -> Result<String, LlmError> {
    let value: Value = serde_json::from_str(body).map_err(|e| LlmError::BadResponse(e.to_string()))?;
    if let Some(err) = value.get("error") {
        let message = err.get("message").and_then(Value::as_str).unwrap_or("unknown error");
        return Err(LlmError::ProviderError(message.to_string()));
    }
    value["content"][0]["text"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| LlmError::BadResponse("missing content[0].text".to_string()))
}

pub async fn send(settings: &LlmSettings, messages: &[ChatMessage]) -> Result<String, LlmError> {
    let client = reqwest::Client::new();
    let response = client
        .post(API_URL)
        .header("x-api-key", &settings.api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&build_request_body(settings, messages))
        .send()
        .await
        .map_err(|e| LlmError::Request(e.to_string()))?;
    let text = response.text().await.map_err(|e| LlmError::Request(e.to_string()))?;
    parse_response(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_system_message_out_of_the_messages_array() {
        let settings = LlmSettings { model: "claude-sonnet".to_string(), ..LlmSettings::default() };
        let messages = vec![
            ChatMessage { role: Role::System, content: "be terse".to_string() },
            ChatMessage { role: Role::User, content: "hi".to_string() },
        ];
        let body = build_request_body(&settings, &messages);
        assert_eq!(body["system"], "be terse");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert_eq!(body["messages"][0]["role"], "user");
    }

    #[test]
    fn parses_a_successful_response() {
        let body = r#"{"content":[{"type":"text","text":"hello there"}]}"#;
        assert_eq!(parse_response(body).unwrap(), "hello there");
    }

    #[test]
    fn surfaces_a_provider_error() {
        let body = r#"{"error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        let err = parse_response(body).unwrap_err();
        assert!(matches!(err, LlmError::ProviderError(m) if m == "invalid x-api-key"));
    }
}
