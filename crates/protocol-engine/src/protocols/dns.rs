//! DNS dissection — **dissect-only**. DNS has variable-length names and RFC 1035 compression
//! pointers, which can't be expressed as a fixed `layer(offset)` layout, so — like the dissector's
//! Raw "Options"/"Payload" regions — DNS produces layers by *reading* the bytes and has no assemble
//! counterpart. Decoded names appear in the layer name (e.g. `"DNS Question: example.com"`); the
//! QNAME / RR NAME fields are opaque `Bytes` over their in-place encoded span (the decoded value
//! depends on bytes outside the field, so it can't be a self-contained FieldKind).
//!
//! Never panics: every read is length-gated, and name decoding is guaranteed to terminate —
//! compression pointers must strictly decrease and are capped.

use packet_core::{BitRange, Field, FieldKind, Layer};

/// The well-known DNS port.
pub const DNS_PORT: u16 = 53;

const HEADER_LEN: usize = 12;
/// Cap on compression-pointer jumps while decoding a single name (a real name never needs many).
const MAX_NAME_JUMPS: usize = 128;

/// The result of decoding a DNS name.
struct NameRead {
    /// Decoded dotted form (following compression pointers).
    text: String,
    /// Bytes the name occupies **in place** at its start — labels until the first pointer's two
    /// bytes, or the terminating zero. This advances the parser; the decoded text does not.
    in_place_len: usize,
    /// Whether the name was well-formed.
    ok: bool,
}

fn be16(bytes: &[u8], at: usize) -> u16 {
    u16::from_be_bytes([bytes[at], bytes[at + 1]])
}

/// Decode a DNS name starting at `start` within the message slice `msg`. Follows compression
/// pointers to build the text; `in_place_len` counts only the bytes at `start`. Terminates always:
/// non-pointer steps advance within a finite slice, and pointer targets must be strictly backward
/// and are jump-capped.
fn read_name(msg: &[u8], start: usize) -> NameRead {
    let mut labels: Vec<String> = Vec::new();
    let mut cur = start;
    let mut in_place_len: Option<usize> = None;
    let mut jumps = 0usize;

    let done = |labels: Vec<String>, in_place: usize, ok: bool| NameRead {
        text: labels.join("."),
        in_place_len: in_place.max(1),
        ok,
    };

    loop {
        if cur >= msg.len() {
            return done(labels, in_place_len.unwrap_or_else(|| cur.saturating_sub(start)), false);
        }
        let b = msg[cur];
        if b == 0 {
            // Lazy: after a backward pointer `cur < start`, so this subtraction must not run when
            // in_place_len is already set (unwrap_or would evaluate it eagerly and underflow).
            let ip = in_place_len.unwrap_or_else(|| (cur + 1).saturating_sub(start));
            return done(labels, ip, true);
        }
        match b & 0xC0 {
            0x00 => {
                let len = b as usize;
                if cur + 1 + len > msg.len() {
                    return done(labels, in_place_len.unwrap_or_else(|| cur.saturating_sub(start)), false);
                }
                labels.push(String::from_utf8_lossy(&msg[cur + 1..cur + 1 + len]).into_owned());
                cur += 1 + len;
            }
            0xC0 => {
                if cur + 1 >= msg.len() {
                    return done(labels, in_place_len.unwrap_or_else(|| cur.saturating_sub(start)), false);
                }
                if in_place_len.is_none() {
                    in_place_len = Some(cur + 2 - start);
                }
                let target = (((b & 0x3F) as usize) << 8) | msg[cur + 1] as usize;
                jumps += 1;
                // Strictly-backward pointers can't cycle; the jump cap is a second stop.
                if jumps > MAX_NAME_JUMPS || target >= cur {
                    return done(labels, in_place_len.unwrap(), false);
                }
                cur = target;
            }
            // 0x40 / 0x80 are reserved label types — malformed.
            _ => return done(labels, in_place_len.unwrap_or_else(|| cur.saturating_sub(start)), false),
        }
    }
}

/// The DNS-over-TCP 2-byte length prefix.
fn length_layer(off: usize) -> Layer {
    Layer::new(
        "DNS Length",
        BitRange::bytes(off, 2),
        vec![Field::new("MessageLength", BitRange::bytes(off, 2), FieldKind::Uint)],
    )
}

