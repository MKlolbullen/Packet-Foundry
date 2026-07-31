//! The reverse of [`assemble`](crate::assemble): take raw captured bytes and dissect them into a
//! [`PacketDocument`] of layers and fields — the "load an unknown blob and analyze it" path.
//!
//! Dissection reuses the exact `layer(offset[, ipv4_offset])` layouts the assembler's builders
//! use, so a round-trip (assemble → bytes → dissect) reproduces the same field structure by
//! construction. Bytes are authoritative — we run [`validate`] (which only *reports* problems:
//! truncation, out-of-bounds fields, checksum/length mismatches) rather than [`resolve`], so a
//! real capture is never rewritten.
//!
//! The walk never panics: every multi-byte read is gated on the slice length first, and the
//! `layer()` layouts only build bit-ranges (they never read the buffer), so a truncated packet
//! yields whatever fields fit plus diagnostics, not a crash.
//!
//! Scope (this pass): an Ethernet II frame carrying IPv4 carrying TCP/UDP/ICMP, with unrecognized
//! ethertypes/protocols and trailing/leftover bytes captured as opaque `Raw` regions. Variable
//! header lengths (IPv4 IHL, TCP Data Offset) are read to advance correctly; the extra options
//! bytes become their own `Raw` gap layer.

use packet_core::{Layer, PacketBuffer, PacketDocument};

use crate::protocols::{Pseudo, arp, ethernet, icmp, ipv4, ipv6, raw, tcp, udp};
use crate::resolve::validate;

const ETH_LEN: usize = ethernet::LEN;
const IPV4_MIN: usize = ipv4::LEN;
const IPV6_LEN: usize = ipv6::LEN;
const ARP_LEN: usize = arp::LEN;
const TCP_MIN: usize = tcp::LEN;
const UDP_LEN: usize = udp::LEN;
const ICMP_LEN: usize = icmp::LEN;

const ETHERTYPE_IPV4: u16 = 0x0800;
const ETHERTYPE_IPV6: u16 = 0x86DD;
const ETHERTYPE_ARP: u16 = 0x0806;
const IP_PROTO_ICMP: u8 = 1;
const IP_PROTO_TCP: u8 = 6;
const IP_PROTO_UDP: u8 = 17;

/// Dissect a raw byte slice (assumed to start at an Ethernet II frame) into a document. Never
/// errors — malformed or truncated input surfaces as `Raw` regions plus diagnostics.
pub fn dissect(bytes: &[u8]) -> PacketDocument {
    let mut layers = Vec::new();
    dissect_ethernet(bytes, &mut layers);

    let mut doc = PacketDocument::with_buffer(PacketBuffer::from_bytes(bytes.to_vec()));
    doc.layers = layers;
    doc.assign_missing_node_ids();
    doc.diagnostics = validate(&doc);
    doc
}

/// Wrap `[off, bytes.len())` as an opaque layer named `name`, if there's anything there.
fn push_raw(bytes: &[u8], off: usize, name: &str, layers: &mut Vec<Layer>) {
    if off < bytes.len() {
        layers.push(raw::layer(off, bytes.len() - off, name));
    }
}

fn dissect_ethernet(bytes: &[u8], layers: &mut Vec<Layer>) {
    if bytes.len() < ETH_LEN {
        // Not even a full Ethernet header — hand the whole thing back as opaque bytes.
        push_raw(bytes, 0, "Unknown", layers);
        return;
    }
    layers.push(ethernet::layer(0));
    let ethertype = u16::from_be_bytes([bytes[12], bytes[13]]);
    match ethertype {
        ETHERTYPE_IPV4 => dissect_ipv4(bytes, ETH_LEN, layers),
        ETHERTYPE_IPV6 => dissect_ipv6(bytes, ETH_LEN, layers),
        ETHERTYPE_ARP => {
            // ARP is a leaf (no encapsulated payload); trailing padding, if any, is Raw.
            layers.push(arp::layer(ETH_LEN));
            push_raw(bytes, ETH_LEN + ARP_LEN, "Payload", layers);
        }
        _ => push_raw(bytes, ETH_LEN, "Unknown", layers),
    }
}

