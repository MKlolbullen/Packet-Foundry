//! Built-in protocol builders. Each emits header bytes plus a [`packet_core::Layer`] whose derived
//! fields are expressed in the shared `Operation` IR — the same boxes a future data-driven or
//! visual definition would produce.

pub mod ethernet;
pub mod icmp;
pub mod ipv4;
pub mod raw;
pub mod tcp;
pub mod udp;
