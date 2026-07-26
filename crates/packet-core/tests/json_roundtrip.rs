//! JSON round-trip invariants for `PacketDocument`.
//!
//! The central guarantee: a document — including a *deliberately broken* one — survives
//! serialize → deserialize byte-for-byte. Bytes are authoritative, so nothing is "corrected" or
//! dropped on the way through JSON.

use packet_core::{
    BitRange, Diagnostic, Field, FieldKind, Layer, Operation, PacketBuffer, PacketDocument,
    SCHEMA_VERSION, Severity,
};
use proptest::prelude::*;

/// A representative document: a couple of layers, a derived field, a pinned override, and a
/// diagnostic — enough to exercise every serialized branch.
fn sample_document() -> PacketDocument {
    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(vec![
        0x45, 0x00, 0x00, 0x14, 0x00, 0x00, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 0xC0, 0xA8, 0x01,
        0x0A, 0xC0, 0xA8, 0x01, 0x14,
    ]));
    doc.layers.push(Layer::new(
        "IPv4",
        BitRange::bytes(0, 20),
        vec![
            Field::new("Version", BitRange::new(0, 4), FieldKind::Uint),
            Field::new("IHL", BitRange::new(4, 4), FieldKind::Uint),
            Field::derived(
                "TotalLength",
                BitRange::bytes(2, 2),
                FieldKind::Uint,
                Operation::ByteLength { from_byte: 0, width: 2 },
            ),
            Field::derived(
                "HeaderChecksum",
                BitRange::bytes(10, 2),
                FieldKind::Uint,
                Operation::internet_checksum(vec![Operation::ReadRange(BitRange::bytes(0, 20))]),
            ),
            Field::new("SrcAddr", BitRange::bytes(12, 4), FieldKind::Ipv4Addr),
        ],
    ));
    // Pin the checksum to a deliberately-wrong value: this must persist verbatim.
    doc.layers[0].field_mut("HeaderChecksum").unwrap().override_bytes = Some(vec![0xDE, 0xAD]);
    doc.diagnostics.push(Diagnostic::warning(
        "checksum.mismatch",
        "HeaderChecksum override 0xDEAD differs from computed value",
        Some(BitRange::bytes(10, 2)),
    ));
    doc
}

#[test]
fn buffer_serializes_as_lowercase_hex() {
    let doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(vec![0x0A, 0xFF, 0x00]));
    let json = doc.to_json().unwrap();
    assert!(json.contains("\"0aff00\""), "buffer must be lowercase hex; got:\n{json}");
}

#[test]
fn full_document_round_trips() {
    let doc = sample_document();
    let json = doc.to_json().unwrap();
    let back = PacketDocument::from_json(&json).unwrap();
    assert_eq!(doc, back);
}

#[test]
fn broken_packet_persists_unchanged() {
    // A pinned, wrong checksum + its diagnostic must come back exactly as written.
    let doc = sample_document();
    let back = PacketDocument::from_json(&doc.to_json().unwrap()).unwrap();
    let checksum = back.layer("IPv4").unwrap().field("HeaderChecksum").unwrap();
    assert_eq!(checksum.override_bytes, Some(vec![0xDE, 0xAD]));
    assert_eq!(back.diagnostics[0].severity, Severity::Warning);
    assert_eq!(back.diagnostics[0].code, "checksum.mismatch");
}

#[test]
fn missing_optional_fields_default_on_load() {
    // Only a buffer is present; version/layers/diagnostics come from defaults.
    let doc = PacketDocument::from_json(r#"{ "buffer": "deadbeef" }"#).unwrap();
    assert_eq!(doc.version, SCHEMA_VERSION);
    assert_eq!(doc.buffer.as_slice(), &[0xDE, 0xAD, 0xBE, 0xEF]);
    assert!(doc.layers.is_empty());
    assert!(doc.diagnostics.is_empty());
}

proptest! {
    /// Any byte sequence survives the wrap → serialize → deserialize trip byte-identically.
    #[test]
    fn arbitrary_bytes_round_trip(bytes in prop::collection::vec(any::<u8>(), 0..512)) {
        let doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(bytes.clone()));
        let back = PacketDocument::from_json(&doc.to_json().unwrap()).unwrap();
        prop_assert_eq!(back.buffer.as_slice(), &bytes[..]);
    }
}