fn dissect_ipv4(bytes: &[u8], off: usize, layers: &mut Vec<Layer>) {
    // Always emit the fixed 20-byte IPv4 layout; if the header is truncated, `validate` flags the
    // out-of-bounds fields rather than us hiding the problem.
    layers.push(ipv4::layer(off));
    if bytes.len() < off + IPV4_MIN {
        return; // can't read IHL/protocol safely — stop here, truncation is reported by validate
    }
    let ihl = (bytes[off] & 0x0F) as usize;
    // Clamp to the fixed layout we just emitted so a malformed IHL < 5 can't push the transport
    // layer back inside the header we already placed.
    let hdr = (ihl * 4).max(IPV4_MIN);
    if hdr > IPV4_MIN {
        let opt_end = (off + hdr).min(bytes.len());
        if opt_end > off + IPV4_MIN {
            layers.push(raw::layer(off + IPV4_MIN, opt_end - (off + IPV4_MIN), "IPv4 Options"));
        }
    }
    let proto = bytes[off + 9];
    dissect_transport(bytes, off + hdr, Pseudo::Ipv4 { offset: off }, proto, layers);
}

fn dissect_ipv6(bytes: &[u8], off: usize, layers: &mut Vec<Layer>) {
    // Fixed 40-byte header (no extension headers this pass). Emit it regardless; validate flags a
    // truncated header, and an extension-header chain would surface as an unexpected Next Header.
    layers.push(ipv6::layer(off));
    if bytes.len() < off + IPV6_LEN {
        return;
    }
    let next_header = bytes[off + 6];
    // TCP/UDP chain with the IPv6 pseudo-header; everything else (including ICMPv6, 58) is opaque
    // for now — ICMPv6's own pseudo-header checksum is a follow-up.
    match next_header {
        IP_PROTO_TCP | IP_PROTO_UDP => {
            dissect_transport(bytes, off + IPV6_LEN, Pseudo::Ipv6 { offset: off }, next_header, layers)
        }
        _ => push_raw(bytes, off + IPV6_LEN, "Payload", layers),
    }
}

