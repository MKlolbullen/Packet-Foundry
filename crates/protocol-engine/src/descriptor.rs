//! Declarative protocol descriptors — protocols as data.
//!
//! A [`ProtocolDescriptor`] is the *source* form of a protocol: fields with **relative** offsets
//! and derivations written against **symbolic labels** ([`DExpr`]) like "this layer's header",
//! "IPv4.SrcAddr", or "length to end". [`lower`] is the *linker*: given a layout context (this
//! layer's absolute offset and the layers already placed), it resolves every label into the
//! absolute-offset [`Operation`] IR the hand-written builders emit — so a descriptor and a Rust
//! builder produce byte-identical output.

use packet_core::{BitRange, CoreError, Field, FieldKind, Layer, NodeId, Operation};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// A symbolic derivation expression. Lowered to a concrete [`Operation`] against a layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DExpr {
    /// Fixed bytes.
    Const(Vec<u8>),
    /// This layer's whole header (offset .. offset + header_len).
    ThisLayer,
    /// This layer's start to the end of the buffer.
    ToEnd,
    /// Byte count from this layer's start to the end of the buffer, as `width` big-endian bytes.
    LengthToEnd { width: usize },
    /// A named field within this layer.
    Field(String),
    /// A named field in another (already-placed) layer, e.g. `("IPv4", "SrcAddr")`.
    LayerField(String, String),
    /// The internet checksum over the concatenated parts.
    Checksum(Vec<DExpr>),
    /// Concatenation of parts.
    Concat(Vec<DExpr>),
}

/// A single field in a protocol descriptor. Offsets are **relative to the layer start**.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldDescriptor {
    pub name: String,
    pub offset_bits: usize,
    pub width_bits: usize,
    pub kind: FieldKind,
    /// Default value written into the header at build time (big-endian). Absent ⇒ zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Vec<u8>>,
    /// Symbolic derivation, lowered by [`lower`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derivation: Option<DExpr>,
}

/// A protocol definition as data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolDescriptor {
    pub name: String,
    pub header_len: usize,
    pub fields: Vec<FieldDescriptor>,
}

impl ProtocolDescriptor {
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}

/// Errors from lowering a descriptor (the linking step).
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DescriptorError {
    #[error("referenced layer `{layer}` has not been placed")]
    LayerNotFound { layer: String },
    #[error("layer `{layer}` has no field `{field}`")]
    UnknownField { layer: String, field: String },
    #[error("field `{field}` referenced before definition")]
    UnknownLocalField { field: String },
    #[error("writing default: {0}")]
    Core(#[from] CoreError),
}

/// Context for lowering: where this layer sits and which layers precede it.
pub struct LayoutContext<'a> {
    /// Absolute byte offset of the layer being lowered.
    pub offset: usize,
    /// Layers already placed (for cross-layer references).
    pub placed: &'a [Layer],
}

impl LayoutContext<'_> {
    fn resolve_layer_field(&self, layer: &str, field: &str) -> Result<BitRange, DescriptorError> {
        let l = self
            .placed
            .iter()
            .find(|l| l.name == layer)
            .ok_or_else(|| DescriptorError::LayerNotFound { layer: layer.to_string() })?;
        l.field(field)
            .map(|f| f.range)
            .ok_or_else(|| DescriptorError::UnknownField {
                layer: layer.to_string(),
                field: field.to_string(),
            })
    }
}

/// Lower a descriptor into concrete header bytes and a [`Layer`] with absolute ranges and
/// resolved [`Operation`] derivations.
pub fn lower(
    desc: &ProtocolDescriptor,
    ctx: &LayoutContext,
) -> Result<(Vec<u8>, Layer), DescriptorError> {
    let mut header = vec![0u8; desc.header_len];
    let mut fields = Vec::with_capacity(desc.fields.len());

    for fd in &desc.fields {
        let rel = BitRange::new(fd.offset_bits, fd.width_bits);
        if let Some(default) = &fd.default {
            write_default(&mut header, rel, default)?;
        }
        let abs = BitRange::new(ctx.offset * 8 + fd.offset_bits, fd.width_bits);
        let derivation = match &fd.derivation {
            Some(expr) => Some(lower_expr(expr, desc, ctx)?),
            None => None,
        };
        fields.push(Field {
            id: NodeId::default(),
            name: fd.name.clone(),
            range: abs,
            kind: fd.kind,
            derivation,
            override_bytes: None,
        });
    }

    let layer = Layer::new(desc.name.clone(), BitRange::bytes(ctx.offset, desc.header_len), fields);
    Ok((header, layer))
}

/// Resolve one symbolic expression into a concrete operation.
fn lower_expr(
    expr: &DExpr,
    desc: &ProtocolDescriptor,
    ctx: &LayoutContext,
) -> Result<Operation, DescriptorError> {
    Ok(match expr {
        DExpr::Const(bytes) => Operation::Const(bytes.clone()),
        DExpr::ThisLayer => Operation::ReadRange(BitRange::bytes(ctx.offset, desc.header_len)),
        DExpr::ToEnd => Operation::ReadFrom { from_byte: ctx.offset },
        DExpr::LengthToEnd { width } => Operation::ByteLength { from_byte: ctx.offset, width: *width },
        DExpr::Field(name) => {
            let fd = desc
                .fields
                .iter()
                .find(|f| &f.name == name)
                .ok_or_else(|| DescriptorError::UnknownLocalField { field: name.clone() })?;
            Operation::ReadRange(BitRange::new(ctx.offset * 8 + fd.offset_bits, fd.width_bits))
        }
        DExpr::LayerField(layer, field) => {
            Operation::ReadRange(ctx.resolve_layer_field(layer, field)?)
        }
        DExpr::Checksum(parts) => Operation::internet_checksum(lower_all(parts, desc, ctx)?),
        DExpr::Concat(parts) => Operation::Concat(lower_all(parts, desc, ctx)?),
    })
}

