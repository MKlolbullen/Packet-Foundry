//! The registry: turn an ordered stack of protocol specs into a resolved [`PacketDocument`].
//!
//! Stacking is the assembler's layout pass — each layer is appended to the buffer and its fields
//! are placed at absolute offsets. Then [`resolve`] runs the resolve pass, filling derived fields
//! (lengths, checksums) in dependency order.

use packet_core::{Layer, PacketBuffer, PacketDocument};
use serde::{Deserialize, Serialize};

use crate::eval::EngineError;
use crate::protocols::{Pseudo, arp, ethernet, icmp, icmpv6, ipv4, ipv6, raw, tcp, udp, vlan};
use crate::resolve::resolve;

/// One protocol layer to place in a packet, with its parameters. Serializes externally-tagged,
/// e.g. `{"Tcp": {"src_port": 1234, ...}}` or `{"Raw": [1, 2, 3]}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProtocolSpec {
    Ethernet(ethernet::EthernetParams),
    Vlan(vlan::VlanParams),
    Ipv4(ipv4::Ipv4Params),
    Ipv6(ipv6::Ipv6Params),
    Arp(arp::ArpParams),
    Tcp(tcp::TcpParams),
    Udp(udp::UdpParams),
    Icmp(icmp::IcmpParams),
    Icmpv6(icmpv6::Icmpv6Params),
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
            "vlan" | "dot1q" | "8021q" => Some(ProtocolSpec::Vlan(Default::default())),
            "ipv4" | "ip" => Some(ProtocolSpec::Ipv4(Default::default())),
            "ipv6" | "ip6" => Some(ProtocolSpec::Ipv6(Default::default())),
            "arp" => Some(ProtocolSpec::Arp(Default::default())),
            "tcp" => Some(ProtocolSpec::Tcp(Default::default())),
            "udp" => Some(ProtocolSpec::Udp(Default::default())),
            "icmp" => Some(ProtocolSpec::Icmp(Default::default())),
            "icmpv6" | "icmp6" => Some(ProtocolSpec::Icmpv6(Default::default())),
            "raw" | "payload" => Some(ProtocolSpec::Raw(Vec::new())),
            _ => None,
        }
    }

    /// Human-readable protocol name.
    pub fn name(&self) -> &'static str {
        match self {
            ProtocolSpec::Ethernet(_) => "ethernet",
            ProtocolSpec::Vlan(_) => "vlan",
            ProtocolSpec::Ipv4(_) => "ipv4",
            ProtocolSpec::Ipv6(_) => "ipv6",
            ProtocolSpec::Arp(_) => "arp",
            ProtocolSpec::Tcp(_) => "tcp",
            ProtocolSpec::Udp(_) => "udp",
            ProtocolSpec::Icmp(_) => "icmp",
            ProtocolSpec::Icmpv6(_) => "icmpv6",
            ProtocolSpec::Raw(_) => "raw",
        }
    }
}

/// A pinned field value the composer supplies alongside a stack: it overrides the field's bytes
/// (via the same `override_bytes` mechanism `set_field_bytes` uses), so a user-entered or
/// deliberately-invalid value wins over the assembler's auto-linking, while derived fields still
/// recompute over it. `layer_index` is the 0-based position in the stack; `field_name` is the
/// layer field name (e.g. `"EtherType"`, `"SrcPort"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldPin {
    pub layer_index: usize,
    pub field_name: String,
    pub bytes: Vec<u8>,
}

/// Assemble an ordered protocol stack into a resolved document (layout pass + resolve pass).
///
/// Layer linking is generalized two ways. The **EtherType slot** is the 2-byte field the next
/// protocol names itself in: Ethernet opens it at its own `+12`, and each 802.1Q VLAN tag both
/// stamps `0x8100` into the current slot (announcing itself) and moves the slot to its own inner
/// EtherType at `+2` — so IPv4/IPv6/ARP after any number of VLAN tags stamp the *innermost* slot,
/// and stacking two tags (QinQ) needs no special case. The **network layer** linking sets the
/// enclosing IP layer's next-protocol field (IPv4 `protocol` / IPv6 `next header`) and picks the
/// matching pseudo-header for a transport's checksum.
pub fn assemble(stack: &[ProtocolSpec]) -> Result<PacketDocument, EngineError> {
    assemble_with_pins(stack, &[])
}

