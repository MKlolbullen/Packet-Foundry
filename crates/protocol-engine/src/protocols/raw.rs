//! Raw payload — arbitrary trailing bytes as a single opaque field.

use packet_core::{BitRange, Field, FieldKind, Layer};

/// Build a payload layer of `data` at absolute byte `offset`.
pub fn build(offset: usize, data: &[u8]) -> (Vec<u8>, Layer) {
    let layer = Layer::new(
        "Payload",
        BitRange::bytes(offset, data.len()),
        vec![Field::new("Data", BitRange::bytes(offset, data.len()), FieldKind::Bytes)],
    );
    (data.to_vec(), layer)
}
