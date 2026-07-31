//! The protocol catalogue: engine-owned metadata describing each built-in protocol for the visual
//! stack composer. Every descriptor is *derived* from the protocol's own `layer(0)` field layout
//! and `build(0, &Default)` header bytes — the single source of truth — plus a small classification
//! overlay (category, parent/child compatibility, and which fields are auto-linked or fixed).
//!
//! Nothing here re-declares field names, widths, kinds, or defaults: changing a `layer()` layout or
//! a `Params::default()` updates the catalogue automatically. Drift is confined to the tiny
//! `auto_linked`/`fixed` name sets and the compatibility lists, and is guarded by the tests below
//! (`catalog_fields_match_layer_layout`, `catalog_marks_roles`, `compatibility_is_symmetric`).
//!
//! This is a *different* concept from [`crate::descriptor::ProtocolDescriptor`] (the "protocols as
//! data" lowering path, which carries `DExpr` derivations and header bytes) — hence the distinct
//! name `ProtocolCatalogEntry`.

use packet_core::{BitRange, FieldKind, Layer, PacketBuffer};
use serde::{Deserialize, Serialize};

use crate::protocols::{Pseudo, arp, ethernet, icmp, icmpv6, ipv4, ipv6, tcp, udp, vlan};

/// Where a protocol sits in the stack, for palette grouping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolCategory {
    Link,
    Network,
    Transport,
    Application,
    Payload,
}

/// How a field participates in the composer's form.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParameterRole {
    /// A normal user-entered value.
    Editable,
    /// Computed by the resolve pass (checksums, lengths) — read-only.
    Derived,
    /// Populated by the assembler's layer linking (EtherType / IP protocol / next header). The
    /// composer offers Auto (default) / Pinned / Deliberately-invalid over it.
    AutoLinked,
    /// A protocol constant that isn't a parameter (IP Version, ARP hardware/protocol type) —
    /// read-only.
    Fixed,
}

/// One editable/derived field of a protocol, derived from its `layer(0)` layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParameterDescriptor {
    /// The layer field name, e.g. `"SrcPort"` — the key a `FieldPin` uses.
    pub name: String,
    pub kind: FieldKind,
    /// Bit offset relative to the layer start.
    pub offset_bits: usize,
    pub width_bits: usize,
    /// The field's default bytes, read out of `build(0, &Default)` — raw bytes for byte-aligned
    /// fields, or the value packed right-aligned into `ceil(width/8)` bytes for sub-byte fields
    /// (the same encoding `override_bytes`/`FieldPin` uses).
    pub default: Vec<u8>,
    pub role: ParameterRole,
}

/// A protocol the composer can place, with its parameters and compatibility.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolCatalogEntry {
    /// Matches [`crate::ProtocolSpec::from_name`] / `.name()`.
    pub id: String,
    /// Human-readable name (the layer's own name).
    pub display_name: String,
    pub category: ProtocolCategory,
    pub allowed_parents: Vec<String>,
    pub allowed_children: Vec<String>,
    pub fields: Vec<ParameterDescriptor>,
}

/// The full catalogue — one entry per `ProtocolSpec::from_name` id.
pub fn catalog() -> Vec<ProtocolCatalogEntry> {
    // A dummy pseudo-header for transport `layer`/`build`: their only pseudo-dependent field is the
    // derived Checksum, whose default is ignored (role Derived), so the offset is irrelevant here.
    use ParameterRole::{AutoLinked, Fixed};
    let p = Pseudo::Ipv4 { offset: 0 };
    vec![
        describe(
            Meta {
                id: "ethernet",
                category: ProtocolCategory::Link,
                parents: &[],
                children: &["ipv4", "ipv6", "arp", "vlan"],
                roles: &[("EtherType", AutoLinked)],
            },
            &ethernet::layer(0),
            &ethernet::build(0, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "vlan",
                category: ProtocolCategory::Link,
                parents: &["ethernet", "vlan"],
                children: &["ipv4", "ipv6", "arp", "vlan"],
                roles: &[("EtherType", AutoLinked)],
            },
            &vlan::layer(0),
            &vlan::build(0, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "ipv4",
                category: ProtocolCategory::Network,
                parents: &["ethernet", "vlan"],
                children: &["tcp", "udp", "icmp"],
                roles: &[("Protocol", AutoLinked), ("Version", Fixed), ("IHL", Fixed)],
            },
            &ipv4::layer(0),
            &ipv4::build(0, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "ipv6",
                category: ProtocolCategory::Network,
                parents: &["ethernet", "vlan"],
                children: &["tcp", "udp", "icmpv6"],
                roles: &[("NextHeader", AutoLinked), ("Version", Fixed)],
            },
            &ipv6::layer(0),
            &ipv6::build(0, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "arp",
                category: ProtocolCategory::Network,
                parents: &["ethernet", "vlan"],
                children: &[],
                roles: &[
                    ("HardwareType", Fixed),
                    ("ProtocolType", Fixed),
                    ("HardwareLen", Fixed),
                    ("ProtocolLen", Fixed),
                ],
            },
            &arp::layer(0),
            &arp::build(0, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "tcp",
                category: ProtocolCategory::Transport,
                parents: &["ipv4", "ipv6"],
                children: &["raw"],
                roles: &[("DataOffset", Fixed)],
            },
            &tcp::layer(0, p),
            &tcp::build(0, p, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "udp",
                category: ProtocolCategory::Transport,
                parents: &["ipv4", "ipv6"],
                children: &["raw"],
                roles: &[],
            },
            &udp::layer(0, p),
            &udp::build(0, p, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "icmp",
                category: ProtocolCategory::Transport,
                parents: &["ipv4"],
                children: &["raw"],
                roles: &[],
            },
            &icmp::layer(0),
            &icmp::build(0, &Default::default()).0,
        ),
        describe(
            Meta {
                id: "icmpv6",
                category: ProtocolCategory::Transport,
                parents: &["ipv6"],
                children: &["raw"],
                roles: &[],
            },
            &icmpv6::layer(0, p),
            &icmpv6::build(0, p, &Default::default()).0,
        ),
        raw_entry(),
    ]
}