/// The 12-byte DNS header, with the flags word split into its disjoint sub-bit fields.
fn header_layer(off: usize) -> Layer {
    let bit = off * 8;
    Layer::new(
        "DNS Header",
        BitRange::bytes(off, HEADER_LEN),
        vec![
            Field::new("TransactionId", BitRange::bytes(off, 2), FieldKind::Uint),
            Field::new("QR", BitRange::new(bit + 16, 1), FieldKind::Uint),
            Field::new("Opcode", BitRange::new(bit + 17, 4), FieldKind::Uint),
            Field::new("AA", BitRange::new(bit + 21, 1), FieldKind::Uint),
            Field::new("TC", BitRange::new(bit + 22, 1), FieldKind::Uint),
            Field::new("RD", BitRange::new(bit + 23, 1), FieldKind::Uint),
            Field::new("RA", BitRange::new(bit + 24, 1), FieldKind::Uint),
            Field::new("Z", BitRange::new(bit + 25, 3), FieldKind::Uint),
            Field::new("RCODE", BitRange::new(bit + 28, 4), FieldKind::Uint),
            Field::new("QDCOUNT", BitRange::bytes(off + 4, 2), FieldKind::Uint),
            Field::new("ANCOUNT", BitRange::bytes(off + 6, 2), FieldKind::Uint),
            Field::new("NSCOUNT", BitRange::bytes(off + 8, 2), FieldKind::Uint),
            Field::new("ARCOUNT", BitRange::bytes(off + 10, 2), FieldKind::Uint),
        ],
    )
}

fn question_layer(start: usize, qname_len: usize, name: &str) -> Layer {
    Layer::new(
        format!("DNS Question: {name}"),
        BitRange::bytes(start, qname_len + 4),
        vec![
            Field::new("QName", BitRange::bytes(start, qname_len), FieldKind::Bytes),
            Field::new("QType", BitRange::bytes(start + qname_len, 2), FieldKind::Uint),
            Field::new("QClass", BitRange::bytes(start + qname_len + 2, 2), FieldKind::Uint),
        ],
    )
}

fn rr_layer(start: usize, name_len: usize, rdlength: usize, kind: &str, name: &str) -> Layer {
    let mut fields = vec![
        Field::new("Name", BitRange::bytes(start, name_len), FieldKind::Bytes),
        Field::new("Type", BitRange::bytes(start + name_len, 2), FieldKind::Uint),
        Field::new("Class", BitRange::bytes(start + name_len + 2, 2), FieldKind::Uint),
        Field::new("TTL", BitRange::bytes(start + name_len + 4, 4), FieldKind::Uint),
        Field::new("RdLength", BitRange::bytes(start + name_len + 8, 2), FieldKind::Uint),
    ];
    if rdlength > 0 {
        fields.push(Field::new("RData", BitRange::bytes(start + name_len + 10, rdlength), FieldKind::Bytes));
    }
    Layer::new(format!("DNS {kind}: {name}"), BitRange::bytes(start, name_len + 10 + rdlength), fields)
}

