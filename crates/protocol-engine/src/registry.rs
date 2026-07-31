//! The registry: turn an ordered stack of protocol specs into a resolved [`PacketDocument`].
//!
//! Stacking is the assembler's layout pass — each layer is appended to the buffer and its fields
//! are placed at absolute offsets. Then [`resolve`] runs the resolve pass, filling derived fields
//! (lengths, checksums) in dependency order.

use packet_core::{PacketBuffer, PacketDocument};
use serde::{Deserialize, Serialize};

use crate::eval::EngineError;
use crate::protocols::{Pseudo, arp, ethernet, icmp, ipv4, ipv6, raw, tcp, udp};
use crate::resolve::resolve;

/// One protocol layer to place in a packet, with its parameters. Serializes externally-tagged,
/// e.g. `{"Tcp": {"src_port": 1234, ...}}` or `{"Raw": [1, 2, 3]}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProtocolSpec {
    Ethernet(ethernet::EthernetParams),
    Ipv4(ipv4::Ipv4Params),
    Ipv6(ipv6::Ipv6Params),
    Arp(arp::ArpParams),
    Tcp(tcp::TcpParams),
    Udp(udp::UdpParams),
    Icmp(icmp::IcmpParams),
    Raw(Vec<u8>),
}

/// EtherType values the assembler writes into a preceding Ethernet layer so a frame identifies
/// the network protocol that follows.
const ETHERTYPE_IPV4: u16 = 0x0800;
const ETHERTYPE_IPV6: u16 = 0x86DD;
const ETHERTYPE_ARP: u16 = 0x0806;

/// The network layer a transport rides on — its absolute offset plus which IP version, so the
/// assembler can set the right next-protocol field and pseudo-header.
#[derive(Clone, Copy)]
enum Net {
    Ipv4(usize),
    Ipv6(usize),
}

impl ProtocolSpec {
    /// A default spec for a protocol name, or `None` if unknown.
    pub fn from_name(name: &str) -> Option<ProtocolSpec> {
        match name.to_ascii_lowercase().as_str() {
            "ethernet" | "eth" => Some(ProtocolSpec::Ethernet(Default::default())),
            "ipv4" | "ip" => Some(ProtocolSpec::Ipv4(Default::default())),
            "ipv6" | "ip6" => Some(ProtocolSpec::Ipv6(Default::default())),
            "arp" => Some(ProtocolSpec::Arp(Default::default())),
            "tcp" => Some(ProtocolSpec::Tcp(Default::default())),
            "udp" => Some(ProtocolSpec::Udp(Default::default())),
            "icmp" => Some(ProtocolSpec::Icmp(Default::default())),
            "raw" | "payload" => Some(ProtocolSpec::Raw(Vec::new())),
            _ => None,
        }
    }

    /// Human-readable protocol name.
    pub fn name(&self) -> &'static str {
        match self {
            ProtocolSpec::Ethernet(_) => "ethernet",
            ProtocolSpec::Ipv4(_) => "ipv4",
            ProtocolSpec::Ipv6(_) => "ipv6",
            ProtocolSpec::Arp(_) => "arp",
            ProtocolSpec::Tcp(_) => "tcp",
            ProtocolSpec::Udp(_) => "udp",
            ProtocolSpec::Icmp(_) => "icmp",
            ProtocolSpec::Raw(_) => "raw",
        }
    }
}

/// Assemble an ordered protocol stack into a resolved document (layout pass + resolve pass).
///
/// Layer linking is generalized over the network layer: placing IPv4/IPv6/ARP stamps the right
/// EtherType into a preceding Ethernet frame, and placing a transport sets the enclosing IP
/// layer's next-protocol field (IPv4 `protocol` byte / IPv6 `next header` byte) and picks the
/// matching pseudo-header for its checksum.
pub fn assemble(stack: &[ProtocolSpec]) -> Result<PacketDocument, EngineError> {
    let mut bytes: Vec<u8> = Vec::new();
    let mut layers = Vec::new();
    let mut eth_offset: Option<usize> = None;
    let mut net: Option<Net> = None;

    // Write a next-protocol number into the enclosing IP layer, and return the pseudo-header its
    // transports should checksum against.
    fn transport_over(
        net: Option<Net>,
        bytes: &mut [u8],
        proto: u8,
        what: &'static str,
    ) -> Result<Pseudo, EngineError> {
        match net {
            Some(Net::Ipv4(ip)) => {
                bytes[ip + 9] = proto; // IPv4 Protocol
                Ok(Pseudo::Ipv4 { offset: ip })
            }
            Some(Net::Ipv6(ip)) => {
                bytes[ip + 6] = proto; // IPv6 Next Header
                Ok(Pseudo::Ipv6 { offset: ip })
            }
            None => Err(EngineError::Assembly(what)),
        }
    }

    for spec in stack {
        let offset = bytes.len();
        let (chunk, layer) = match spec {
            ProtocolSpec::Ethernet(p) => ethernet::build(offset, p),
            ProtocolSpec::Ipv4(p) => {
                net = Some(Net::Ipv4(offset));
                set_ethertype(&mut bytes, eth_offset, ETHERTYPE_IPV4);
                ipv4::build(offset, p)
            }
            ProtocolSpec::Ipv6(p) => {
                net = Some(Net::Ipv6(offset));
                set_ethertype(&mut bytes, eth_offset, ETHERTYPE_IPV6);
                ipv6::build(offset, p)
            }
            ProtocolSpec::Arp(p) => {
                set_ethertype(&mut bytes, eth_offset, ETHERTYPE_ARP);
                arp::build(offset, p)
            }
            ProtocolSpec::Tcp(p) => {
                let pseudo = transport_over(net, &mut bytes, 6, "TCP requires a preceding IP layer")?;
                tcp::build(offset, pseudo, p)
            }
            ProtocolSpec::Udp(p) => {
                let pseudo = transport_over(net, &mut bytes, 17, "UDP requires a preceding IP layer")?;
                udp::build(offset, pseudo, p)
            }
            ProtocolSpec::Icmp(p) => {
                // ICMPv4 only (protocol 1); ICMPv6 has a different number and pseudo-header.
                match net {
                    Some(Net::Ipv4(ip)) => bytes[ip + 9] = 1,
                    _ => return Err(EngineError::Assembly("ICMP requires a preceding IPv4 layer")),
                }
                icmp::build(offset, p)
            }
            ProtocolSpec::Raw(data) => raw::build(offset, data),
        };
        if matches!(spec, ProtocolSpec::Ethernet(_)) {
            eth_offset = Some(offset);
        }
        bytes.extend(chunk);
        layers.push(layer);
    }

    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(bytes));
    doc.layers = layers;
    doc.assign_missing_node_ids();
    resolve(&mut doc)?;
    Ok(doc)
}

/// Stamp a 2-byte EtherType into the Ethernet layer at `eth_offset`, if there is one.
fn set_ethertype(bytes: &mut [u8], eth_offset: Option<usize>, ethertype: u16) {
    if let Some(eth) = eth_offset {
        bytes[eth + 12..eth + 14].copy_from_slice(&ethertype.to_be_bytes());
    }
}
