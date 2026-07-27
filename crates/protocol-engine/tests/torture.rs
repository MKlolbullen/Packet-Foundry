//! Torture tests: malformed, truncated, and deliberately-invalid packets must load and be
//! *described* by diagnostics, never crash. Plus a property test that every assembled packet has
//! valid checksums regardless of inputs.

use packet_core::{BitRange, Field, FieldKind, Layer, Operation, PacketBuffer, PacketDocument};
use protocol_engine::protocols::{ipv4, tcp};
use protocol_engine::{ProtocolSpec, assemble, evaluate, validate};
use proptest::prelude::*;

fn syn(src: [u8; 4], dst: [u8; 4], sport: u16, dport: u16) -> PacketDocument {
    let ip = ipv4::Ipv4Params { src, dst, ..Default::default() };
    let t = tcp::TcpParams { src_port: sport, dst_port: dport, ..Default::default() };
    assemble(&[
        ProtocolSpec::Ethernet(Default::default()),
        ProtocolSpec::Ipv4(ip),
        ProtocolSpec::Tcp(t),
    ])
    .unwrap()
}

#[test]
fn corrupted_checksum_is_flagged_without_panic() {
    let mut doc = syn([192, 168, 0, 1], [192, 168, 0, 2], 1000, 80);
    // Corrupt the IPv4 header checksum bytes directly (as if hand-edited in the JSON).
    let orig = doc.buffer.read_bytes(BitRange::bytes(24, 2)).unwrap();
    doc.buffer.write_bytes(BitRange::bytes(24, 2), &[orig[0] ^ 0xFF, orig[1]]).unwrap();

    let diags = validate(&doc);
    assert!(
        diags.iter().any(|d| d.code == "field.derivation_mismatch"),
        "expected a derivation mismatch, got {diags:?}"
    );
}

#[test]
fn truncated_layer_is_flagged() {
    // A 4-byte buffer carrying a layer + field that claim 20 bytes.
    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(vec![0u8; 4]));
    doc.layers.push(Layer::new(
        "IPv4",
        BitRange::bytes(0, 20),
        vec![Field::new("SrcAddr", BitRange::bytes(12, 4), FieldKind::Ipv4Addr)],
    ));

    let diags = validate(&doc);
    assert!(diags.iter().any(|d| d.code == "layer.truncated"));
    assert!(diags.iter().any(|d| d.code == "field.out_of_bounds"));
}

#[test]
fn overlapping_fields_are_flagged() {
    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(vec![0u8; 4]));
    doc.layers.push(Layer::new(
        "L",
        BitRange::bytes(0, 4),
        vec![
            Field::new("A", BitRange::bytes(0, 3), FieldKind::Bytes),
            Field::new("B", BitRange::bytes(2, 2), FieldKind::Bytes),
        ],
    ));

    assert!(validate(&doc).iter().any(|d| d.code == "field.overlap"));
}

#[test]
fn empty_and_garbage_buffers_do_not_panic() {
    let _ = validate(&PacketDocument::with_buffer(PacketBuffer::new()));
    let _ = validate(&PacketDocument::with_buffer(PacketBuffer::from_bytes(vec![0xFF; 7])));

    // An odd-length buffer with a derived checksum field still just reports, never panics.
    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(vec![0x01, 0x02, 0x03]));
    doc.layers.push(Layer::new(
        "L",
        BitRange::bytes(0, 3),
        vec![Field::derived(
            "Cksum",
            BitRange::bytes(1, 2),
            FieldKind::Uint,
            Operation::internet_checksum(vec![Operation::ReadFrom { from_byte: 0 }]),
        )],
    ));
    let _ = validate(&doc);
}

proptest! {
    /// However the addresses, ports, and flags vary, an assembled packet is clean and both
    /// checksums verify (the covered region sums to zero).
    #[test]
    fn assembled_packets_always_verify(
        src in proptest::array::uniform4(any::<u8>()),
        dst in proptest::array::uniform4(any::<u8>()),
        sport in any::<u16>(),
        dport in any::<u16>(),
    ) {
        let doc = syn(src, dst, sport, dport);
        prop_assert!(doc.diagnostics.is_empty(), "diagnostics: {:?}", doc.diagnostics);

        let ipv4_sum = evaluate(
            &Operation::OnesComplementSum(vec![Operation::ReadRange(BitRange::bytes(14, 20))]),
            &doc.buffer,
        ).unwrap();
        prop_assert_eq!(ipv4_sum, vec![0, 0]);

        let tcp_sum = evaluate(
            &Operation::OnesComplementSum(vec![
                Operation::ReadRange(BitRange::bytes(26, 4)),
                Operation::ReadRange(BitRange::bytes(30, 4)),
                Operation::Const(vec![0, 6]),
                Operation::ByteLength { from_byte: 34, width: 2 },
                Operation::ReadFrom { from_byte: 34 },
            ]),
            &doc.buffer,
        ).unwrap();
        prop_assert_eq!(tcp_sum, vec![0, 0]);
    }
}
