//! Ethernet II framing (14 bytes): destination MAC, source MAC, EtherType. No derived fields.

use packet_core::{BitRange, Field, FieldKind, Layer};
use serde::{Deserialize, Serialize};

/// Length of an Ethernet II header in bytes.
pub const LEN: usize = 14;

/// Parameters for an Ethernet II header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EthernetParams {
    pub dst_mac: [u8; 6],
    pub src_mac: [u8; 6],
    pub ethertype: u16,
}

impl Default for EthernetParams {
    fn default() -> Self {
        Self {
            dst_mac: [0; 6],
            src_mac: [0; 6],
            ethertype: 0x0800, // IPv4
        }
    }
}

/// Build the header bytes and the layer description at absolute byte `offset`.
pub fn build(offset: usize, p: &EthernetParams) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    bytes[0..6].copy_from_slice(&p.dst_mac);
    bytes[6..12].copy_from_slice(&p.src_mac);
    bytes[12..14].copy_from_slice(&p.ethertype.to_be_bytes());

    let layer = Layer::new(
        "Ethernet II",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("DstMac", BitRange::bytes(offset, 6), FieldKind::MacAddr),
            Field::new("SrcMac", BitRange::bytes(offset + 6, 6), FieldKind::MacAddr),
            Field::new("EtherType", BitRange::bytes(offset + 12, 2), FieldKind::Uint),
        ],
    );
    (bytes, layer)
}
