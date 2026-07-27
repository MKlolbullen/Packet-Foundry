//! The resolve pass — assemble derived fields into the buffer in dependency order, then validate.
//!
//! [`resolve`] writes pinned overrides, evaluates every *active* derived field (checksums,
//! lengths) in topological order — so a field that reads another derived field is computed after
//! it — and regenerates diagnostics. [`validate`] is the read-only half: it compares each derived
//! field's bytes against what its derivation *would* produce and flags the mismatch, without
//! touching the buffer (this is what `inspect` uses so a corrupted packet is reported, not fixed).

use packet_core::{BitRange, Diagnostic, Operation, PacketDocument};

use crate::eval::{EngineError, evaluate};

/// Resolve all derived fields in dependency order and regenerate diagnostics.
pub fn resolve(doc: &mut PacketDocument) -> Result<(), EngineError> {
    apply_overrides(doc)?;

    let (order, has_cycle) = resolution_order(doc);

    let mut diagnostics = Vec::new();
    if has_cycle {
        diagnostics.push(Diagnostic::warning(
            "resolve.cycle",
            "derived fields form a dependency cycle; resolved in declaration order",
            None,
        ));
    }

    for (li, fi) in order {
        resolve_field(doc, li, fi)?;
    }

    diagnostics.extend(validate(doc));
    doc.diagnostics = diagnostics;
    Ok(())
}

/// Compute diagnostics for a document without modifying it: out-of-bounds fields, truncated
/// layers, overlapping fields, and derived fields whose bytes disagree with their derivation.
pub fn validate(doc: &PacketDocument) -> Vec<Diagnostic> {
    let mut diags = Vec::new();
    let buf_bits = doc.buffer.len() * 8;

    for layer in &doc.layers {
        let layer_end = layer.range.start_bit + layer.range.len_bits;
        if layer_end > buf_bits {
            diags.push(Diagnostic::error(
                "layer.truncated",
                format!("layer `{}` extends past the buffer", layer.name),
                Some(layer.range),
            ));
        }

        for (i, field) in layer.fields.iter().enumerate() {
            let end = field.range.start_bit + field.range.len_bits;
            if end > buf_bits {
                diags.push(Diagnostic::error(
                    "field.out_of_bounds",
                    format!("field `{}` extends past the buffer", field.name),
                    Some(field.range),
                ));
            }
            for other in &layer.fields[i + 1..] {
                let a = (field.range.start_bit, end);
                let b = (other.range.start_bit, other.range.start_bit + other.range.len_bits);
                if a.0 < b.1 && b.0 < a.1 {
                    diags.push(Diagnostic::warning(
                        "field.overlap",
                        format!("fields `{}` and `{}` overlap", field.name, other.name),
                        Some(field.range),
                    ));
                }
            }
        }
    }

    // Do the derived bytes actually agree with what the derivation computes?
    for layer in &doc.layers {
        for field in &layer.fields {
            let Some(derivation) = &field.derivation else {
                continue;
            };
            let Some(expected) = expected_bytes(doc, field.range, derivation) else {
                continue;
            };
            let Ok(actual) = doc.buffer.read_bytes(field.range) else {
                continue;
            };
            if expected != actual {
                if field.override_bytes.is_some() {
                    diags.push(Diagnostic::warning(
                        "field.override_mismatch",
                        format!("field `{}` is pinned to a value that differs from its derivation", field.name),
                        Some(field.range),
                    ));
                } else {
                    diags.push(Diagnostic::warning(
                        "field.derivation_mismatch",
                        format!("field `{}` bytes disagree with its derivation (corrupted or stale)", field.name),
                        Some(field.range),
                    ));
                }
            }
        }
    }

    diags
}

/// Write every pinned override into the buffer (a pin is a fixed input to other derivations).
fn apply_overrides(doc: &mut PacketDocument) -> Result<(), EngineError> {
    let pins: Vec<(BitRange, Vec<u8>)> = doc
        .layers
        .iter()
        .flat_map(|layer| {
            layer
                .fields
                .iter()
                .filter_map(|f| f.override_bytes.as_ref().map(|b| (f.range, b.clone())))
        })
        .collect();
    for (range, bytes) in pins {
        if range.start_bit % 8 == 0 && range.len_bits == bytes.len() * 8 {
            let end = (range.start_bit + range.len_bits) / 8;
            if end <= doc.buffer.len() {
                doc.buffer.write_bytes(range, &bytes)?;
            }
        }
    }
    Ok(())
}

