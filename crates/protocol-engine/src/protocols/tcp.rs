//! TCP (20-byte header, no options). The Checksum is the marquee cross-layer derivation: it
//! sums an IPv4 pseudo-header (source/destination address read from the IPv4 layer, protocol, and
//! segment length) together with the TCP segment itself — the best torture test for the
//! dependency-ordered resolver.

use packet_core::{BitRange, Field, FieldKind, Layer};
use serde::{Deserialize, Serialize};

use super::Pseudo;

/// Length of a TCP header without options, in bytes.
pub const LEN: usize = 20;

/// Common TCP flag bits.
pub mod flags {
    pub const FIN: u8 = 0x01;
    pub const SYN: u8 = 0x02;
    pub const RST: u8 = 0x04;
    pub const PSH: u8 = 0x08;
    pub const ACK: u8 = 0x10;
}

/// Parameters for a TCP header. Data Offset is fixed at 5 (no options) in Phase 1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TcpParams {
    pub src_port: u16,
    pub dst_port: u16,
    pub seq: u32,
    pub ack: u32,
    pub flags: u8,
    pub window: u16,
    pub urgent: u16,
}

impl Default for TcpParams {
    fn default() -> Self {
        Self {
            src_port: 0,
            dst_port: 0,
            seq: 0,
            ack: 0,
            flags: flags::SYN,
            window: 0xFFFF,
            urgent: 0,
        }
    }
}

/// The TCP (20-byte, no-options) layer/field layout at absolute byte `offset`. `pseudo` locates
/// the enclosing IP layer (v4 or v6) for the checksum's pseudo-header — so this genuinely depends
/// on it, not just `offset`. Shared by `build` and the dissector.
pub fn layer(offset: usize, pseudo: Pseudo) -> Layer {
    let checksum = pseudo.checksum(offset, 6); // pseudo-header + the whole segment

    let bit = offset * 8;
    Layer::new(
        "TCP",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("SrcPort", BitRange::bytes(offset, 2), FieldKind::Uint),
            Field::new("DstPort", BitRange::bytes(offset + 2, 2), FieldKind::Uint),
            Field::new("SeqNum", BitRange::bytes(offset + 4, 4), FieldKind::Uint),
            Field::new("AckNum", BitRange::bytes(offset + 8, 4), FieldKind::Uint),
            Field::new("DataOffset", BitRange::new(bit + 96, 4), FieldKind::Uint),
            Field::new("Flags", BitRange::bytes(offset + 13, 1), FieldKind::Flags),
            Field::new("Window", BitRange::bytes(offset + 14, 2), FieldKind::Uint),
            Field::derived("Checksum", BitRange::bytes(offset + 16, 2), FieldKind::Uint, checksum),
            Field::new("UrgentPtr", BitRange::bytes(offset + 18, 2), FieldKind::Uint),
        ],
    )
}

/// Build the TCP header bytes and layer at absolute byte `offset`. `pseudo` locates the enclosing
/// IP layer (v4 or v6) for the checksum's pseudo-header. The Checksum bytes are left zero; the
/// resolve pass computes them.
pub fn build(offset: usize, pseudo: Pseudo, p: &TcpParams) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    bytes[0..2].copy_from_slice(&p.src_port.to_be_bytes());
    bytes[2..4].copy_from_slice(&p.dst_port.to_be_bytes());
    bytes[4..8].copy_from_slice(&p.seq.to_be_bytes());
    bytes[8..12].copy_from_slice(&p.ack.to_be_bytes());
    bytes[12] = 5 << 4; // Data Offset 5, reserved 0
    bytes[13] = p.flags;
    bytes[14..16].copy_from_slice(&p.window.to_be_bytes());
    // [16..18] Checksum — derived
    bytes[18..20].copy_from_slice(&p.urgent.to_be_bytes());
    (bytes, layer(offset, pseudo))
}
