//! The semantic structure tree: layers and fields, as named `BitRange` views over the buffer.
//!
//! The tree is *derived from* and *describes* the authoritative byte buffer; it never holds the
//! packet's value itself. A [`Field`] may carry a `derivation` (an [`Operation`] that computes
//! its bytes) and/or an `override_bytes` "pin" that suspends the derivation to craft a
//! deliberately-wrong value.

use serde::{Deserialize, Serialize};

use crate::{BitRange, Operation};

/// A stable identity for a structural node (`Layer` or `Field`) that survives edits and
/// serialization round-trips. `NodeId(0)` is the "unassigned" sentinel — never used to identify
/// a real node; [`crate::PacketDocument::assign_missing_node_ids`] replaces every `0` with a
/// fresh, document-unique nonzero value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct NodeId(pub u64);

/// How a field's bytes should be interpreted for display.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldKind {
    /// Unsigned big-endian integer.
    Uint,
    /// Opaque bytes.
    Bytes,
    /// 6-byte MAC address.
    MacAddr,
    /// 4-byte IPv4 address.
    Ipv4Addr,
    /// Bit flags.
    Flags,
}

/// A named region of the buffer within a layer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Field {
    pub id: NodeId,
    pub name: String,
    /// Absolute range within the document buffer.
    pub range: BitRange,
    pub kind: FieldKind,
    /// Optional operation that computes this field's bytes during the resolve pass.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derivation: Option<Operation>,
    /// Optional pinned value that overrides (suspends) the derivation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub override_bytes: Option<Vec<u8>>,
}

impl Field {
    /// A plain field with no derivation.
    pub fn new(name: impl Into<String>, range: BitRange, kind: FieldKind) -> Self {
        Self {
            id: NodeId::default(),
            name: name.into(),
            range,
            kind,
            derivation: None,
            override_bytes: None,
        }
    }

    /// A derived field carrying the operation that computes it.
    pub fn derived(
        name: impl Into<String>,
        range: BitRange,
        kind: FieldKind,
        derivation: Operation,
    ) -> Self {
        Self {
            id: NodeId::default(),
            name: name.into(),
            range,
            kind,
            derivation: Some(derivation),
            override_bytes: None,
        }
    }

    /// Whether this field is derived and not currently pinned to an override.
    pub fn is_active_derivation(&self) -> bool {
        self.derivation.is_some() && self.override_bytes.is_none()
    }
}

/// A protocol layer: a named span of the buffer holding a list of fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layer {
    pub id: NodeId,
    pub name: String,
    /// Absolute range of the whole layer within the document buffer.
    pub range: BitRange,
    pub fields: Vec<Field>,
}

impl Layer {
    pub fn new(name: impl Into<String>, range: BitRange, fields: Vec<Field>) -> Self {
        Self {
            id: NodeId::default(),
            name: name.into(),
            range,
            fields,
        }
    }

    /// Find a field by name.
    pub fn field(&self, name: &str) -> Option<&Field> {
        self.fields.iter().find(|f| f.name == name)
    }

    /// Find a field by name, mutably.
    pub fn field_mut(&mut self, name: &str) -> Option<&mut Field> {
        self.fields.iter_mut().find(|f| f.name == name)
    }
}
