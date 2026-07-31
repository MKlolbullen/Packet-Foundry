//! `protocol-engine` — the behavior layer for Packet Foundry.
//!
//! Evaluates the `packet_core` operation IR against a packet buffer (the "resolve" pass of the
//! assembler), tracks field dependencies to resolve derived fields in topological order, and
//! provides the built-in protocol builders (Ethernet II, IPv4, TCP, raw payload).

pub mod catalog;
pub mod descriptor;
pub mod diff;
mod dissect;
mod eval;
pub mod protocols;
pub mod render;
mod registry;
mod resolve;

pub use catalog::{
    ParameterDescriptor, ParameterRole, ProtocolCatalogEntry, ProtocolCategory, catalog,
};
pub use descriptor::{
    DExpr, DescriptorError, FieldDescriptor, LayoutContext, ProtocolDescriptor, lower,
};
pub use diff::{
    ByteDiff, ByteRange, DiagnosticsDiff, FieldChange, FieldDiff, FieldSnapshot, FieldState,
    LayerDiff, LayerStatus, PacketDiff, diff,
};
pub use dissect::dissect;
pub use eval::{EngineError, evaluate};
pub use registry::{FieldPin, ProtocolSpec, assemble, assemble_with_pins};
pub use render::format_field_value;
pub use resolve::{resolve, validate};
