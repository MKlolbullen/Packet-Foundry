//! ICMPv6 (4-byte fixed header: Type, Code, Checksum). Unlike ICMPv4, the Checksum covers an IPv6
//! pseudo-header (next-header 58) *and* the ICMPv6 message — the same pseudo-header machinery
//! TCP/UDP use over IPv6. Any message body past the 4-byte header (e.g. an echo Identifier/Sequence)
//! is captured as a following `Raw` region rather than modeled per-type here.

use packet_core::{BitRange, Field, FieldKind, Layer};
use serde::{Deserialize, Serialize};

use super::Pseudo;

/// The ICMPv6 next-header / protocol number.
pub const PROTO: u8 = 58;

/// Length of the fixed ICMPv6 header (Type, Code, Checksum), in bytes.
pub const LEN: usize = 4;

/// Parameters for an ICMPv6 message. Defaults to an Echo Request (type 128).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Icmpv6Params {
    pub icmp_type: u8,
    pub code: u8,
}

impl Default for Icmpv6Params {
    fn default() -> Self {
        Self {
            icmp_type: 128, // Echo Request
            code: 0,
        }
    }
}

/// The ICMPv6 layer/field layout at absolute byte `offset` — shared by `build` and the dissector.
/// `pseudo` locates the enclosing IPv6 layer for the checksum's pseudo-header (next-header 58).
pub fn layer(offset: usize, pseudo: Pseudo) -> Layer {
    let checksum = pseudo.checksum(offset, PROTO); // IPv6 pseudo-header + the whole ICMPv6 message
    Layer::new(
        "ICMPv6",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("Type", BitRange::bytes(offset, 1), FieldKind::Uint),
            Field::new("Code", BitRange::bytes(offset + 1, 1), FieldKind::Uint),
            Field::derived("Checksum", BitRange::bytes(offset + 2, 2), FieldKind::Uint, checksum),
        ],
    )
}

/// Build the ICMPv6 header bytes and layer at absolute byte `offset`. `pseudo` locates the
/// enclosing IPv6 layer for the checksum's pseudo-header. The Checksum bytes are left zero; the
/// resolve pass computes them.
pub fn build(offset: usize, pseudo: Pseudo, p: &Icmpv6Params) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    bytes[0] = p.icmp_type;
    bytes[1] = p.code;
    // [2..4] Checksum — derived
    (bytes, layer(offset, pseudo))
}
