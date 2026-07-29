//! Tauri backend for the Packet Foundry desktop shell — a thin IPC boundary over the headless
//! `packet-core` / `protocol-engine` crates. No packet logic lives here; every command just
//! forwards to the engine and reports its `Result` back to the frontend.

mod llm;

use packet_core::{NodeId, Operation, PacketBuffer, PacketDocument};
use protocol_engine::{ProtocolSpec, assemble, evaluate, resolve, validate};

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
    doc.assign_missing_node_ids();
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

/// Pin a byte-aligned field to an explicit value and re-resolve — the workspace's "edit bytes"
/// action. Rejects anything `resolve()`'s own override-application step would otherwise silently
/// skip (unaligned start, length mismatch, out-of-bounds) so a bad edit surfaces as an error
/// instead of silently not applying.
#[tauri::command]
fn set_field_bytes(
    mut document: PacketDocument,
    layer_id: u64,
    field_id: u64,
    bytes_hex: String,
) -> Result<PacketDocument, String> {
    let bytes = hex::decode(bytes_hex.trim()).map_err(|e| e.to_string())?;
    let buffer_len = document.buffer.len();
    let field = document
        .field_by_id_mut(NodeId(layer_id), NodeId(field_id))
        .ok_or("field not found")?;
    let range = field.range;
    if range.start_bit % 8 != 0 || range.len_bits % 8 != 0 {
        return Err("field is not byte-aligned; bit-level editing isn't supported yet".into());
    }
    if bytes.len() * 8 != range.len_bits {
        return Err(format!("expected {} bytes, got {}", range.len_bits / 8, bytes.len()));
    }
    if (range.start_bit + range.len_bits) / 8 > buffer_len {
        return Err("field range is out of bounds for this document's buffer".into());
    }
    field.override_bytes = Some(bytes);
    resolve(&mut document).map_err(|e| e.to_string())?;
    Ok(document)
}

/// Un-pin a field, letting its derivation (if any) resume computing its bytes on the next
/// resolve. A no-op re-resolve if the field wasn't pinned.
#[tauri::command]
fn clear_field_override(
    mut document: PacketDocument,
    layer_id: u64,
    field_id: u64,
) -> Result<PacketDocument, String> {
    document
        .field_by_id_mut(NodeId(layer_id), NodeId(field_id))
        .ok_or("field not found")?
        .override_bytes = None;
    resolve(&mut document).map_err(|e| e.to_string())?;
    Ok(document)
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
            set_field_bytes,
            clear_field_override,
            get_llm_settings,
            save_llm_settings,
            llm_chat,
            llm_generate_operation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
