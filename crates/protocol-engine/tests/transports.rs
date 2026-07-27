//! UDP and ICMP assembly: derived lengths/checksums and the auto-set IPv4 protocol byte.

use packet_core::{BitRange, Operation, PacketDocument};
use protocol_engine::protocols::{icmp, ipv4, udp};
use protocol_engine::{ProtocolSpec, assemble, evaluate};

const IP_OFF: usize = 14;
const L4_OFF: usize = 34;

fn over_ipv4(transport: ProtocolSpec, payload: &[u8]) -> PacketDocument {
    let ip = ipv4::Ipv4Params { src: [10, 0, 0, 1], dst: [10, 0, 0, 2], ..Default::default() };
    assemble(&[
        ProtocolSpec::Ethernet(Default::default()),
        ProtocolSpec::Ipv4(ip),
        transport,
        ProtocolSpec::Raw(payload.to_vec()),
    ])
    .unwrap()
}

#[test]
fn udp_sets_protocol_length_and_valid_checksum() {
    let doc = over_ipv4(ProtocolSpec::Udp(udp::UdpParams { src_port: 1000, dst_port: 53 }), b"hi");
    let b = doc.buffer.as_slice();

    assert_eq!(b[IP_OFF + 9], 17, "IPv4 protocol = UDP");
    assert_eq!(&b[L4_OFF + 4..L4_OFF + 6], &10u16.to_be_bytes(), "UDP length = 8 header + 2 data");
    assert!(doc.diagnostics.is_empty(), "unexpected diagnostics: {:?}", doc.diagnostics);

    let sum = evaluate(
        &Operation::OnesComplementSum(vec![
            Operation::ReadRange(BitRange::bytes(IP_OFF + 12, 4)),
            Operation::ReadRange(BitRange::bytes(IP_OFF + 16, 4)),
            Operation::Const(vec![0, 17]),
            Operation::ByteLength { from_byte: L4_OFF, width: 2 },
            Operation::ReadFrom { from_byte: L4_OFF },
        ]),
        &doc.buffer,
    )
    .unwrap();
    assert_eq!(sum, vec![0, 0], "UDP checksum must be valid");
}

#[test]
fn icmp_echo_sets_protocol_and_valid_checksum() {
    let doc = over_ipv4(ProtocolSpec::Icmp(icmp::IcmpParams::default()), b"ping");
    let b = doc.buffer.as_slice();

    assert_eq!(b[IP_OFF + 9], 1, "IPv4 protocol = ICMP");
    assert_eq!(b[L4_OFF], 8, "ICMP echo request type");
    assert_eq!(b[L4_OFF + 1], 0, "ICMP code 0");
    assert!(doc.diagnostics.is_empty(), "unexpected diagnostics: {:?}", doc.diagnostics);

    // ICMP checksum covers the whole message, no pseudo-header.
    let sum = evaluate(
        &Operation::OnesComplementSum(vec![Operation::ReadFrom { from_byte: L4_OFF }]),
        &doc.buffer,
    )
    .unwrap();
    assert_eq!(sum, vec![0, 0], "ICMP checksum must be valid");
}

#[test]
fn udp_and_icmp_require_ipv4() {
    assert!(assemble(&[ProtocolSpec::Udp(udp::UdpParams::default())]).is_err());
    assert!(assemble(&[ProtocolSpec::Icmp(icmp::IcmpParams::default())]).is_err());
}