/// A protocol's identity and compatibility — the small hand-written overlay that `describe`
/// combines with the derived field layout.
struct Meta<'a> {
    id: &'a str,
    category: ProtocolCategory,
    parents: &'a [&'a str],
    children: &'a [&'a str],
    /// Per-field role overrides by field name (auto-linked / fixed); derived fields are detected
    /// from the layout itself and always win over this list.
    roles: &'a [(&'a str, ParameterRole)],
}

/// Build a catalogue entry from a protocol's `layer(0)` layout and default header bytes.
fn describe(meta: Meta, layer: &Layer, header: &[u8]) -> ProtocolCatalogEntry {
    let buf = PacketBuffer::from_bytes(header.to_vec());
    let fields = layer
        .fields
        .iter()
        .map(|f| {
            let role = if f.derivation.is_some() {
                ParameterRole::Derived
            } else {
                meta.roles
                    .iter()
                    .find(|(name, _)| *name == f.name)
                    .map(|(_, role)| *role)
                    .unwrap_or(ParameterRole::Editable)
            };
            ParameterDescriptor {
                name: f.name.clone(),
                kind: f.kind,
                // The layer is placed at offset 0, so absolute ranges are already layer-relative.
                offset_bits: f.range.start_bit,
                width_bits: f.range.len_bits,
                default: default_bytes(&buf, f.range),
                role,
            }
        })
        .collect();
    ProtocolCatalogEntry {
        id: meta.id.to_string(),
        display_name: layer.name.clone(),
        category: meta.category,
        allowed_parents: meta.parents.iter().map(|s| s.to_string()).collect(),
        allowed_children: meta.children.iter().map(|s| s.to_string()).collect(),
        fields,
    }
}

/// Read a field's default bytes from the default header, matching the `override_bytes`/`FieldPin`
/// encoding: raw bytes for byte-aligned ranges, value packed right-aligned into `ceil(width/8)`
/// bytes for sub-byte ranges.
fn default_bytes(buf: &PacketBuffer, range: BitRange) -> Vec<u8> {
    if range.start_bit % 8 == 0 && range.len_bits % 8 == 0 {
        buf.read_bytes(range).unwrap_or_default()
    } else {
        let value = buf.read_uint(range).unwrap_or(0);
        let nbytes = range.len_bits.div_ceil(8);
        (0..nbytes).rev().map(|i| (value >> (i * 8)) as u8).collect()
    }
}

