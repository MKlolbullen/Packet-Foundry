//! The shipped JSON descriptors in `protocols/` must lower to byte-identical output as the
//! hand-written Rust builders — proof that "protocols as data" is a faithful mirror, not a fork.

use protocol_engine::descriptor::{LayoutContext, ProtocolDescriptor, lower};
use protocol_engine::protocols::{ethernet, icmp, ipv4, tcp, udp};

fn load(name: &str) -> ProtocolDescriptor {
    let path = format!("{}/../../protocols/{}", env!("CARGO_MANIFEST_DIR"), name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    ProtocolDescriptor::from_json(&text).unwrap_or_else(|e| panic!("parse {name}: {e}"))
}

#[test]
fn shipped_descriptors_lower_identically_to_builders() {
    let ip = ipv4::Ipv4Params::default();
    let (_, ipv4_layer) = ipv4::build(14, &ip);
    let placed = vec![ipv4_layer]; // TCP/UDP reference IPv4 addresses.

    assert_eq!(
        lower(&load("ethernet.json"), &LayoutContext { offset: 0, placed: &[] }).unwrap(),
        ethernet::build(0, &ethernet::EthernetParams::default()),
        "ethernet.json",
    );
    assert_eq!(
        lower(&load("ipv4.json"), &LayoutContext { offset: 14, placed: &[] }).unwrap(),
        ipv4::build(14, &ip),
        "ipv4.json",
    );
    assert_eq!(
        lower(&load("tcp.json"), &LayoutContext { offset: 34, placed: &placed }).unwrap(),
        tcp::build(34, 14, &tcp::TcpParams::default()),
        "tcp.json",
    );
    assert_eq!(
        lower(&load("udp.json"), &LayoutContext { offset: 34, placed: &placed }).unwrap(),
        udp::build(34, 14, &udp::UdpParams::default()),
        "udp.json",
    );
    assert_eq!(
        lower(&load("icmp.json"), &LayoutContext { offset: 34, placed: &placed }).unwrap(),
        icmp::build(34, &icmp::IcmpParams::default()),
        "icmp.json",
    );
}
