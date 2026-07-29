//! [`PacketDocument`] — the top-level artifact: authoritative bytes + the semantic tree +
//! diagnostics, plus in-memory undo/redo history. Serializes to self-contained JSON.

use serde::{Deserialize, Serialize};

use crate::{Diagnostic, EditHistory, Layer, NodeId, PacketBuffer};

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
