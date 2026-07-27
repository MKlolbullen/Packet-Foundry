//! ICMP echo (8-byte header). The Checksum covers the whole ICMP message (header + data) with
//! no pseudo-header — the simplest checksum box in the set.

use packet_core::{BitRange, Field, FieldKind, Layer, Operation};

/// Length of the ICMP echo header in bytes.
pub const LEN: usize = 8;

/// Parameters for an ICMP echo message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IcmpParams {
    pub icmp_type: u8,
    pub code: u8,
    pub identifier: u16,
    pub sequence: u16,
}

impl Default for IcmpParams {
    fn default() -> Self {
        Self {
            icmp_type: 8, // Echo Request
            code: 0,
            identifier: 0,
            sequence: 0,
        }
    }
}

/// Build the ICMP header bytes and layer at absolute byte `offset`. The Checksum bytes are filled
/// by resolve.
pub fn build(offset: usize, p: &IcmpParams) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    bytes[0] = p.icmp_type;
    bytes[1] = p.code;
    // [2..4] Checksum — derived
    bytes[4..6].copy_from_slice(&p.identifier.to_be_bytes());
    bytes[6..8].copy_from_slice(&p.sequence.to_be_bytes());

    let checksum = Operation::internet_checksum(vec![Operation::ReadFrom { from_byte: offset }]);

    let layer = Layer::new(
        "ICMP",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("Type", BitRange::bytes(offset, 1), FieldKind::Uint),
            Field::new("Code", BitRange::bytes(offset + 1, 1), FieldKind::Uint),
            Field::derived("Checksum", BitRange::bytes(offset + 2, 2), FieldKind::Uint, checksum),
            Field::new("Identifier", BitRange::bytes(offset + 4, 2), FieldKind::Uint),
            Field::new("SequenceNumber", BitRange::bytes(offset + 6, 2), FieldKind::Uint),
        ],
    );
    (bytes, layer)
}