/// Assemble a stack, then apply `pins` as field overrides before the resolve pass. With no pins
/// this is byte-identical to [`assemble`]. Each pin is validated against its field's range
/// ([`packet_core::BitRange::check_field_bytes`]) so a malformed pin is a clear error, not a
/// silent no-op; a pin on an auto-linked field (EtherType / IP protocol) therefore wins over the
/// linker's stamp, and derived fields (checksums, lengths) recompute over the pinned bytes.
pub fn assemble_with_pins(
    stack: &[ProtocolSpec],
    pins: &[FieldPin],
) -> Result<PacketDocument, EngineError> {
    let (bytes, layers) = layout(stack)?;
    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(bytes));
    doc.layers = layers;
    doc.assign_missing_node_ids();

    let buf_len = doc.buffer.len();
    for pin in pins {
        let layer = doc
            .layers
            .get_mut(pin.layer_index)
            .ok_or(EngineError::Assembly("pin layer index out of range"))?;
        let field = layer
            .field_mut(&pin.field_name)
            .ok_or(EngineError::Assembly("unknown pinned field"))?;
        field.range.check_field_bytes(&pin.bytes, buf_len)?;
        field.override_bytes = Some(pin.bytes.clone());
    }

    resolve(&mut doc)?;
    Ok(doc)
}

/// The layout pass: append each layer's bytes and record its `Layer`, generalizing next-protocol
/// linking (see [`assemble`]). Returns the raw buffer bytes and the layer list, before ids are
/// assigned or the resolve pass runs.
fn layout(stack: &[ProtocolSpec]) -> Result<(Vec<u8>, Vec<Layer>), EngineError> {
    let mut bytes: Vec<u8> = Vec::new();
    let mut layers = Vec::new();
    // The absolute byte offset of the 2-byte EtherType field the *next* protocol should stamp
    // itself into (Ethernet's `+12`, or the innermost VLAN tag's `+2`), if a frame opened one.
    let mut ethertype_slot: Option<usize> = None;
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
            ProtocolSpec::Ethernet(p) => {
                let built = ethernet::build(offset, p);
                ethertype_slot = Some(offset + 12);
                built
            }
            ProtocolSpec::Vlan(p) => {
                // Announce the tag in the current slot, then hand the slot to this tag's inner
                // EtherType so the next protocol (or another VLAN, for QinQ) stamps through it.
                set_ethertype_slot(&mut bytes, ethertype_slot, vlan::TPID_8021Q);
                let built = vlan::build(offset, p);
                ethertype_slot = Some(offset + 2);
                built
            }
            ProtocolSpec::Ipv4(p) => {
                net = Some(Net::Ipv4(offset));
                set_ethertype_slot(&mut bytes, ethertype_slot, ETHERTYPE_IPV4);
                ipv4::build(offset, p)
            }
            ProtocolSpec::Ipv6(p) => {
                net = Some(Net::Ipv6(offset));
                set_ethertype_slot(&mut bytes, ethertype_slot, ETHERTYPE_IPV6);
                ipv6::build(offset, p)
            }
            ProtocolSpec::Arp(p) => {
                set_ethertype_slot(&mut bytes, ethertype_slot, ETHERTYPE_ARP);
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
            ProtocolSpec::Icmpv6(p) => {
                // ICMPv6 (next-header 58) rides on IPv6 only, and its checksum needs the IPv6
                // pseudo-header — so, unlike ICMPv4, it goes through the IPv6-only path here.
                let pseudo = match net {
                    Some(Net::Ipv6(ip)) => {
                        bytes[ip + 6] = icmpv6::PROTO; // IPv6 Next Header
                        Pseudo::Ipv6 { offset: ip }
                    }
                    _ => return Err(EngineError::Assembly("ICMPv6 requires a preceding IPv6 layer")),
                };
                icmpv6::build(offset, pseudo, p)
            }
            ProtocolSpec::Raw(data) => raw::build(offset, data),
        };
        bytes.extend(chunk);
        layers.push(layer);
    }

    Ok((bytes, layers))
}

