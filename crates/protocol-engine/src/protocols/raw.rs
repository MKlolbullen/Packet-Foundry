//! Raw bytes as a single opaque field — the assembler's trailing payload, and the dissector's
//! catch-all for unknown / options / leftover regions (hence the caller-supplied `name`).

use packet_core::{BitRange, Field, FieldKind, Layer};

/// A `len`-byte opaque layer named `name` at absolute byte `offset` — shared by `build`
/// (always "Payload") and the dissector (also "IPv4 Options", "TCP Options", "Unknown").
pub fn layer(offset: usize, len: usize, name: &str) -> Layer {
    Layer::new(
        name,
        BitRange::bytes(offset, len),
        vec![Field::new("Data", BitRange::bytes(offset, len), FieldKind::Bytes)],
    )
}

/// Build a payload layer of `data` at absolute byte `offset`.
pub fn build(offset: usize, data: &[u8]) -> (Vec<u8>, Layer) {
    (data.to_vec(), layer(offset, data.len(), "Payload"))
}
