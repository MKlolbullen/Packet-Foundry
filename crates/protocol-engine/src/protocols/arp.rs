//! ARP for Ethernet/IPv4 (28-byte fixed layout). No derived fields — every field is supplied
//! directly. Carried in an Ethernet frame with ethertype `0x0806`; it's a leaf (no payload).

use packet_core::{BitRange, Field, FieldKind, Layer};
use serde::{Deserialize, Serialize};

/// Length of an Ethernet/IPv4 ARP message in bytes.
pub const LEN: usize = 28;

/// Parameters for an Ethernet/IPv4 ARP message. Hardware/protocol type and lengths are fixed for
/// this common case (Ethernet + IPv4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArpParams {
    /// 1 = request, 2 = reply.
    pub oper: u16,
    pub sender_mac: [u8; 6],
    pub sender_ip: [u8; 4],
    pub target_mac: [u8; 6],
    pub target_ip: [u8; 4],
}

impl Default for ArpParams {
    fn default() -> Self {
        Self {
            oper: 1, // request
            sender_mac: [0; 6],
            sender_ip: [0; 4],
            target_mac: [0; 6],
            target_ip: [0; 4],
        }
    }
}

/// The ARP layer/field layout at absolute byte `offset` — shared by `build` and the dissector.
pub fn layer(offset: usize) -> Layer {
    Layer::new(
        "ARP",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("HardwareType", BitRange::bytes(offset, 2), FieldKind::Uint),
            Field::new("ProtocolType", BitRange::bytes(offset + 2, 2), FieldKind::Uint),
            Field::new("HardwareLen", BitRange::bytes(offset + 4, 1), FieldKind::Uint),
            Field::new("ProtocolLen", BitRange::bytes(offset + 5, 1), FieldKind::Uint),
            Field::new("Operation", BitRange::bytes(offset + 6, 2), FieldKind::Uint),
            Field::new("SenderMac", BitRange::bytes(offset + 8, 6), FieldKind::MacAddr),
            Field::new("SenderIp", BitRange::bytes(offset + 14, 4), FieldKind::Ipv4Addr),
            Field::new("TargetMac", BitRange::bytes(offset + 18, 6), FieldKind::MacAddr),
            Field::new("TargetIp", BitRange::bytes(offset + 24, 4), FieldKind::Ipv4Addr),
        ],
    )
}

/// Build the ARP message bytes and layer at absolute byte `offset`. Hardware type Ethernet (1),
/// protocol type IPv4 (0x0800), and the 6/4 address lengths are written for you.
pub fn build(offset: usize, p: &ArpParams) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    bytes[0..2].copy_from_slice(&1u16.to_be_bytes()); // HTYPE: Ethernet
    bytes[2..4].copy_from_slice(&0x0800u16.to_be_bytes()); // PTYPE: IPv4
    bytes[4] = 6; // HLEN
    bytes[5] = 4; // PLEN
    bytes[6..8].copy_from_slice(&p.oper.to_be_bytes());
    bytes[8..14].copy_from_slice(&p.sender_mac);
    bytes[14..18].copy_from_slice(&p.sender_ip);
    bytes[18..24].copy_from_slice(&p.target_mac);
    bytes[24..28].copy_from_slice(&p.target_ip);
    (bytes, layer(offset))
}
