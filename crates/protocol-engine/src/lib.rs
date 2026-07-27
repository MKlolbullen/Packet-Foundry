//! `protocol-engine` — the behavior layer for Packet Foundry.
//!
//! Evaluates the `packet_core` operation IR against a packet buffer (the "resolve" pass of the
//! assembler), tracks field dependencies to resolve derived fields in topological order, and
//! provides the built-in protocol builders (Ethernet II, IPv4, TCP, raw payload).

mod eval;
pub mod protocols;
mod registry;
mod resolve;

pub use eval::{EngineError, evaluate};
pub use registry::{ProtocolSpec, assemble};
pub use resolve::{resolve, validate};
