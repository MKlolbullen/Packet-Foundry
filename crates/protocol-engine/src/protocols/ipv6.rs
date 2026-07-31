//! IPv6 (40-byte fixed header, no extension headers). Payload Length is a derived field; the
//! Version/Traffic Class/Flow Label are packed into the first four bytes. Carried in an Ethernet
//! frame with ethertype `0x86DD`; chains to TCP/UDP via the Next Header field.

use packet_core::{BitRange, Field, FieldKind, Layer, Operation};
use serde::{Deserialize, Serialize};

/// Length of an IPv6 header without extension headers, in bytes.
pub const LEN: usize = 40;

/// Parameters for an IPv6 header. Version (6) is fixed; addresses are the full 16 bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ipv6Params {
    pub traffic_class: u8,
    /// 20-bit flow label (low 20 bits used).
    pub flow_label: u32,
    /// Next header / upper-layer protocol number (6 = TCP, 17 = UDP).
    pub next_header: u8,
    pub hop_limit: u8,
    pub src: [u8; 16],
    pub dst: [u8; 16],
}

impl Default for Ipv6Params {
    fn default() -> Self {
        Self {
            traffic_class: 0,
            flow_label: 0,
            next_header: 6, // TCP
            hop_limit: 64,
            src: [0; 16],
            dst: [0; 16],
        }
    }
}

/// The IPv6 (40-byte, no-extension-headers) layer/field layout at absolute byte `offset` — shared
/// by `build` and the dissector. Payload Length is derived (bytes after the fixed header);
/// addresses are shown as raw 16-byte fields (a dedicated IPv6-address display kind is a
/// follow-up).
pub fn layer(offset: usize) -> Layer {
    let bit = offset * 8;
    Layer::new(
        "IPv6",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("Version", BitRange::new(bit, 4), FieldKind::Uint),
            Field::new("TrafficClass", BitRange::new(bit + 4, 8), FieldKind::Uint),
            Field::new("FlowLabel", BitRange::new(bit + 12, 20), FieldKind::Uint),
            Field::derived(
                "PayloadLength",
                BitRange::bytes(offset + 4, 2),
                FieldKind::Uint,
                Operation::ByteLength { from_byte: offset + LEN, width: 2 },
            ),
            Field::new("NextHeader", BitRange::bytes(offset + 6, 1), FieldKind::Uint),
            Field::new("HopLimit", BitRange::bytes(offset + 7, 1), FieldKind::Uint),
            Field::new("SrcAddr", BitRange::bytes(offset + 8, 16), FieldKind::Bytes),
            Field::new("DstAddr", BitRange::bytes(offset + 24, 16), FieldKind::Bytes),
        ],
    )
}

/// Build the IPv6 header bytes and layer at absolute byte `offset`. Payload Length is left zero;
/// the resolve pass fills it from its derivation.
pub fn build(offset: usize, p: &Ipv6Params) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    // Version (6) | Traffic Class (8) | Flow Label (20) packed into the first four bytes.
    bytes[0] = 0x60 | (p.traffic_class >> 4);
    bytes[1] = (p.traffic_class << 4) | ((p.flow_label >> 16) as u8 & 0x0F);
    bytes[2] = (p.flow_label >> 8) as u8;
    bytes[3] = p.flow_label as u8;
    // [4..6] Payload Length — derived
    bytes[6] = p.next_header;
    bytes[7] = p.hop_limit;
    bytes[8..24].copy_from_slice(&p.src);
    bytes[24..40].copy_from_slice(&p.dst);
    (bytes, layer(offset))
}
