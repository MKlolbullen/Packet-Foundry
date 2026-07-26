//! [`PacketDocument`] — the top-level artifact: authoritative bytes + the semantic tree +
//! diagnostics, plus in-memory undo/redo history. Serializes to self-contained JSON.

use serde::{Deserialize, Serialize};

use crate::{Diagnostic, EditHistory, Layer, PacketBuffer};

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
