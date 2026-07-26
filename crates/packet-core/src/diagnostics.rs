//! Diagnostics — how the engine *describes* problems without refusing to load a packet.
//!
//! Because the byte buffer is authoritative, a malformed, truncated, or deliberately-invalid
//! packet always loads. Diagnostics annotate what is wrong (a checksum that disagrees with its
//! bytes, a field that runs past the buffer, overlapping ranges) so the caller can decide what
//! to do.

use serde::{Deserialize, Serialize};

use crate::BitRange;

/// Severity of a [`Diagnostic`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Warning,
    Error,
}

/// A single problem the engine noticed about a document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    /// A short machine-readable code, e.g. `"checksum.mismatch"`.
    pub code: String,
    /// Human-readable explanation.
    pub message: String,
    /// The location the diagnostic refers to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<BitRange>,
}

impl Diagnostic {
    pub fn new(
        severity: Severity,
        code: impl Into<String>,
        message: impl Into<String>,
        location: Option<BitRange>,
    ) -> Self {
        Self {
            severity,
            code: code.into(),
            message: message.into(),
            location,
        }
    }

    pub fn error(code: impl Into<String>, message: impl Into<String>, location: Option<BitRange>) -> Self {
        Self::new(Severity::Error, code, message, location)
    }

    pub fn warning(code: impl Into<String>, message: impl Into<String>, location: Option<BitRange>) -> Self {
        Self::new(Severity::Warning, code, message, location)
    }
}