/// Dissect a DNS message at `payload_off` into `layers`. `over_tcp` prepends the 2-byte length
/// prefix (DNS-over-TCP); UDP has none. Section counts are bounded by the finite buffer (an inflated
/// count stops when the cursor runs out), so no unbounded work.
pub fn dissect_into(bytes: &[u8], payload_off: usize, over_tcp: bool, layers: &mut Vec<Layer>) {
    let msg_start = if over_tcp {
        layers.push(length_layer(payload_off));
        payload_off + 2
    } else {
        payload_off
    };

    if msg_start + HEADER_LEN > bytes.len() {
        // Emit the fixed header layout regardless; `validate` flags the out-of-bounds fields.
        layers.push(header_layer(msg_start));
        return;
    }
    let msg = &bytes[msg_start..];
    layers.push(header_layer(msg_start));
    let qd = be16(msg, 4) as usize;
    let an = be16(msg, 6) as usize;
    let ns = be16(msg, 8) as usize;
    let ar = be16(msg, 10) as usize;

    let mut cursor = HEADER_LEN;

    for _ in 0..qd {
        if cursor >= msg.len() {
            return;
        }
        let name = read_name(msg, cursor);
        layers.push(question_layer(msg_start + cursor, name.in_place_len, &name.text));
        cursor += name.in_place_len + 4;
        if !name.ok || cursor > msg.len() {
            return;
        }
    }

    for (count, kind) in [(an, "Answer"), (ns, "Authority"), (ar, "Additional")] {
        for _ in 0..count {
            if cursor >= msg.len() {
                return;
            }
            let name = read_name(msg, cursor);
            let name_len = name.in_place_len;
            if cursor + name_len + 10 > msg.len() {
                // Not enough bytes for the fixed RR fields — emit a best-effort (rdata-less) layer.
                layers.push(rr_layer(msg_start + cursor, name_len, 0, kind, &name.text));
                return;
            }
            let rdlength = be16(msg, cursor + name_len + 8) as usize;
            layers.push(rr_layer(msg_start + cursor, name_len, rdlength, kind, &name.text));
            cursor += name_len + 10 + rdlength;
            if !name.ok || cursor > msg.len() {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 07 "example" 03 "com" 00
    const EXAMPLE_COM: &[u8] = &[7, b'e', b'x', b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0];

    #[test]
    fn reads_a_simple_name() {
        let r = read_name(EXAMPLE_COM, 0);
        assert!(r.ok);
        assert_eq!(r.text, "example.com");
        assert_eq!(r.in_place_len, EXAMPLE_COM.len()); // 13 bytes including the terminator
    }

    #[test]
    fn follows_a_compression_pointer_but_counts_in_place_bytes() {
        // [example.com at 0..13][pointer 0xC000 at 13..15]
        let mut msg = EXAMPLE_COM.to_vec();
        msg.push(0xC0);
        msg.push(0x00);
        let r = read_name(&msg, 13);
        assert!(r.ok);
        assert_eq!(r.text, "example.com"); // decoded via the pointer
        assert_eq!(r.in_place_len, 2); // but only the 2 pointer bytes are consumed in place
    }

    #[test]
    fn a_self_or_forward_pointer_is_malformed_and_terminates() {
        // A pointer at offset 0 targeting offset 0 (not strictly backward).
        let r = read_name(&[0xC0, 0x00], 0);
        assert!(!r.ok);
        // A pointer targeting a forward offset.
        let r2 = read_name(&[0xC0, 0x05, 0, 0, 0, 0], 0);
        assert!(!r2.ok);
    }

    #[test]
    fn a_label_running_past_the_buffer_is_malformed() {
        let r = read_name(&[9, b'a', b'b'], 0); // claims 9 bytes, only 2 present
        assert!(!r.ok);
    }

    #[test]
    fn dissects_a_query_into_header_plus_question() {
        let mut m = vec![0xdb, 0x42, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        m.extend_from_slice(EXAMPLE_COM); // question name at offset 12
        m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // QTYPE A, QCLASS IN
        let mut layers = Vec::new();
        dissect_into(&m, 0, false, &mut layers);
        let names: Vec<&str> = layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["DNS Header", "DNS Question: example.com"]);
    }

    #[test]
    fn dissects_a_response_with_a_compressed_answer_name() {
        let mut m = vec![0xdb, 0x42, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
        m.extend_from_slice(EXAMPLE_COM); // question name at offset 12
        m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // QTYPE/QCLASS
        m.extend_from_slice(&[0xC0, 0x0C]); // answer NAME = pointer to offset 12
        m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // TYPE A, CLASS IN
        m.extend_from_slice(&[0x00, 0x00, 0x01, 0x2c]); // TTL 300
        m.extend_from_slice(&[0x00, 0x04]); // RDLENGTH 4
        m.extend_from_slice(&[93, 184, 216, 34]); // RDATA (an A record)
        let mut layers = Vec::new();
        dissect_into(&m, 0, false, &mut layers);
        let names: Vec<&str> = layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["DNS Header", "DNS Question: example.com", "DNS Answer: example.com"]);
        let answer = layers.iter().find(|l| l.name.starts_with("DNS Answer")).unwrap();
        // The compressed name is 2 in-place bytes, and RDATA is present.
        assert_eq!(answer.field("Name").unwrap().range.len_bits, 16);
        assert!(answer.field("RData").is_some());
    }

    #[test]
    fn over_tcp_emits_a_length_prefix_layer() {
        let mut m = vec![0x00, 0x1c]; // 2-byte TCP length prefix
        m.extend_from_slice(&[0xdb, 0x42, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        m.extend_from_slice(EXAMPLE_COM);
        m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
        let mut layers = Vec::new();
        dissect_into(&m, 0, true, &mut layers);
        let names: Vec<&str> = layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["DNS Length", "DNS Header", "DNS Question: example.com"]);
    }
}
