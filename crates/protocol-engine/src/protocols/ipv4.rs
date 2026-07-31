//! IPv4 (20-byte header, no options). Total Length and Header Checksum are derived fields,
//! authored as the same `Operation` IR the eventual box language uses.

use packet_core::{BitRange, Field, FieldKind, Layer, Operation};
use serde::{Deserialize, Serialize};

/// Length of an IPv4 header without options, in bytes.
pub const LEN: usize = 20;

/// Parameters for an IPv4 header. Version (4) and IHL (5) are fixed in Phase 1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ipv4Params {
    pub dscp_ecn: u8,
    pub identification: u16,
    /// Combined 3-bit flags + 13-bit fragment offset.
    pub flags_frag: u16,
    pub ttl: u8,
    pub protocol: u8,
    pub src: [u8; 4],
    pub dst: [u8; 4],
}

impl Default for Ipv4Params {
    fn default() -> Self {
        Self {
            dscp_ecn: 0,
            identification: 0,
            flags_frag: 0x4000, // Don't Fragment
            ttl: 64,
            protocol: 6, // TCP
            src: [0; 4],
            dst: [0; 4],
        }
    }
}

/// The IPv4 (20-byte, no-options) layer/field layout at absolute byte `offset` — shared by
/// `build` and the dissector. Total Length / Header Checksum are derived fields; a dissected
/// packet keeps its captured bytes (validate, not resolve), so those fields carry their
/// derivations for reference without being recomputed.
pub fn layer(offset: usize) -> Layer {
    let bit = offset * 8;
    Layer::new(
        "IPv4",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("Version", BitRange::new(bit, 4), FieldKind::Uint),
            Field::new("IHL", BitRange::new(bit + 4, 4), FieldKind::Uint),
            Field::new("DSCP_ECN", BitRange::bytes(offset + 1, 1), FieldKind::Uint),
            Field::derived(
                "TotalLength",
                BitRange::bytes(offset + 2, 2),
                FieldKind::Uint,
                Operation::ByteLength { from_byte: offset, width: 2 },
            ),
            Field::new("Identification", BitRange::bytes(offset + 4, 2), FieldKind::Uint),
            Field::new("FlagsFragment", BitRange::bytes(offset + 6, 2), FieldKind::Flags),
            Field::new("TTL", BitRange::bytes(offset + 8, 1), FieldKind::Uint),
            Field::new("Protocol", BitRange::bytes(offset + 9, 1), FieldKind::Uint),
            Field::derived(
                "HeaderChecksum",
                BitRange::bytes(offset + 10, 2),
                FieldKind::Uint,
                Operation::internet_checksum(vec![Operation::ReadRange(BitRange::bytes(offset, LEN))]),
            ),
            Field::new("SrcAddr", BitRange::bytes(offset + 12, 4), FieldKind::Ipv4Addr),
            Field::new("DstAddr", BitRange::bytes(offset + 16, 4), FieldKind::Ipv4Addr),
        ],
    )
}

/// Build the header bytes and layer at absolute byte `offset`. Total Length and Header Checksum
/// bytes are left zero here; the resolve pass fills them from their derivations.
pub fn build(offset: usize, p: &Ipv4Params) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    bytes[0] = 0x45; // Version 4, IHL 5
    bytes[1] = p.dscp_ecn;
    // [2..4] Total Length — derived
    bytes[4..6].copy_from_slice(&p.identification.to_be_bytes());
    bytes[6..8].copy_from_slice(&p.flags_frag.to_be_bytes());
    bytes[8] = p.ttl;
    bytes[9] = p.protocol;
    // [10..12] Header Checksum — derived
    bytes[12..16].copy_from_slice(&p.src);
    bytes[16..20].copy_from_slice(&p.dst);
    (bytes, layer(offset))
}
