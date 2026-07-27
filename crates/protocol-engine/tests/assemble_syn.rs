//! End-to-end assembly: a real TCP SYN over IPv4 over Ethernet, with valid checksums.

use packet_core::{BitRange, Operation, PacketDocument};
use protocol_engine::protocols::{ethernet, ipv4, tcp};
use protocol_engine::{EngineError, ProtocolSpec, assemble, evaluate};

const IP_OFF: usize = 14;
const TCP_OFF: usize = 34;

fn syn() -> PacketDocument {
    let ip = ipv4::Ipv4Params { src: [192, 168, 1, 10], dst: [192, 168, 1, 20], ..Default::default() };
    let tcp = tcp::TcpParams { src_port: 1234, dst_port: 443, ..Default::default() };
    assemble(&[
        ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
        ProtocolSpec::Ipv4(ip),
        ProtocolSpec::Tcp(tcp),
    ])
    .unwrap()
}

/// Sum a set of operations over the buffer via the one's-complement checksum. A correct checksum
/// makes the covered region (checksum field included) sum to zero.
fn checksum_sum(parts: Vec<Operation>, doc: &PacketDocument) -> Vec<u8> {
    evaluate(&Operation::OnesComplementSum(parts), &doc.buffer).unwrap()
}

#[test]
fn assembles_a_54_byte_frame_with_no_diagnostics() {
    let doc = syn();
    assert_eq!(doc.buffer.len(), 54);
    assert!(doc.diagnostics.is_empty(), "unexpected diagnostics: {:?}", doc.diagnostics);
}

#[test]
fn ipv4_header_fields_are_correct() {
    let doc = syn();
    let b = doc.buffer.as_slice();
    assert_eq!(b[IP_OFF], 0x45, "version/IHL");
    assert_eq!(b[IP_OFF + 8], 64, "TTL");
    assert_eq!(b[IP_OFF + 9], 6, "protocol = TCP");
    assert_eq!(&b[IP_OFF + 2..IP_OFF + 4], &40u16.to_be_bytes(), "Total Length = 40");
    assert_eq!(&b[IP_OFF + 12..IP_OFF + 16], &[192, 168, 1, 10], "src addr");
    assert_eq!(&b[IP_OFF + 16..IP_OFF + 20], &[192, 168, 1, 20], "dst addr");
}

#[test]
fn tcp_header_fields_are_correct() {
    let doc = syn();
    let b = doc.buffer.as_slice();
    assert_eq!(&b[TCP_OFF..TCP_OFF + 2], &1234u16.to_be_bytes(), "src port");
    assert_eq!(&b[TCP_OFF + 2..TCP_OFF + 4], &443u16.to_be_bytes(), "dst port");
    assert_eq!(b[TCP_OFF + 12], 0x50, "data offset 5");
    assert_eq!(b[TCP_OFF + 13], 0x02, "SYN flag");
}

#[test]
fn ipv4_checksum_is_valid() {
    let doc = syn();
    let sum = checksum_sum(vec![Operation::ReadRange(BitRange::bytes(IP_OFF, 20))], &doc);
    assert_eq!(sum, vec![0x00, 0x00]);
}

#[test]
fn tcp_checksum_is_valid() {
    let doc = syn();
    let sum = checksum_sum(
        vec![
            Operation::ReadRange(BitRange::bytes(IP_OFF + 12, 4)),
            Operation::ReadRange(BitRange::bytes(IP_OFF + 16, 4)),
            Operation::Const(vec![0x00, 0x06]),
            Operation::ByteLength { from_byte: TCP_OFF, width: 2 },
            Operation::ReadFrom { from_byte: TCP_OFF },
        ],
        &doc,
    );
    assert_eq!(sum, vec![0x00, 0x00]);
}

#[test]
fn tcp_without_ipv4_is_an_assembly_error() {
    let err = assemble(&[ProtocolSpec::Tcp(tcp::TcpParams::default())]).unwrap_err();
    assert!(matches!(err, EngineError::Assembly(_)));
}

#[test]
fn payload_extends_length_and_checksum_covers_it() {
    let ip = ipv4::Ipv4Params { src: [10, 0, 0, 1], dst: [10, 0, 0, 2], ..Default::default() };
    let doc = assemble(&[
        ProtocolSpec::Ethernet(Default::default()),
        ProtocolSpec::Ipv4(ip),
        ProtocolSpec::Tcp(Default::default()),
        ProtocolSpec::Raw(b"hello".to_vec()),
    ])
    .unwrap();

    assert_eq!(doc.buffer.len(), 14 + 20 + 20 + 5);
    let b = doc.buffer.as_slice();
    assert_eq!(&b[IP_OFF + 2..IP_OFF + 4], &45u16.to_be_bytes(), "Total Length includes payload");
    assert!(doc.diagnostics.is_empty(), "unexpected diagnostics: {:?}", doc.diagnostics);

    let sum = checksum_sum(
        vec![
            Operation::ReadRange(BitRange::bytes(IP_OFF + 12, 4)),
            Operation::ReadRange(BitRange::bytes(IP_OFF + 16, 4)),
            Operation::Const(vec![0x00, 0x06]),
            Operation::ByteLength { from_byte: TCP_OFF, width: 2 },
            Operation::ReadFrom { from_byte: TCP_OFF },
        ],
        &doc,
    );
    assert_eq!(sum, vec![0x00, 0x00], "TCP checksum must cover the payload");
}
