//! UDP (8-byte header). Length and Checksum are derived; the checksum sums the IPv4
//! pseudo-header (as TCP does) plus the datagram.

use packet_core::{BitRange, Field, FieldKind, Layer, Operation};

/// Length of a UDP header in bytes.
pub const LEN: usize = 8;

/// Parameters for a UDP header.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UdpParams {
    pub src_port: u16,
    pub dst_port: u16,
}

/// Build the UDP header bytes and layer at absolute byte `offset`. `ipv4_offset` locates the
/// enclosing IPv4 layer for the pseudo-header. Length and Checksum bytes are filled by resolve.
///
/// Note: RFC 768's special case (a computed checksum of `0x0000` is transmitted as `0xFFFF`) is
/// not applied here — it is a ~1/65536 case and can be pinned via an override if needed.
pub fn build(offset: usize, ipv4_offset: usize, p: &UdpParams) -> (Vec<u8>, Layer) {
    let mut bytes = vec![0u8; LEN];
    bytes[0..2].copy_from_slice(&p.src_port.to_be_bytes());
    bytes[2..4].copy_from_slice(&p.dst_port.to_be_bytes());
    // [4..6] Length — derived; [6..8] Checksum — derived

    let checksum = Operation::internet_checksum(vec![
        Operation::ReadRange(BitRange::bytes(ipv4_offset + 12, 4)),
        Operation::ReadRange(BitRange::bytes(ipv4_offset + 16, 4)),
        Operation::Const(vec![0x00, 17]),
        Operation::ByteLength { from_byte: offset, width: 2 },
        Operation::ReadFrom { from_byte: offset },
    ]);

    let layer = Layer::new(
        "UDP",
        BitRange::bytes(offset, LEN),
        vec![
            Field::new("SrcPort", BitRange::bytes(offset, 2), FieldKind::Uint),
            Field::new("DstPort", BitRange::bytes(offset + 2, 2), FieldKind::Uint),
            Field::derived(
                "Length",
                BitRange::bytes(offset + 4, 2),
                FieldKind::Uint,
                Operation::ByteLength { from_byte: offset, width: 2 },
            ),
            Field::derived("Checksum", BitRange::bytes(offset + 6, 2), FieldKind::Uint, checksum),
        ],
    );
    (bytes, layer)
}
