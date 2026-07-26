//! `packet-core` — the data model for Packet Foundry.
//!
//! A packet document is **byte-buffer authoritative**: a single `Vec<u8>` is the source of
//! truth, and the semantic tree of layers/fields is a set of `BitRange` views over it. Any
//! bit pattern — including malformed, truncated, or deliberately invalid packets — is always
//! representable; diagnostics *describe* problems rather than prevent loading.

// Modules are added test-first during Phase 1 implementation.
