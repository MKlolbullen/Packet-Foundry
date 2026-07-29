//! Tauri backend for the Packet Foundry desktop shell — a thin IPC boundary over the headless
//! `packet-core` / `protocol-engine` crates. No packet logic lives here; every command just
//! forwards to the engine and reports its `Result` back to the frontend.

mod llm;

use packet_core::{Operation, PacketBuffer, PacketDocument};
use protocol_engine::{ProtocolSpec, assemble, evaluate, validate};

/// A protocol stack that assembles a valid Ethernet/IPv4/TCP SYN — the same packet the CLI's
/// README quick start builds. Used to seed the UI with something real to look at.
#[tauri::command]
fn default_stack() -> Vec<ProtocolSpec> {
    use protocol_engine::protocols::{ethernet, ipv4, tcp};

    vec![
        ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
        ProtocolSpec::Ipv4(ipv4::Ipv4Params {
            src: [192, 168, 1, 10],
            dst: [192, 168, 1, 20],
            ..Default::default()
        }),
        ProtocolSpec::Tcp(tcp::TcpParams {
            dst_port: 443,
            flags: tcp::flags::SYN,
            ..Default::default()
        }),
    ]
}

/// Assemble an ordered protocol stack into a resolved document (layout + derivation resolve).
#[tauri::command]
fn create_packet(protocols: Vec<ProtocolSpec>) -> Result<PacketDocument, String> {
    assemble(&protocols).map_err(|e| e.to_string())
}

/// Load a packet from its JSON form and return it with freshly-computed diagnostics — the
/// bytes are never rewritten, mirroring `packet-foundry inspect`.
#[tauri::command]
fn inspect_packet(document_json: String) -> Result<PacketDocument, String> {
    let mut doc = PacketDocument::from_json(&document_json).map_err(|e| e.to_string())?;
    doc.diagnostics = validate(&doc);
    Ok(doc)
}

/// Evaluate a single `Operation` against a scratch buffer (hex-encoded) and return its byte
/// result, also hex-encoded — the box editor's "run this box" action. The same evaluator the
/// resolve pass uses; reserved variants (Add/Sub/Loop/If/Call) report `EngineError::Unsupported`
/// exactly as they do during real assembly.
#[tauri::command]
fn evaluate_operation(op: Operation, buffer_hex: String) -> Result<String, String> {
    let bytes = hex::decode(buffer_hex.trim()).map_err(|e| e.to_string())?;
    let buffer = PacketBuffer::from_bytes(bytes);
    evaluate(&op, &buffer).map(|out| hex::encode(out)).map_err(|e| e.to_string())
}

/// Load the persisted LLM provider settings (API key included) for the settings panel to
/// pre-fill.
#[tauri::command]
async fn get_llm_settings(app: tauri::AppHandle) -> Result<llm::LlmSettings, String> {
    llm::settings::load(&app).map_err(|e| e.to_string())
}

/// Persist LLM provider settings (provider, API key, model, base URL).
#[tauri::command]
async fn save_llm_settings(app: tauri::AppHandle, settings: llm::LlmSettings) -> Result<(), String> {
    llm::settings::save(&app, &settings).map_err(|e| e.to_string())
}

/// Send a chat conversation to whichever provider is configured — the Assistant tab's send
/// action.
#[tauri::command]
async fn llm_chat(app: tauri::AppHandle, messages: Vec<llm::ChatMessage>) -> Result<String, String> {
    let settings = llm::settings::load(&app).map_err(|e| e.to_string())?;
    llm::chat(&settings, &messages).await.map_err(|e| e.to_string())
}

/// Ask the configured provider to turn a plain-language description into an `Operation` tree —
/// the box editor's "Generate" action. The reply is deserialized straight into `Operation`, so a
/// model that doesn't produce a value the engine actually understands surfaces as an error here
/// rather than a box tree that silently doesn't work.
#[tauri::command]
async fn llm_generate_operation(app: tauri::AppHandle, description: String) -> Result<Operation, String> {
    let settings = llm::settings::load(&app).map_err(|e| e.to_string())?;
    llm::generate_operation(&settings, &description).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            default_stack,
            create_packet,
            inspect_packet,
            evaluate_operation,
            get_llm_settings,
            save_llm_settings,
            llm_chat,
            llm_generate_operation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