fn dissect_transport(bytes: &[u8], off: usize, pseudo: Pseudo, proto: u8, layers: &mut Vec<Layer>) {
    match proto {
        IP_PROTO_TCP => {
            layers.push(tcp::layer(off, pseudo));
            if bytes.len() < off + TCP_MIN {
                return;
            }
            let data_offset = (bytes[off + 12] >> 4) as usize;
            let hdr = (data_offset * 4).max(TCP_MIN);
            if hdr > TCP_MIN {
                let opt_end = (off + hdr).min(bytes.len());
                if opt_end > off + TCP_MIN {
                    layers.push(raw::layer(off + TCP_MIN, opt_end - (off + TCP_MIN), "TCP Options"));
                }
            }
            push_raw(bytes, off + hdr, "Payload", layers);
        }
        IP_PROTO_UDP => {
            layers.push(udp::layer(off, pseudo));
            if bytes.len() < off + UDP_LEN {
                return;
            }
            push_raw(bytes, off + UDP_LEN, "Payload", layers);
        }
        IP_PROTO_ICMP => {
            layers.push(icmp::layer(off));
            if bytes.len() < off + ICMP_LEN {
                return;
            }
            push_raw(bytes, off + ICMP_LEN, "Payload", layers);
        }
        _ => push_raw(bytes, off, "Unknown", layers),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocols::tcp::flags;
    use crate::registry::{ProtocolSpec, assemble};
    use crate::protocols::{ethernet, ipv4, tcp};
    use packet_core::BitRange;

    fn syn_bytes() -> Vec<u8> {
        let doc = assemble(&[
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params {
                src: [192, 168, 1, 10],
                dst: [192, 168, 1, 20],
                ..Default::default()
            }),
            ProtocolSpec::Tcp(tcp::TcpParams {
                dst_port: 443,
                flags: flags::SYN,
                ..Default::default()
            }),
        ])
        .unwrap();
        doc.buffer.as_slice().to_vec()
    }

    #[test]
    fn round_trips_an_assembled_syn_field_for_field() {
        let assembled = assemble(&[
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params { src: [1, 2, 3, 4], dst: [5, 6, 7, 8], ..Default::default() }),
            ProtocolSpec::Tcp(tcp::TcpParams { dst_port: 443, flags: flags::SYN, ..Default::default() }),
        ])
        .unwrap();

        let dissected = dissect(assembled.buffer.as_slice());

        // Same layer structure: names and ranges match one-for-one.
        assert_eq!(dissected.layers.len(), assembled.layers.len());
        for (d, a) in dissected.layers.iter().zip(&assembled.layers) {
            assert_eq!(d.name, a.name);
            assert_eq!(d.range, a.range);
            assert_eq!(d.fields.len(), a.fields.len());
            for (df, af) in d.fields.iter().zip(&a.fields) {
                assert_eq!(df.name, af.name);
                assert_eq!(df.range, af.range);
            }
        }
        // A clean, minimal frame (IHL 5, DataOffset 5, no trailer) validates with no complaints.
        assert!(dissected.diagnostics.is_empty(), "unexpected diagnostics: {:?}", dissected.diagnostics);
    }

    #[test]
    fn dissects_a_syn_into_eth_ipv4_tcp() {
        let doc = dissect(&syn_bytes());
        let names: Vec<&str> = doc.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Ethernet II", "IPv4", "TCP"]);

        // Spot-check decoded values straight from the buffer via the dissected field ranges.
        let ethertype = doc.layers[0].field("EtherType").unwrap().range;
        assert_eq!(doc.buffer.read_uint(ethertype).unwrap(), 0x0800);
        let proto = doc.layers[1].field("Protocol").unwrap().range;
        assert_eq!(doc.buffer.read_uint(proto).unwrap(), 6);
        let dst_port = doc.layers[2].field("DstPort").unwrap().range;
        assert_eq!(doc.buffer.read_uint(dst_port).unwrap(), 443);
    }

    #[test]
    fn trailing_payload_becomes_a_raw_layer() {
        let mut bytes = syn_bytes();
        bytes.extend_from_slice(b"hello");
        let doc = dissect(&bytes);
        let names: Vec<&str> = doc.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Ethernet II", "IPv4", "TCP", "Payload"]);
        let payload = doc.layers[3].range;
        assert_eq!(payload, BitRange::bytes(54, 5));
    }

    #[test]
    fn truncated_frame_flags_diagnostics_without_panic() {
        let bytes = &syn_bytes()[..30]; // cut off mid-IPv4 header
        let doc = dissect(bytes);
        assert!(
            doc.diagnostics
                .iter()
                .any(|d| d.code == "field.out_of_bounds" || d.code == "layer.truncated"),
            "expected a truncation diagnostic, got {:?}",
            doc.diagnostics
        );
    }

    #[test]
    fn unknown_ethertype_yields_ethernet_plus_raw() {
        // A valid Ethernet header with an ethertype we don't dissect (0x88CC, LLDP).
        let mut bytes = vec![0u8; ETH_LEN];
        bytes[12] = 0x88;
        bytes[13] = 0xCC;
        bytes.extend_from_slice(&[0xAA; 8]);
        let doc = dissect(&bytes);
        let names: Vec<&str> = doc.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Ethernet II", "Unknown"]);
    }

    #[test]
    fn ipv4_options_become_a_gap_layer() {
        // Hand-build Ethernet + IPv4 with IHL=6 (24-byte header, 4 option bytes) + 8 ICMP bytes.
        let mut bytes = vec![0u8; ETH_LEN];
        bytes[12] = 0x08; // ethertype IPv4
        let ip_start = bytes.len();
        let mut ip = vec![0u8; 24];
        ip[0] = 0x46; // Version 4, IHL 6
        ip[9] = IP_PROTO_ICMP;
        bytes.extend_from_slice(&ip);
        bytes.extend_from_slice(&[0u8; ICMP_LEN]);

        let doc = dissect(&bytes);
        let names: Vec<&str> = doc.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Ethernet II", "IPv4", "IPv4 Options", "ICMP"]);
        // Options gap sits between the fixed 20-byte header and the 24-byte real header.
        assert_eq!(doc.layers[2].range, BitRange::bytes(ip_start + IPV4_MIN, 4));
        // ICMP begins after the full 24-byte IPv4 header.
        assert_eq!(doc.layers[3].range.start_bit, (ip_start + 24) * 8);
    }

    #[test]
    fn udp_is_dissected() {
        let doc = assemble(&[
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params { protocol: IP_PROTO_UDP, ..Default::default() }),
            ProtocolSpec::Udp(crate::protocols::udp::UdpParams { dst_port: 53, ..Default::default() }),
        ])
        .unwrap();
        let out = dissect(doc.buffer.as_slice());
        let names: Vec<&str> = out.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Ethernet II", "IPv4", "UDP"]);
    }

    #[test]
    fn round_trips_an_assembled_arp_request() {
        use crate::protocols::arp;
        let assembled = assemble(&[
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Arp(arp::ArpParams {
                sender_ip: [192, 168, 1, 1],
                target_ip: [192, 168, 1, 2],
                ..Default::default()
            }),
        ])
        .unwrap();
        // The assembler stamped the ARP ethertype into the Ethernet frame.
        let ethertype = assembled.layers[0].field("EtherType").unwrap().range;
        assert_eq!(assembled.buffer.read_uint(ethertype).unwrap(), 0x0806);

        let dissected = dissect(assembled.buffer.as_slice());
        let names: Vec<&str> = dissected.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Ethernet II", "ARP"]);
        assert!(dissected.diagnostics.is_empty(), "unexpected diagnostics: {:?}", dissected.diagnostics);
        let oper = dissected.layers[1].field("Operation").unwrap().range;
        assert_eq!(dissected.buffer.read_uint(oper).unwrap(), 1);
    }

    #[test]
    fn round_trips_ipv6_tcp_with_v6_pseudo_header_checksum() {
        use crate::protocols::{ipv6, tcp};
        let assembled = assemble(&[
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv6(ipv6::Ipv6Params {
                src: [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
                dst: [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
                ..Default::default()
            }),
            ProtocolSpec::Tcp(tcp::TcpParams { dst_port: 443, flags: flags::SYN, ..Default::default() }),
        ])
        .unwrap();
        // The assembler stamped the IPv6 ethertype and set IPv6 Next Header = TCP (6).
        let ethertype = assembled.layers[0].field("EtherType").unwrap().range;
        assert_eq!(assembled.buffer.read_uint(ethertype).unwrap(), 0x86DD);
        // A clean assemble validates cleanly — including the IPv6 pseudo-header TCP checksum.
        assert!(assembled.diagnostics.is_empty(), "assemble diagnostics: {:?}", assembled.diagnostics);

        let dissected = dissect(assembled.buffer.as_slice());
        assert_eq!(dissected.layers.len(), assembled.layers.len());
        for (d, a) in dissected.layers.iter().zip(&assembled.layers) {
            assert_eq!(d.name, a.name);
            assert_eq!(d.range, a.range);
            for (df, af) in d.fields.iter().zip(&a.fields) {
                assert_eq!(df.name, af.name);
                assert_eq!(df.range, af.range);
            }
        }
        let names: Vec<&str> = dissected.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Ethernet II", "IPv6", "TCP"]);
        // Dissection reuses the same IPv6 pseudo-header derivation, so the captured checksum still
        // validates — no mismatch.
        assert!(dissected.diagnostics.is_empty(), "dissect diagnostics: {:?}", dissected.diagnostics);
    }
}
