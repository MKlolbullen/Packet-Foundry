//! Human-readable rendering of field values — the single Rust source of truth for turning a
//! field's bytes into a display string, shared by the CLI's tree/diff output and the semantic
//! diff. (The desktop mirrors this in `packet.ts::formatFieldValue` for its live inspector; the
//! diff carries these Rust-formatted strings so both render identical values.)

use packet_core::{Field, FieldKind, PacketBuffer};

/// Format a field's current bytes for display, per its [`FieldKind`]. Out-of-bounds reads render
/// as `<out-of-bounds>` rather than panicking.
pub fn format_field_value(buffer: &PacketBuffer, field: &Field) -> String {
    match field.kind {
        FieldKind::MacAddr => match buffer.read_bytes(field.range) {
            Ok(b) => b.iter().map(|x| format!("{x:02x}")).collect::<Vec<_>>().join(":"),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Ipv4Addr => match buffer.read_bytes(field.range) {
            Ok(b) => b.iter().map(|x| x.to_string()).collect::<Vec<_>>().join("."),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Ipv6Addr => match buffer.read_bytes(field.range) {
            // Full 8-group form (no `::` compression), lowercase.
            Ok(b) => b
                .chunks(2)
                .map(|c| format!("{:02x}{:02x}", c[0], c.get(1).copied().unwrap_or(0)))
                .collect::<Vec<_>>()
                .join(":"),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Uint => match buffer.read_uint(field.range) {
            Ok(v) => v.to_string(),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Flags => match buffer.read_uint(field.range) {
            Ok(v) => format!("0x{v:02x}"),
            Err(_) => "<out-of-bounds>".into(),
        },
        FieldKind::Bytes => match buffer.read_bytes(field.range) {
            Ok(b) => {
                let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
                if hex.len() > 32 { format!("{}…", &hex[..32]) } else { hex }
            }
            Err(_) => "<out-of-bounds>".into(),
        },
    }
}