fn lower_all(
    parts: &[DExpr],
    desc: &ProtocolDescriptor,
    ctx: &LayoutContext,
) -> Result<Vec<Operation>, DescriptorError> {
    parts.iter().map(|p| lower_expr(p, desc, ctx)).collect()
}

/// Write a field's big-endian default into the header, byte-aligned or bit-packed.
fn write_default(header: &mut [u8], rel: BitRange, default: &[u8]) -> Result<(), DescriptorError> {
    if rel.start_bit % 8 == 0 && rel.len_bits % 8 == 0 && default.len() * 8 == rel.len_bits {
        rel.write_bytes(header, default)?;
    } else {
        let mut value = 0u64;
        for &b in default {
            value = (value << 8) | u64::from(b);
        }
        rel.write_uint(header, value)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocols::{ipv4, tcp};

    const IPV4_JSON: &str = r#"{
      "name": "IPv4",
      "header_len": 20,
      "fields": [
        {"name": "Version", "offset_bits": 0, "width_bits": 4, "kind": "uint", "default": [4]},
        {"name": "IHL", "offset_bits": 4, "width_bits": 4, "kind": "uint", "default": [5]},
        {"name": "DSCP_ECN", "offset_bits": 8, "width_bits": 8, "kind": "uint"},
        {"name": "TotalLength", "offset_bits": 16, "width_bits": 16, "kind": "uint",
         "derivation": {"LengthToEnd": {"width": 2}}},
        {"name": "Identification", "offset_bits": 32, "width_bits": 16, "kind": "uint"},
        {"name": "FlagsFragment", "offset_bits": 48, "width_bits": 16, "kind": "flags", "default": [64, 0]},
        {"name": "TTL", "offset_bits": 64, "width_bits": 8, "kind": "uint", "default": [64]},
        {"name": "Protocol", "offset_bits": 72, "width_bits": 8, "kind": "uint", "default": [6]},
        {"name": "HeaderChecksum", "offset_bits": 80, "width_bits": 16, "kind": "uint",
         "derivation": {"Checksum": ["ThisLayer"]}},
        {"name": "SrcAddr", "offset_bits": 96, "width_bits": 32, "kind": "ipv4_addr"},
        {"name": "DstAddr", "offset_bits": 128, "width_bits": 32, "kind": "ipv4_addr"}
      ]
    }"#;

    const TCP_JSON: &str = r#"{
      "name": "TCP",
      "header_len": 20,
      "fields": [
        {"name": "SrcPort", "offset_bits": 0, "width_bits": 16, "kind": "uint"},
        {"name": "DstPort", "offset_bits": 16, "width_bits": 16, "kind": "uint"},
        {"name": "SeqNum", "offset_bits": 32, "width_bits": 32, "kind": "uint"},
        {"name": "AckNum", "offset_bits": 64, "width_bits": 32, "kind": "uint"},
        {"name": "DataOffset", "offset_bits": 96, "width_bits": 4, "kind": "uint", "default": [5]},
        {"name": "Flags", "offset_bits": 104, "width_bits": 8, "kind": "flags", "default": [2]},
        {"name": "Window", "offset_bits": 112, "width_bits": 16, "kind": "uint", "default": [255, 255]},
        {"name": "Checksum", "offset_bits": 128, "width_bits": 16, "kind": "uint",
         "derivation": {"Checksum": [
           {"LayerField": ["IPv4", "SrcAddr"]},
           {"LayerField": ["IPv4", "DstAddr"]},
           {"Const": [0, 6]},
           {"LengthToEnd": {"width": 2}},
           "ToEnd"
         ]}},
        {"name": "UrgentPtr", "offset_bits": 144, "width_bits": 16, "kind": "uint"}
      ]
    }"#;

    #[test]
    fn ipv4_descriptor_lowers_identically_to_rust_builder() {
        let desc = ProtocolDescriptor::from_json(IPV4_JSON).unwrap();
        let lowered = lower(&desc, &LayoutContext { offset: 14, placed: &[] }).unwrap();
        let rust = ipv4::build(14, &ipv4::Ipv4Params::default());
        assert_eq!(lowered, rust);
    }

    #[test]
    fn tcp_descriptor_lowers_identically_to_rust_builder() {
        // TCP references the IPv4 layer's addresses, so IPv4 must be placed first.
        let (_, ipv4_layer) = ipv4::build(14, &ipv4::Ipv4Params::default());
        let placed = vec![ipv4_layer];

        let desc = ProtocolDescriptor::from_json(TCP_JSON).unwrap();
        let lowered = lower(&desc, &LayoutContext { offset: 34, placed: &placed }).unwrap();
        let rust = tcp::build(34, 14, &tcp::TcpParams::default());
        assert_eq!(lowered, rust);
    }

    #[test]
    fn unresolved_cross_layer_reference_errors() {
        let desc = ProtocolDescriptor::from_json(TCP_JSON).unwrap();
        // No IPv4 layer placed -> the LayerField cannot resolve.
        let err = lower(&desc, &LayoutContext { offset: 34, placed: &[] }).unwrap_err();
        assert_eq!(err, DescriptorError::LayerNotFound { layer: "IPv4".to_string() });
    }

    #[test]
    fn descriptor_json_round_trips() {
        let desc = ProtocolDescriptor::from_json(IPV4_JSON).unwrap();
        let back = ProtocolDescriptor::from_json(&desc.to_json().unwrap()).unwrap();
        assert_eq!(desc, back);
    }
}
