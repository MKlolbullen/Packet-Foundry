//! Semantic packet diff: compare two related documents (a base and a variant — typically the same
//! packet before and after an edit) into a *causal* diff. Because each field carries its range,
//! kind, derivation, and pinned state, a value change can be classified as a **direct edit** (a
//! user-authored value, i.e. a pin or a plain field) versus a **derived consequence** (a value the
//! engine recomputed, i.e. an active derivation) — the thing a plain byte diff can't explain, e.g.
//! "IPv4.TTL 64 → 1 (direct)" cascading into "IPv4.HeaderChecksum b761 → f660 (consequence)".
//!
//! Pure and read-only: it never calls `resolve()`. Layers/fields match by (order, name) — never by
//! `NodeId`, which is per-document — so an inserted layer or a repeated name (QinQ's two VLANs)
//! diffs correctly.

use std::collections::{HashMap, VecDeque};

use packet_core::{BitRange, Diagnostic, Field, FieldKind, Layer, PacketBuffer, PacketDocument};
use serde::{Deserialize, Serialize};

use crate::render::format_field_value;

/// A field's authorship state in one document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldState {
    /// No derivation, no pin — a directly-supplied value.
    Plain,
    /// A derivation is computing the value (not pinned).
    Derived,
    /// Pinned to an explicit override, suspending any derivation.
    Pinned,
}

/// How a matched field changed between base and variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldChange {
    Unchanged,
    /// A user-authored value moved (the variant field is pinned or plain).
    DirectEdit,
    /// An engine-authored value moved (the variant field is an active derivation).
    DerivedConsequence,
    /// The value is identical; only the authorship state changed.
    StateOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerStatus {
    Unchanged,
    Modified,
    Added,
    Removed,
}

/// A single field present in only one document (added or removed).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldSnapshot {
    pub name: String,
    pub kind: FieldKind,
    pub range: BitRange,
    pub state: FieldState,
    pub value: String,
}

/// A matched field pair whose value and/or state changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldDiff {
    pub name: String,
    pub kind: FieldKind,
    pub range_before: BitRange,
    pub range_after: BitRange,
    pub state_before: FieldState,
    pub state_after: FieldState,
    pub value_before: String,
    pub value_after: String,
    pub change: FieldChange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayerDiff {
    pub name: String,
    pub status: LayerStatus,
    pub fields_added: Vec<FieldSnapshot>,
    pub fields_removed: Vec<FieldSnapshot>,
    pub fields_changed: Vec<FieldDiff>,
}

/// A half-open run of changed byte offsets `[start, end)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ByteRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ByteDiff {
    pub changed: Vec<ByteRange>,
    pub len_before: usize,
    pub len_after: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticsDiff {
    pub added: Vec<Diagnostic>,
    pub removed: Vec<Diagnostic>,
}

/// The full semantic diff of `variant` relative to `base`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PacketDiff {
    /// Layers in variant order; removed layers appended.
    pub layers: Vec<LayerDiff>,
    pub bytes: ByteDiff,
    pub diagnostics: DiagnosticsDiff,
}

/// The authorship state of a field.
fn state_of(field: &Field) -> FieldState {
    if field.override_bytes.is_some() {
        FieldState::Pinned
    } else if field.derivation.is_some() {
        FieldState::Derived
    } else {
        FieldState::Plain
    }
}

fn snapshot(buffer: &PacketBuffer, field: &Field) -> FieldSnapshot {
    FieldSnapshot {
        name: field.name.clone(),
        kind: field.kind,
        range: field.range,
        state: state_of(field),
        value: format_field_value(buffer, field),
    }
}

