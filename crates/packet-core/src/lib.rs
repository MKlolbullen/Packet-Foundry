//! `packet-core` — the data model for Packet Foundry.
//!
//! A [`PacketDocument`] is **byte-buffer authoritative**: a single `Vec<u8>` ([`PacketBuffer`])
//! is the source of truth, and the semantic tree of [`Layer`]s / [`Field`]s is a set of
//! [`BitRange`] views over it. Any bit pattern — including malformed, truncated, or deliberately
//! invalid packets — is always representable; [`Diagnostic`]s *describe* problems rather than
//! prevent loading.
//!
//! Derived fields (checksums, lengths) are expressed as the [`Operation`] IR — the seed of the
//! eventual drag-and-drop "box" language. The evaluator that runs it lives in `protocol-engine`.

mod bitrange;
mod buffer;
mod diagnostics;
mod document;
mod history;
mod node;
mod operation;

pub use bitrange::{BitRange, CoreError};
pub use buffer::PacketBuffer;
pub use diagnostics::{Diagnostic, Severity};
pub use document::{PacketDocument, SCHEMA_VERSION};
pub use history::{Edit, EditHistory};
pub use node::{Field, FieldKind, Layer, NodeId};
pub use operation::Operation;
