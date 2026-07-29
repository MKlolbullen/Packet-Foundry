//! Adapter for Google's Gemini `generateContent` API. Roles are `"user"`/`"model"` (not
//! `"assistant"`), content is nested under `parts`, and the system prompt is its own top-level
//! `systemInstruction` field, same idea as Anthropic but a different shape.

use serde_json::{Value, json};

use crate::llm::{ChatMessage, LlmError, LlmSettings, Role};

fn api_url(settings: &LlmSettings) -> String {
    format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        settings.model, settings.api_key
    )
}

pub fn build_request_body(messages: &[ChatMessage]) -> Value {
    let system = messages.iter().find(|m| m.role == Role::System).map(|m| m.content.as_str());
    let contents: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != Role::System)
        .map(|m| {
            let role = if m.role == Role::Assistant { "model" } else { "user" };
            json!({ "role": role, "parts": [{ "text": m.content }] })
        })
        .collect();
    let mut body = json!({ "contents": contents });
    if let Some(system) = system {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }
    body
}

pub fn parse_response(body: &str) -> Result<String, LlmError> {
    let value: Value = serde_json::from_str(body).map_err(|e| LlmError::BadResponse(e.to_string()))?;
    if let Some(err) = value.get("error") {
        let message = err.get("message").and_then(Value::as_str).unwrap_or("unknown error");
        return Err(LlmError::ProviderError(message.to_string()));
    }
    value["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| LlmError::BadResponse("missing candidates[0].content.parts[0].text".to_string()))
}

pub async fn send(settings: &LlmSettings, messages: &[ChatMessage]) -> Result<String, LlmError> {
    let client = reqwest::Client::new();
    let response = client
        .post(api_url(settings))
        .json(&build_request_body(messages))
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
    fn maps_assistant_role_to_model_and_splits_system_out() {
        let messages = vec![
            ChatMessage { role: Role::System, content: "be terse".to_string() },
            ChatMessage { role: Role::User, content: "hi".to_string() },
            ChatMessage { role: Role::Assistant, content: "hello".to_string() },
        ];
        let body = build_request_body(&messages);
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "be terse");
        assert_eq!(body["contents"].as_array().unwrap().len(), 2);
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(body["contents"][1]["role"], "model");
    }

    #[test]
    fn parses_a_successful_response() {
        let body = r#"{"candidates":[{"content":{"parts":[{"text":"hello there"}]}}]}"#;
        assert_eq!(parse_response(body).unwrap(), "hello there");
    }

    #[test]
    fn surfaces_a_provider_error() {
        let body = r#"{"error":{"code":400,"message":"API key not valid"}}"#;
        let err = parse_response(body).unwrap_err();
        assert!(matches!(err, LlmError::ProviderError(m) if m == "API key not valid"));
    }
}