/// Diff a matched field pair (same name). Value equality is decided on the rendered value, and the
/// change classification hinges on the *variant's* state: an active derivation whose value moved is
/// a consequence; a pinned or plain field whose value moved is a direct edit.
fn diff_field(base_buf: &PacketBuffer, b: &Field, var_buf: &PacketBuffer, v: &Field) -> FieldDiff {
    let value_before = format_field_value(base_buf, b);
    let value_after = format_field_value(var_buf, v);
    let state_before = state_of(b);
    let state_after = state_of(v);
    let value_changed = value_before != value_after;
    let state_changed = state_before != state_after;

    let change = if value_changed {
        match state_after {
            FieldState::Derived => FieldChange::DerivedConsequence,
            FieldState::Pinned | FieldState::Plain => FieldChange::DirectEdit,
        }
    } else if state_changed {
        FieldChange::StateOnly
    } else {
        FieldChange::Unchanged
    };

    FieldDiff {
        name: v.name.clone(),
        kind: v.kind,
        range_before: b.range,
        range_after: v.range,
        state_before,
        state_after,
        value_before,
        value_after,
        change,
    }
}

/// Match fields within a matched layer by (order, name) and collect added/removed/changed.
fn diff_layer(base_buf: &PacketBuffer, base: &Layer, var_buf: &PacketBuffer, variant: &Layer) -> LayerDiff {
    let mut base_by_name: HashMap<&str, VecDeque<usize>> = HashMap::new();
    for (i, f) in base.fields.iter().enumerate() {
        base_by_name.entry(f.name.as_str()).or_default().push_back(i);
    }
    let mut matched = vec![false; base.fields.len()];
    let mut changed = Vec::new();
    let mut added = Vec::new();

    for v in &variant.fields {
        match base_by_name.get_mut(v.name.as_str()).and_then(VecDeque::pop_front) {
            Some(bi) => {
                matched[bi] = true;
                let fd = diff_field(base_buf, &base.fields[bi], var_buf, v);
                if fd.change != FieldChange::Unchanged {
                    changed.push(fd);
                }
            }
            None => added.push(snapshot(var_buf, v)),
        }
    }
    let removed: Vec<FieldSnapshot> = base
        .fields
        .iter()
        .enumerate()
        .filter(|(i, _)| !matched[*i])
        .map(|(_, f)| snapshot(base_buf, f))
        .collect();

    let status = if changed.is_empty() && added.is_empty() && removed.is_empty() {
        LayerStatus::Unchanged
    } else {
        LayerStatus::Modified
    };
    LayerDiff { name: variant.name.clone(), status, fields_added: added, fields_removed: removed, fields_changed: changed }
}

fn added_or_removed_layer(buffer: &PacketBuffer, layer: &Layer, status: LayerStatus) -> LayerDiff {
    let snaps: Vec<FieldSnapshot> = layer.fields.iter().map(|f| snapshot(buffer, f)).collect();
    let (added, removed) = match status {
        LayerStatus::Added => (snaps, Vec::new()),
        _ => (Vec::new(), snaps),
    };
    LayerDiff { name: layer.name.clone(), status, fields_added: added, fields_removed: removed, fields_changed: Vec::new() }
}