/// The `Raw` payload has no `layer(0)`/param struct — its value lives in `ProtocolSpec::Raw(bytes)`
/// itself, not a pin. Describe it by hand as a single variable-length editable byte field.
fn raw_entry() -> ProtocolCatalogEntry {
    ProtocolCatalogEntry {
        id: "raw".to_string(),
        display_name: "Payload".to_string(),
        category: ProtocolCategory::Payload,
        allowed_parents: ["tcp", "udp", "icmp", "icmpv6"].iter().map(|s| s.to_string()).collect(),
        allowed_children: vec![],
        fields: vec![ParameterDescriptor {
            name: "Data".to_string(),
            kind: FieldKind::Bytes,
            offset_bits: 0,
            width_bits: 0, // variable
            default: vec![],
            role: ParameterRole::Editable,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ProtocolSpec;

    fn entry(id: &str) -> ProtocolCatalogEntry {
        catalog().into_iter().find(|e| e.id == id).unwrap_or_else(|| panic!("no entry {id}"))
    }

    #[test]
    fn catalog_covers_every_protocol() {
        let cat = catalog();
        // Every catalogue id round-trips through from_name, and ids are unique.
        for e in &cat {
            assert!(ProtocolSpec::from_name(&e.id).is_some(), "unknown id {}", e.id);
        }
        let mut ids: Vec<&str> = cat.iter().map(|e| e.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), cat.len(), "duplicate ids in catalogue");
        // The protocols a user can name all appear.
        for id in ["ethernet", "vlan", "ipv4", "ipv6", "arp", "tcp", "udp", "icmp", "icmpv6", "raw"] {
            assert!(cat.iter().any(|e| e.id == id), "missing {id}");
        }
    }

    #[test]
    fn catalog_fields_match_layer_layout() {
        // The drift guard: each descriptor equals its own layer(0) field-for-field.
        let p = Pseudo::Ipv4 { offset: 0 };
        let cases: &[(&str, Layer)] = &[
            ("ethernet", ethernet::layer(0)),
            ("vlan", vlan::layer(0)),
            ("ipv4", ipv4::layer(0)),
            ("ipv6", ipv6::layer(0)),
            ("arp", arp::layer(0)),
            ("tcp", tcp::layer(0, p)),
            ("udp", udp::layer(0, p)),
            ("icmp", icmp::layer(0)),
            ("icmpv6", icmpv6::layer(0, p)),
        ];
        for (id, layer) in cases {
            let e = entry(id);
            assert_eq!(e.display_name, layer.name, "{id} display name");
            assert_eq!(e.fields.len(), layer.fields.len(), "{id} field count");
            for (d, f) in e.fields.iter().zip(&layer.fields) {
                assert_eq!(d.name, f.name, "{id} field name");
                assert_eq!(d.kind, f.kind, "{id} {} kind", f.name);
                assert_eq!(d.offset_bits, f.range.start_bit, "{id} {} offset", f.name);
                assert_eq!(d.width_bits, f.range.len_bits, "{id} {} width", f.name);
            }
        }
    }

    #[test]
    fn catalog_marks_roles() {
        // Derived iff the layer field carries a derivation.
        assert_eq!(role("ipv4", "HeaderChecksum"), ParameterRole::Derived);
        assert_eq!(role("ipv4", "TotalLength"), ParameterRole::Derived);
        assert_eq!(role("tcp", "Checksum"), ParameterRole::Derived);
        assert_eq!(role("udp", "Length"), ParameterRole::Derived);
        // Auto-linked next-protocol fields.
        assert_eq!(role("ethernet", "EtherType"), ParameterRole::AutoLinked);
        assert_eq!(role("vlan", "EtherType"), ParameterRole::AutoLinked);
        assert_eq!(role("ipv4", "Protocol"), ParameterRole::AutoLinked);
        assert_eq!(role("ipv6", "NextHeader"), ParameterRole::AutoLinked);
        // Fixed protocol constants.
        assert_eq!(role("ipv4", "Version"), ParameterRole::Fixed);
        assert_eq!(role("tcp", "DataOffset"), ParameterRole::Fixed);
        // Ordinary editable fields.
        assert_eq!(role("tcp", "SrcPort"), ParameterRole::Editable);
        assert_eq!(role("ipv4", "TTL"), ParameterRole::Editable);
    }

    fn role(id: &str, field: &str) -> ParameterRole {
        entry(id).fields.into_iter().find(|f| f.name == field).unwrap().role
    }

    #[test]
    fn catalog_defaults_match_build() {
        // Byte-aligned default read straight from the default header.
        assert_eq!(default("ethernet", "EtherType"), vec![0x08, 0x00]);
        assert_eq!(default("ipv4", "TTL"), vec![64]);
        assert_eq!(default("ipv6", "NextHeader"), vec![6]);
        // Sub-byte default packed right-aligned into one byte.
        assert_eq!(default("ipv4", "Version"), vec![4]);
        assert_eq!(default("tcp", "DataOffset"), vec![5]);
    }

    fn default(id: &str, field: &str) -> Vec<u8> {
        entry(id).fields.into_iter().find(|f| f.name == field).unwrap().default
    }

    #[test]
    fn compatibility_is_symmetric() {
        // Every declared child lists its parent, and vice versa — one relationship, two lists.
        let cat = catalog();
        let find = |id: &str| cat.iter().find(|e| e.id == id).cloned().unwrap();
        for e in &cat {
            for child in &e.allowed_children {
                let c = find(child);
                assert!(
                    c.allowed_parents.contains(&e.id),
                    "{} allows child {} but {} does not list {} as a parent",
                    e.id, child, child, e.id
                );
            }
            for parent in &e.allowed_parents {
                let pa = find(parent);
                assert!(
                    pa.allowed_children.contains(&e.id),
                    "{} allows parent {} but {} does not list {} as a child",
                    e.id, parent, parent, e.id
                );
            }
        }
    }
}
