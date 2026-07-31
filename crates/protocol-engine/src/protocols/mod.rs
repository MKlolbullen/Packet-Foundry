//! Built-in protocol builders. Each emits header bytes plus a [`packet_core::Layer`] whose derived
//! fields are expressed in the shared `Operation` IR — the same boxes a future data-driven or
//! visual definition would produce.

pub mod arp;
pub mod ethernet;
pub mod icmp;
pub mod ipv4;
pub mod ipv6;
pub mod raw;
pub mod tcp;
pub mod udp;

/// The IP pseudo-header a transport (TCP/UDP) checksum sums before the segment itself. Lets one
/// `tcp::layer`/`udp::layer` serve a segment carried over either IPv4 or IPv6 — the address
/// widths, length width, and next-protocol placement differ, but the segment tail is identical.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pseudo {
    /// IPv4: 4-byte src/dst at `offset+12`/`+16`, a 2-byte segment length, 1-byte protocol.
    Ipv4 { offset: usize },
    /// IPv6: 16-byte src/dst at `offset+8`/`+24`, a 4-byte upper-layer length, 1-byte next header.
    Ipv6 { offset: usize },
}

impl Pseudo {
    /// The checksum operations for the pseudo-header of a transport segment at `seg_offset`
    /// whose protocol/next-header number is `proto`, followed by the segment itself.
    pub(crate) fn checksum(self, seg_offset: usize, proto: u8) -> packet_core::Operation {
        use packet_core::{BitRange, Operation};
        let parts = match self {
            Pseudo::Ipv4 { offset } => vec![
                Operation::ReadRange(BitRange::bytes(offset + 12, 4)),
                Operation::ReadRange(BitRange::bytes(offset + 16, 4)),
                Operation::Const(vec![0x00, proto]),
                Operation::ByteLength { from_byte: seg_offset, width: 2 },
                Operation::ReadFrom { from_byte: seg_offset },
            ],
            Pseudo::Ipv6 { offset } => vec![
                Operation::ReadRange(BitRange::bytes(offset + 8, 16)),
                Operation::ReadRange(BitRange::bytes(offset + 24, 16)),
                Operation::ByteLength { from_byte: seg_offset, width: 4 },
                Operation::Const(vec![0x00, 0x00, 0x00, proto]),
                Operation::ReadFrom { from_byte: seg_offset },
            ],
        };
        Operation::internet_checksum(parts)
    }
}
