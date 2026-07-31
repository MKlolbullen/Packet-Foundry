//! `protocol-engine` — the behavior layer for Packet Foundry.
//!
//! Evaluates the `packet_core` operation IR against a packet buffer (the "resolve" pass of the
//! assembler), tracks field dependencies to resolve derived fields in topological order, and
//! provides the built-in protocol builders (Ethernet II, IPv4, TCP, raw payload).

pub mod catalog;
pub mod descriptor;
mod dissect;
mod eval;
pub mod protocols;
mod registry;
mod resolve;

pub use catalog::{
    ParameterDescriptor, ParameterRole, ProtocolCatalogEntry, ProtocolCategory, catalog,
};
pub use descriptor::{
    DExpr, DescriptorError, FieldDescriptor, LayoutContext, ProtocolDescriptor, lower,
};
pub use dissect::dissect;
pub use eval::{EngineError, evaluate};
pub use registry::{FieldPin, ProtocolSpec, assemble, assemble_with_pins};
pub use resolve::{resolve, validate};
