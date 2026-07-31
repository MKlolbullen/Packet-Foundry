//! 802.1Q VLAN tag (4 bytes). The tag follows an Ethernet `EtherType` of `0x8100` (the TPID); the
//! tag itself is a 2-byte Tag Control Information word — Priority (3 bits), DEI (1 bit), VLAN ID
//! (12 bits) — plus a 2-byte inner EtherType naming what the tag encapsulates. Stacking two tags
//! (QinQ) is expressed by a VLAN whose inner EtherType is again `0x8100`.

use packet_core::{BitRange, Field, FieldKind, Layer};
use serde::{Deserialize, Serialize};

/// The TPID an Ethernet frame carries in its EtherType slot to announce a following 802.1Q tag.
pub const TPID_8021Q: u16 = 0x8100;

/// Length of an 802.1Q VLAN tag in bytes (TCI + inner EtherType).
pub const LEN: usize = 4;

/// Parameters for an 802.1Q VLAN tag. The inner EtherType is stamped by whatever protocol follows
/// (like Ethernet's own EtherType), so it isn't a parameter here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VlanParams {
    /// Priority Code Point (0–7).
    pub priority: u8,
    /// Drop Eligible Indicator.
    pub dei: bool,
    /// VLAN identifier (0–4095).
    pub vlan_id: u16,
}

impl Default for VlanParams {
    fn default() -> Self {
        Self {
            priority: 0,
            dei: false,
            vlan_id: 1,
        }
    }
}

/// The 802.1Q layer/field layout at absolute byte `offset` — shared by `build` and the dissector.
/// Priority/DEI/VLAN-ID are sub-byte fields packed into the first two bytes; the VLAN ID (12 bits)
/// deliberately crosses the byte boundary, so it is placed bit-precisely.
pub fn layer(offset: usize) -> Layer {
    let bit = offset * 8;
    Layer::new(
        "802.1Q VLAN",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("Priority", BitRange::new(bit, 3), FieldKind::Uint),
            Field::new("DEI", BitRange::new(bit + 3, 1), FieldKind::Uint),
            Field::new("VlanId", BitRange::new(bit + 4, 12), FieldKind::Uint),
            Field::new("EtherType", BitRange::bytes(offset + 2, 2), FieldKind::Uint),
        ],
    )
}

/// Build the 802.1Q tag bytes and layer at absolute byte `offset`. The inner EtherType is left
/// zero; the assembler stamps it from whatever protocol follows the tag.
pub fn build(offset: usize, p: &VlanParams) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    // TCI: PCP (3) | DEI (1) | VID (12), packed big-endian across the first two bytes.
    let tci: u16 = ((p.priority as u16 & 0x07) << 13)
        | ((p.dei as u16 & 0x01) << 12)
        | (p.vlan_id & 0x0FFF);
    bytes[0..2].copy_from_slice(&tci.to_be_bytes());
    // [2..4] inner EtherType — stamped by the following layer.
    (bytes, layer(offset))
}
