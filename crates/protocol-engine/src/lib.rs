//! `protocol-engine` — the behavior layer for Packet Foundry.
//!
//! Evaluates the `packet_core` operation IR against a packet buffer (the "resolve" pass of the
//! assembler), tracks field dependencies to resolve derived fields in topological order, and
//! provides the built-in protocol builders (Ethernet II, IPv4, TCP, raw payload).

// Modules are added test-first during Phase 1 implementation.