fn byte_diff(base: &PacketBuffer, variant: &PacketBuffer) -> ByteDiff {
    let a = base.as_slice();
    let b = variant.as_slice();
    let max = a.len().max(b.len());
    let mut changed = Vec::new();
    let mut run_start: Option<usize> = None;
    for i in 0..max {
        let differs = i >= a.len() || i >= b.len() || a[i] != b[i];
        match (differs, run_start) {
            (true, None) => run_start = Some(i),
            (false, Some(s)) => {
                changed.push(ByteRange { start: s, end: i });
                run_start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = run_start {
        changed.push(ByteRange { start: s, end: max });
    }
    ByteDiff { changed, len_before: a.len(), len_after: b.len() }
}

/// Multiset difference of diagnostics (two identical diagnostics don't collapse).
fn diagnostics_diff(base: &[Diagnostic], variant: &[Diagnostic]) -> DiagnosticsDiff {
    let mut pool: Vec<&Diagnostic> = variant.iter().collect();
    let mut removed = Vec::new();
    for d in base {
        match pool.iter().position(|x| *x == d) {
            Some(pos) => {
                pool.remove(pos);
            }
            None => removed.push(d.clone()),
        }
    }
    let added = pool.into_iter().cloned().collect();
    DiagnosticsDiff { added, removed }
}

/// Diff `variant` against `base`. Pure; never resolves. Layers/fields matched by (order, name).
pub fn diff(base: &PacketDocument, variant: &PacketDocument) -> PacketDiff {
    let mut base_by_name: HashMap<&str, VecDeque<usize>> = HashMap::new();
    for (i, l) in base.layers.iter().enumerate() {
        base_by_name.entry(l.name.as_str()).or_default().push_back(i);
    }
    let mut matched = vec![false; base.layers.len()];
    let mut layers = Vec::new();

    for v in &variant.layers {
        match base_by_name.get_mut(v.name.as_str()).and_then(VecDeque::pop_front) {
            Some(bi) => {
                matched[bi] = true;
                layers.push(diff_layer(&base.buffer, &base.layers[bi], &variant.buffer, v));
            }
            None => layers.push(added_or_removed_layer(&variant.buffer, v, LayerStatus::Added)),
        }
    }
    for (i, l) in base.layers.iter().enumerate() {
        if !matched[i] {
            layers.push(added_or_removed_layer(&base.buffer, l, LayerStatus::Removed));
        }
    }

    PacketDiff {
        layers,
        bytes: byte_diff(&base.buffer, &variant.buffer),
        diagnostics: diagnostics_diff(&base.diagnostics, &variant.diagnostics),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocols::{ethernet, ipv4, tcp};
    use crate::registry::{FieldPin, ProtocolSpec, assemble, assemble_with_pins};
    use crate::resolve::validate;

    fn eth_ipv4_tcp() -> Vec<ProtocolSpec> {
        vec![
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params { src: [1, 2, 3, 4], dst: [5, 6, 7, 8], ..Default::default() }),
            ProtocolSpec::Tcp(tcp::TcpParams { dst_port: 443, flags: tcp::flags::SYN, ..Default::default() }),
        ]
    }

    fn find<'a>(d: &'a PacketDiff, layer: &str, field: &str) -> Option<&'a FieldDiff> {
        d.layers
            .iter()
            .find(|l| l.name == layer)?
            .fields_changed
            .iter()
            .find(|f| f.name == field)
    }

    #[test]
    fn direct_edit_cascades_into_a_derived_consequence() {
        let base = assemble(&eth_ipv4_tcp()).unwrap();
        // Pin TTL to 1 — a direct edit that also makes HeaderChecksum recompute.
        let variant = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 1, field_name: "TTL".into(), bytes: vec![1] }],
        )
        .unwrap();
        let d = diff(&base, &variant);

        let ttl = find(&d, "IPv4", "TTL").unwrap();
        assert_eq!(ttl.change, FieldChange::DirectEdit);
        assert_eq!(ttl.value_before, "64");
        assert_eq!(ttl.value_after, "1");
        assert_eq!(ttl.state_after, FieldState::Pinned);

        let csum = find(&d, "IPv4", "HeaderChecksum").unwrap();
        assert_eq!(csum.change, FieldChange::DerivedConsequence);
        assert_eq!(csum.state_after, FieldState::Derived);
        assert_ne!(csum.value_before, csum.value_after);
    }

    #[test]
    fn pinning_to_the_current_value_is_state_only() {
        let base = assemble(&eth_ipv4_tcp()).unwrap();
        // TTL default is 64; pin it to 64 — value unchanged, state Plain→Pinned.
        let variant = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 1, field_name: "TTL".into(), bytes: vec![64] }],
        )
        .unwrap();
        let d = diff(&base, &variant);
        let ttl = find(&d, "IPv4", "TTL").unwrap();
        assert_eq!(ttl.change, FieldChange::StateOnly);
        assert_eq!(ttl.state_before, FieldState::Plain);
        assert_eq!(ttl.state_after, FieldState::Pinned);
        assert_eq!(ttl.value_before, ttl.value_after);
    }

    #[test]
    fn identical_docs_have_no_changes() {
        let base = assemble(&eth_ipv4_tcp()).unwrap();
        let d = diff(&base, &base);
        assert!(d.layers.iter().all(|l| l.status == LayerStatus::Unchanged));
        assert!(d.bytes.changed.is_empty());
        assert!(d.diagnostics.added.is_empty() && d.diagnostics.removed.is_empty());
    }

    #[test]
    fn independent_builds_match_by_name_not_nodeid() {
        // Two independent assemblies have unrelated per-document NodeIds but identical structure and
        // bytes — matching by name (not id) must diff them to nothing.
        let a = assemble(&eth_ipv4_tcp()).unwrap();
        let b = assemble(&eth_ipv4_tcp()).unwrap();
        let d = diff(&a, &b);
        assert!(d.layers.iter().all(|l| l.fields_changed.is_empty() && l.fields_added.is_empty() && l.fields_removed.is_empty()));
        assert!(d.bytes.changed.is_empty());
    }

    #[test]
    fn added_layer_is_detected_and_others_still_match() {
        let base = assemble(&eth_ipv4_tcp()).unwrap();
        let variant = assemble(&[
            ProtocolSpec::Ethernet(ethernet::EthernetParams::default()),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params { src: [1, 2, 3, 4], dst: [5, 6, 7, 8], ..Default::default() }),
            ProtocolSpec::Ipv4(ipv4::Ipv4Params::default()),
            ProtocolSpec::Tcp(tcp::TcpParams { dst_port: 443, flags: tcp::flags::SYN, ..Default::default() }),
        ])
        .unwrap();
        let d = diff(&base, &variant);
        // One IPv4 matched, the second IPv4 is Added; Ethernet and TCP still match.
        let added = d.layers.iter().filter(|l| l.status == LayerStatus::Added).count();
        assert_eq!(added, 1);
        assert!(d.layers.iter().any(|l| l.name == "Ethernet II" && l.status == LayerStatus::Unchanged));
    }

    #[test]
    fn bytes_diff_coalesces_and_tracks_length() {
        let base = assemble(&eth_ipv4_tcp()).unwrap();
        let variant = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 1, field_name: "TTL".into(), bytes: vec![1] }],
        )
        .unwrap();
        let d = diff(&base, &variant);
        assert_eq!(d.bytes.len_before, d.bytes.len_after);
        // TTL (1 byte) and HeaderChecksum (2 bytes) changed — at least those ranges appear.
        assert!(!d.bytes.changed.is_empty());
        assert!(d.bytes.changed.iter().all(|r| r.start < r.end));
    }

    #[test]
    fn diagnostics_delta_reports_a_new_mismatch() {
        let base = assemble(&eth_ipv4_tcp()).unwrap();
        // Pin HeaderChecksum to a wrong value → a derivation-mismatch diagnostic appears.
        let mut variant = assemble_with_pins(
            &eth_ipv4_tcp(),
            &[FieldPin { layer_index: 1, field_name: "HeaderChecksum".into(), bytes: vec![0xDE, 0xAD] }],
        )
        .unwrap();
        variant.diagnostics = validate(&variant);
        let d = diff(&base, &variant);
        assert!(!d.diagnostics.added.is_empty(), "expected an added diagnostic");
    }

    #[test]
    fn different_length_buffers_report_a_tail_range() {
        let base = assemble(&eth_ipv4_tcp()).unwrap();
        let mut with_payload = eth_ipv4_tcp();
        with_payload.push(ProtocolSpec::Raw(b"hello".to_vec()));
        let variant = assemble(&with_payload).unwrap();
        let d = diff(&base, &variant);
        assert_eq!(d.bytes.len_after, d.bytes.len_before + 5);
        // The appended payload shows as a changed tail range ending at the new length.
        assert!(d.bytes.changed.iter().any(|r| r.end == d.bytes.len_after));
        // A new "Payload" layer is Added.
        assert!(d.layers.iter().any(|l| l.name == "Payload" && l.status == LayerStatus::Added));
    }
}
