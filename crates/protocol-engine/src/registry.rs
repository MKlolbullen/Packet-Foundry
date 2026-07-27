//! The registry: turn an ordered stack of protocol specs into a resolved [`PacketDocument`].
//!
//! Stacking is the assembler's layout pass — each layer is appended to the buffer and its fields
//! are placed at absolute offsets. Then [`resolve`] runs the resolve pass, filling derived fields
//! (lengths, checksums) in dependency order.

use packet_core::{PacketBuffer, PacketDocument};
use serde::{Deserialize, Serialize};

use crate::eval::EngineError;
use crate::protocols::{ethernet, icmp, ipv4, raw, tcp, udp};
use crate::resolve::resolve;

/// One protocol layer to place in a packet, with its parameters. Serializes externally-tagged,
/// e.g. `{"Tcp": {"src_port": 1234, ...}}` or `{"Raw": [1, 2, 3]}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProtocolSpec {
    Ethernet(ethernet::EthernetParams),
    Ipv4(ipv4::Ipv4Params),
    Tcp(tcp::TcpParams),
    Udp(udp::UdpParams),
    Icmp(icmp::IcmpParams),
    Raw(Vec<u8>),
}

impl ProtocolSpec {
    /// A default spec for a protocol name, or `None` if unknown.
    pub fn from_name(name: &str) -> Option<ProtocolSpec> {
        match name.to_ascii_lowercase().as_str() {
            "ethernet" | "eth" => Some(ProtocolSpec::Ethernet(Default::default())),
            "ipv4" | "ip" => Some(ProtocolSpec::Ipv4(Default::default())),
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
            ProtocolSpec::Tcp(_) => "tcp",
            ProtocolSpec::Udp(_) => "udp",
            ProtocolSpec::Icmp(_) => "icmp",
            ProtocolSpec::Raw(_) => "raw",
        }
    }
}

/// Assemble an ordered protocol stack into a resolved document (layout pass + resolve pass).
pub fn assemble(stack: &[ProtocolSpec]) -> Result<PacketDocument, EngineError> {
    let mut bytes: Vec<u8> = Vec::new();
    let mut layers = Vec::new();
    let mut ipv4_offset: Option<usize> = None;

    for spec in stack {
        let offset = bytes.len();
        let (chunk, layer) = match spec {
            ProtocolSpec::Ethernet(p) => ethernet::build(offset, p),
            ProtocolSpec::Ipv4(p) => {
                ipv4_offset = Some(offset);
                ipv4::build(offset, p)
            }
            ProtocolSpec::Tcp(p) => {
                let ip = ipv4_offset
                    .ok_or(EngineError::Assembly("TCP requires a preceding IPv4 layer"))?;
                bytes[ip + 9] = 6; // IPv4 protocol = TCP
                tcp::build(offset, ip, p)
            }
            ProtocolSpec::Udp(p) => {
                let ip = ipv4_offset
                    .ok_or(EngineError::Assembly("UDP requires a preceding IPv4 layer"))?;
                bytes[ip + 9] = 17; // IPv4 protocol = UDP
                udp::build(offset, ip, p)
            }
            ProtocolSpec::Icmp(p) => {
                let ip = ipv4_offset
                    .ok_or(EngineError::Assembly("ICMP requires a preceding IPv4 layer"))?;
                bytes[ip + 9] = 1; // IPv4 protocol = ICMP
                icmp::build(offset, p)
            }
            ProtocolSpec::Raw(data) => raw::build(offset, data),
        };
        bytes.extend(chunk);
        layers.push(layer);
    }

    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(bytes));
    doc.layers = layers;
    resolve(&mut doc)?;
    Ok(doc)
}
