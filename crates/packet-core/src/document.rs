//! [`PacketDocument`] — the top-level artifact: authoritative bytes + the semantic tree +
//! diagnostics, plus in-memory undo/redo history. Serializes to self-contained JSON.

use serde::{Deserialize, Serialize};

use crate::{Diagnostic, EditHistory, Field, Layer, NodeId, PacketBuffer};

/// The on-disk schema version, bumped when the JSON layout changes incompatibly.
pub const SCHEMA_VERSION: u32 = 1;

fn schema_version() -> u32 {
    SCHEMA_VERSION
}

/// A complete packet: bytes, structure, and diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PacketDocument {
    #[serde(default = "schema_version")]
    pub version: u32,
    pub buffer: PacketBuffer,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub diagnostics: Vec<Diagnostic>,
    /// Session-only undo/redo; never serialized.
    #[serde(skip)]
    pub history: EditHistory,
}

impl Default for PacketDocument {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            buffer: PacketBuffer::new(),
            layers: Vec::new(),
            diagnostics: Vec::new(),
            history: EditHistory::new(),
        }
    }
}

impl PacketDocument {
    pub fn new() -> Self {
        Self::default()
    }

    /// A document wrapping an existing byte buffer.
    pub fn with_buffer(buffer: PacketBuffer) -> Self {
        Self {
            buffer,
            ..Self::default()
        }
    }

    /// Find a layer by name.
    pub fn layer(&self, name: &str) -> Option<&Layer> {
        self.layers.iter().find(|l| l.name == name)
    }

    /// Find a layer by its stable id.
    pub fn layer_by_id(&self, id: NodeId) -> Option<&Layer> {
        self.layers.iter().find(|l| l.id == id)
    }

    /// Find a layer by its stable id, mutably.
    pub fn layer_by_id_mut(&mut self, id: NodeId) -> Option<&mut Layer> {
        self.layers.iter_mut().find(|l| l.id == id)
    }

    /// Find a field by its layer and field ids, mutably — the entry point every
    /// document-mutation command starts from.
    pub fn field_by_id_mut(&mut self, layer_id: NodeId, field_id: NodeId) -> Option<&mut Field> {
        self.layer_by_id_mut(layer_id)?.field_by_id_mut(field_id)
    }

    /// Assign fresh, document-unique nonzero IDs to every layer/field whose `id` is still the
    /// unassigned sentinel (`NodeId(0)`). Idempotent: already-assigned nonzero IDs are never
    /// touched. Walks in document order (layer, then its fields, then the next layer) so IDs are
    /// stable and deterministic for a given document shape.
    pub fn assign_missing_node_ids(&mut self) {
        let mut next = self
            .layers
            .iter()
            .flat_map(|l| std::iter::once(l.id.0).chain(l.fields.iter().map(|f| f.id.0)))
            .max()
            .unwrap_or(0)
            + 1;
        for layer in &mut self.layers {
            if layer.id.0 == 0 {
                layer.id = NodeId(next);
                next += 1;
            }
            for field in &mut layer.fields {
                if field.id.0 == 0 {
                    field.id = NodeId(next);
                    next += 1;
                }
            }
        }
    }

    /// Serialize to pretty JSON.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Parse from JSON. Because bytes are authoritative, any syntactically valid document loads —
    /// including malformed packets; problems surface as diagnostics, not parse errors.
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BitRange, FieldKind};

    fn doc_with_field() -> (PacketDocument, NodeId, NodeId) {
        let mut field = Field::new("TTL", BitRange::bytes(8, 1), FieldKind::Uint);
        field.id = NodeId(2);
        let mut layer = Layer::new("IPv4", BitRange::bytes(0, 20), vec![field]);
        layer.id = NodeId(1);
        let doc = PacketDocument {
            layers: vec![layer],
            ..PacketDocument::new()
        };
        (doc, NodeId(1), NodeId(2))
    }

    #[test]
    fn layer_by_id_finds_matching_layer() {
        let (doc, layer_id, _) = doc_with_field();
        assert_eq!(doc.layer_by_id(layer_id).unwrap().name, "IPv4");
        assert!(doc.layer_by_id(NodeId(999)).is_none());
    }

    #[test]
    fn layer_by_id_mut_finds_matching_layer() {
        let (mut doc, layer_id, _) = doc_with_field();
        doc.layer_by_id_mut(layer_id).unwrap().name = "Renamed".into();
        assert_eq!(doc.layer_by_id(layer_id).unwrap().name, "Renamed");
    }

    #[test]
    fn field_by_id_mut_composes_both_lookups() {
        let (mut doc, layer_id, field_id) = doc_with_field();
        doc.field_by_id_mut(layer_id, field_id).unwrap().name = "Renamed".into();
        assert_eq!(doc.layer_by_id(layer_id).unwrap().fields[0].name, "Renamed");
        assert!(doc.field_by_id_mut(layer_id, NodeId(999)).is_none());
        assert!(doc.field_by_id_mut(NodeId(999), field_id).is_none());
    }
}
