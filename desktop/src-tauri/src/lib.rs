//! Tauri backend for the Packet Foundry desktop shell — a thin IPC boundary over the headless
//! `packet-core` / `protocol-engine` crates. No packet logic lives here; every command just
//! forwards to the engine and reports its `Result` back to the frontend.

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            default_stack,
            create_packet,
            inspect_packet,
            evaluate_operation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