/// Topologically order the active derived fields so each is resolved after the derived fields it
/// reads. Returns the order plus whether a dependency cycle was detected.
fn resolution_order(doc: &PacketDocument) -> (Vec<(usize, usize)>, bool) {
    let mut nodes: Vec<(usize, usize)> = Vec::new();
    for (li, layer) in doc.layers.iter().enumerate() {
        for (fi, field) in layer.fields.iter().enumerate() {
            if field.is_active_derivation() {
                nodes.push((li, fi));
            }
        }
    }
    let n = nodes.len();
    let buffer_len = doc.buffer.len();

    let mut targets = Vec::with_capacity(n);
    let mut inputs: Vec<Vec<(usize, usize)>> = Vec::with_capacity(n);
    for &(li, fi) in &nodes {
        let field = &doc.layers[li].fields[fi];
        targets.push(byte_span(field.range));
        let mut spans = Vec::new();
        if let Some(op) = &field.derivation {
            input_spans(op, buffer_len, &mut spans);
        }
        inputs.push(spans);
    }

    // i must come after j when i reads j's target (self-reads are handled by zeroing, not ordering).
    let mut indeg = vec![0usize; n];
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); n];
    for i in 0..n {
        for j in 0..n {
            if i != j && inputs[i].iter().any(|&s| overlaps(s, targets[j])) {
                indeg[i] += 1;
                dependents[j].push(i);
            }
        }
    }

    let mut queue: std::collections::VecDeque<usize> = (0..n).filter(|&i| indeg[i] == 0).collect();
    let mut order_idx: Vec<usize> = Vec::with_capacity(n);
    while let Some(u) = queue.pop_front() {
        order_idx.push(u);
        for &v in &dependents[u] {
            indeg[v] -= 1;
            if indeg[v] == 0 {
                queue.push_back(v);
            }
        }
    }

    let has_cycle = order_idx.len() < n;
    if has_cycle {
        for i in 0..n {
            if !order_idx.contains(&i) {
                order_idx.push(i);
            }
        }
    }

    let order = order_idx.into_iter().map(|i| nodes[i]).collect();
    (order, has_cycle)
}

/// Evaluate one field's derivation (with its own bytes zeroed first) and write the result.
fn resolve_field(doc: &mut PacketDocument, li: usize, fi: usize) -> Result<(), EngineError> {
    let field = &doc.layers[li].fields[fi];
    let range = field.range;
    let Some(derivation) = field.derivation.clone() else {
        return Ok(());
    };
    if range.start_bit % 8 != 0 || range.len_bits % 8 != 0 {
        return Ok(());
    }
    let nbytes = range.len_bits / 8;
    if (range.start_bit / 8) + nbytes > doc.buffer.len() {
        return Ok(());
    }
    doc.buffer.write_bytes(range, &vec![0u8; nbytes])?;
    let value = evaluate(&derivation, &doc.buffer)?;
    if value.len() == nbytes {
        doc.buffer.write_bytes(range, &value)?;
    }
    Ok(())
}

/// What a derived field *should* contain, computed with its own bytes zeroed. `None` if the range
/// is unusable or the derivation cannot be evaluated.
fn expected_bytes(doc: &PacketDocument, range: BitRange, derivation: &Operation) -> Option<Vec<u8>> {
    if range.start_bit % 8 != 0 || range.len_bits % 8 != 0 {
        return None;
    }
    let nbytes = range.len_bits / 8;
    if (range.start_bit / 8) + nbytes > doc.buffer.len() {
        return None;
    }
    let mut probe = doc.buffer.clone();
    probe.write_bytes(range, &vec![0u8; nbytes]).ok()?;
    let value = evaluate(derivation, &probe).ok()?;
    (value.len() == nbytes).then_some(value)
}

/// Byte interval `[start, end)` covered by a range (rounding out to whole bytes).
fn byte_span(range: BitRange) -> (usize, usize) {
    let start = range.start_bit / 8;
    let end = (range.start_bit + range.len_bits).div_ceil(8);
    (start, end)
}

fn overlaps(a: (usize, usize), b: (usize, usize)) -> bool {
    a.0 < b.1 && b.0 < a.1
}

