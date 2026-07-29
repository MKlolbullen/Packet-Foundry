//! Adapter for OpenAI's `/chat/completions` shape — also spoken by Groq, OpenRouter, a local
//! Ollama, and most other hosted-inference providers, so `base_url` is the only thing that
//! changes between them.

use serde::Serialize;
use serde_json::Value;

use crate::llm::{ChatMessage, LlmError, LlmSettings, Role};

#[derive(Serialize)]
struct RequestBody<'a> {
    model: &'a str,
    messages: Vec<WireMessage<'a>>,
}

#[derive(Serialize)]
struct WireMessage<'a> {
    role: &'static str,
    content: &'a str,
}

fn role_str(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

pub fn build_request_body(settings: &LlmSettings, messages: &[ChatMessage]) -> Value {
    let body = RequestBody {
        model: &settings.model,
        messages: messages.iter().map(|m| WireMessage { role: role_str(m.role), content: &m.content }).collect(),
    };
    serde_json::to_value(body).expect("RequestBody only contains strings and a Vec, always serializable")
}

pub fn parse_response(body: &str) -> Result<String, LlmError> {
    let value: Value = serde_json::from_str(body).map_err(|e| LlmError::BadResponse(e.to_string()))?;
    if let Some(err) = value.get("error") {
        let message = err.get("message").and_then(Value::as_str).unwrap_or("unknown error");
        return Err(LlmError::ProviderError(message.to_string()));
    }
    value["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| LlmError::BadResponse("missing choices[0].message.content".to_string()))
}

pub async fn send(settings: &LlmSettings, messages: &[ChatMessage]) -> Result<String, LlmError> {
    let url = format!("{}/chat/completions", settings.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let mut request = client.post(url).json(&build_request_body(settings, messages));
    if !settings.api_key.trim().is_empty() {
        request = request.bearer_auth(&settings.api_key);
    }
    let response = request.send().await.map_err(|e| LlmError::Request(e.to_string()))?;
    let text = response.text().await.map_err(|e| LlmError::Request(e.to_string()))?;
    parse_response(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_expected_request_shape() {
        let settings = LlmSettings { model: "gpt-4o-mini".to_string(), ..LlmSettings::default() };
        let messages = vec![
            ChatMessage { role: Role::System, content: "be terse".to_string() },
            ChatMessage { role: Role::User, content: "hi".to_string() },
        ];
        let body = build_request_body(&settings, &messages);
        assert_eq!(body["model"], "gpt-4o-mini");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "hi");
    }

    #[test]
    fn parses_a_successful_response() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"hello there"}}]}"#;
        assert_eq!(parse_response(body).unwrap(), "hello there");
    }

    #[test]
    fn surfaces_a_provider_error() {
        let body = r#"{"error":{"message":"invalid api key","type":"invalid_request_error"}}"#;
        let err = parse_response(body).unwrap_err();
        assert!(matches!(err, LlmError::ProviderError(m) if m == "invalid api key"));
    }

    #[test]
    fn rejects_a_response_missing_content() {
        let body = r#"{"choices":[{}]}"#;
        assert!(parse_response(body).is_err());
    }
}