/// Stamp a 2-byte EtherType into the slot a preceding frame/tag opened, if there is one.
fn set_ethertype_slot(bytes: &mut [u8], slot: Option<usize>, ethertype: u16) {
    if let Some(at) = slot {
        bytes[at..at + 2].copy_from_slice(&ethertype.to_be_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocols::{ethernet, ipv4, tcp};

    fn eth_ipv4_tcp() -> Vec<ProtocolSpec> {
        vec![
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params { src: [1, 2, 3, 4], dst: [5, 6, 7, 8], ..Default::default() }),
            ProtocolSpec::Tcp(tcp::TcpParams { dst_port: 443, flags: tcp::flags::SYN, ..Default::default() }),
        ]
    }

    #[test]
    fn assemble_with_pins_empty_is_identical() {
        let stack = eth_ipv4_tcp();
        let plain = assemble(&stack).unwrap();
        let no_pins = assemble_with_pins(&stack, &[]).unwrap();
        assert_eq!(plain.buffer, no_pins.buffer);
        assert_eq!(plain.layers, no_pins.layers);
    }

    #[test]
    fn pinned_ethertype_overrides_autolink() {
        // Auto-linking would stamp 0x0800 into the Ethernet EtherType; a pin must win.
        let doc = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 0, field_name: "EtherType".into(), bytes: vec![0xBE, 0xEF] }],
        )
        .unwrap();
        assert_eq!(&doc.buffer.as_slice()[12..14], &[0xBE, 0xEF]);
    }

    #[test]
    fn invalid_protocol_pin_stands_and_checksums_still_resolve() {
        // Pin IPv4 Protocol to 0 under a TCP child (auto would write 6). The deliberately-wrong
        // value stands, and the IPv4/TCP checksums still resolve over it with no panic.
        let doc = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 1, field_name: "Protocol".into(), bytes: vec![0x00] }],
        )
        .unwrap();
        let proto = doc.layers[1].field("Protocol").unwrap().range;
        assert_eq!(doc.buffer.read_uint(proto).unwrap(), 0);
        // HeaderChecksum is derived and non-zero (it recomputed over the pinned protocol byte).
        let csum = doc.layers[1].field("HeaderChecksum").unwrap().range;
        assert_ne!(doc.buffer.read_uint(csum).unwrap(), 0);
    }

    #[test]
    fn pinning_an_editable_field_matches_the_param() {
        // Pinning TCP.SrcPort to 443 yields the same buffer as assembling it via the param.
        let pinned = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 2, field_name: "SrcPort".into(), bytes: vec![0x01, 0xBB] }],
        )
        .unwrap();
        let via_param = assemble(&[
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params { src: [1, 2, 3, 4], dst: [5, 6, 7, 8], ..Default::default() }),
            ProtocolSpec::Tcp(tcp::TcpParams { src_port: 443, dst_port: 443, flags: tcp::flags::SYN, ..Default::default() }),
        ])
        .unwrap();
        assert_eq!(pinned.buffer, via_param.buffer);
    }

    #[test]
    fn unknown_pin_field_is_an_error() {
        let err = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 0, field_name: "Nope".into(), bytes: vec![0x00] }],
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::Assembly(_)));
    }

    #[test]
    fn pin_layer_index_out_of_range_is_an_error() {
        let err = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 9, field_name: "EtherType".into(), bytes: vec![0x00, 0x00] }],
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::Assembly(_)));
    }
}