/// Byte intervals an operation reads (for dependency ordering).
fn input_spans(op: &Operation, buffer_len: usize, out: &mut Vec<(usize, usize)>) {
    match op {
        Operation::ReadRange(range) => out.push(byte_span(*range)),
        Operation::ReadFrom { from_byte } => out.push((*from_byte, buffer_len)),
        Operation::Concat(parts) | Operation::OnesComplementSum(parts) => {
            for p in parts {
                input_spans(p, buffer_len, out);
            }
        }
        Operation::And(a, b) | Operation::Or(a, b) | Operation::Xor(a, b) => {
            input_spans(a, buffer_len, out);
            input_spans(b, buffer_len, out);
        }
        Operation::Not(a) | Operation::Composite { body: a, .. } => input_spans(a, buffer_len, out),
        // Const / ByteLength read no field bytes; reserved ops never appear in resolved graphs.
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use packet_core::{Field, FieldKind, Layer, PacketBuffer, Severity};

    fn checksum_over(range: BitRange) -> Operation {
        Operation::internet_checksum(vec![Operation::ReadRange(range)])
    }

    #[test]
    fn resolves_in_dependency_order() {
        let mut doc = PacketDocument::with_buffer(PacketBuffer::with_len(8));
        doc.layers.push(Layer::new(
            "L",
            BitRange::bytes(0, 8),
            vec![
                Field::derived(
                    "Len",
                    BitRange::bytes(0, 2),
                    FieldKind::Uint,
                    Operation::ByteLength { from_byte: 0, width: 2 },
                ),
                // Reads the whole region, which contains Len -> must be resolved after Len.
                Field::derived("Cksum", BitRange::bytes(2, 2), FieldKind::Uint, checksum_over(BitRange::bytes(0, 8))),
            ],
        ));

        resolve(&mut doc).unwrap();

        assert_eq!(doc.buffer.read_bytes(BitRange::bytes(0, 2)).unwrap(), vec![0x00, 0x08]);
        // A correct checksum makes the region sum to zero.
        let verify = evaluate(&Operation::OnesComplementSum(vec![Operation::ReadRange(BitRange::bytes(0, 8))]), &doc.buffer).unwrap();
        assert_eq!(verify, vec![0x00, 0x00]);
        assert!(doc.diagnostics.is_empty(), "clean packet has no diagnostics: {:?}", doc.diagnostics);
    }

    #[test]
    fn pinned_override_persists_and_flags_mismatch() {
        let mut doc = PacketDocument::with_buffer(PacketBuffer::with_len(8));
        doc.layers.push(Layer::new(
            "L",
            BitRange::bytes(0, 8),
            vec![Field::derived("Cksum", BitRange::bytes(2, 2), FieldKind::Uint, checksum_over(BitRange::bytes(0, 8)))],
        ));
        doc.layers[0].field_mut("Cksum").unwrap().override_bytes = Some(vec![0xDE, 0xAD]);

        resolve(&mut doc).unwrap();

        assert_eq!(doc.buffer.read_bytes(BitRange::bytes(2, 2)).unwrap(), vec![0xDE, 0xAD]);
        assert!(
            doc.diagnostics.iter().any(|d| d.code == "field.override_mismatch" && d.severity == Severity::Warning),
            "expected an override-mismatch warning, got {:?}",
            doc.diagnostics
        );
    }

    #[test]
    fn out_of_bounds_field_is_flagged() {
        let mut doc = PacketDocument::with_buffer(PacketBuffer::with_len(4));
        doc.layers.push(Layer::new(
            "L",
            BitRange::bytes(0, 4),
            vec![Field::new("X", BitRange::bytes(2, 8), FieldKind::Bytes)],
        ));

        resolve(&mut doc).unwrap();

        assert!(doc.diagnostics.iter().any(|d| d.code == "field.out_of_bounds"));
    }

    #[test]
    fn active_derivation_mismatch_is_flagged_by_validate() {
        // Simulates loading a packet whose checksum bytes were corrupted: validate must report it
        // without recomputing.
        let mut doc = PacketDocument::with_buffer(PacketBuffer::with_len(8));
        doc.layers.push(Layer::new(
            "L",
            BitRange::bytes(0, 8),
            vec![Field::derived("Cksum", BitRange::bytes(2, 2), FieldKind::Uint, checksum_over(BitRange::bytes(0, 8)))],
        ));
        // Put a wrong checksum directly in the bytes.
        doc.buffer.write_bytes(BitRange::bytes(2, 2), &[0x12, 0x34]).unwrap();

        let diags = validate(&doc);
        assert!(diags.iter().any(|d| d.code == "field.derivation_mismatch"));
    }

    #[test]
    fn dependency_cycle_is_flagged_not_hung() {
        let mut doc = PacketDocument::with_buffer(PacketBuffer::with_len(4));
        doc.layers.push(Layer::new(
            "L",
            BitRange::bytes(0, 4),
            vec![
                Field::derived("A", BitRange::bytes(0, 2), FieldKind::Bytes, Operation::ReadRange(BitRange::bytes(2, 2))),
                Field::derived("B", BitRange::bytes(2, 2), FieldKind::Bytes, Operation::ReadRange(BitRange::bytes(0, 2))),
            ],
        ));

        resolve(&mut doc).unwrap();

        assert!(doc.diagnostics.iter().any(|d| d.code == "resolve.cycle"));
    }
}
