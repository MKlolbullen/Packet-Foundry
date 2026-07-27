//! The evaluator — the "resolve" pass of the assembler.
//!
//! [`evaluate`] walks an [`Operation`] tree and produces the byte string it denotes, reading from
//! the authoritative [`PacketBuffer`]. Reserved variants (arithmetic, shifts, control flow, calls)
//! return [`EngineError::Unsupported`]: they round-trip through serialization but have no defined
//! semantics yet.

use packet_core::{CoreError, Operation, PacketBuffer};
use thiserror::Error;

/// Errors from evaluating or resolving operations.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EngineError {
    #[error("bit-level access failed: {0}")]
    Core(#[from] CoreError),
    #[error("operation `{0}` is reserved and not yet evaluable")]
    Unsupported(&'static str),
    #[error("`ReadFrom` offset {from_byte} is past the {buffer_len}-byte buffer")]
    ReadFromPastEnd { from_byte: usize, buffer_len: usize },
    #[error("length {value} does not fit in {width} big-endian byte(s)")]
    LengthOverflow { value: u64, width: usize },
    #[error("length width {width} exceeds 8 bytes")]
    WidthTooLarge { width: usize },
    #[error("assembly error: {0}")]
    Assembly(&'static str),
}

/// Evaluate an operation against the buffer, producing its byte string.
pub fn evaluate(op: &Operation, buffer: &PacketBuffer) -> Result<Vec<u8>, EngineError> {
    match op {
        Operation::Const(bytes) => Ok(bytes.clone()),
        Operation::ReadRange(range) => Ok(buffer.read_bytes(*range)?),
        Operation::ReadFrom { from_byte } => {
            let len = buffer.len();
            if *from_byte > len {
                return Err(EngineError::ReadFromPastEnd {
                    from_byte: *from_byte,
                    buffer_len: len,
                });
            }
            Ok(buffer.as_slice()[*from_byte..].to_vec())
        }
        Operation::Concat(parts) => concat(parts, buffer),
        Operation::And(a, b) => bitwise(a, b, buffer, |x, y| x & y),
        Operation::Or(a, b) => bitwise(a, b, buffer, |x, y| x | y),
        Operation::Xor(a, b) => bitwise(a, b, buffer, |x, y| x ^ y),
        Operation::Not(a) => Ok(evaluate(a, buffer)?.iter().map(|b| !b).collect()),
        Operation::OnesComplementSum(parts) => Ok(internet_checksum(&concat(parts, buffer)?).to_vec()),
        Operation::ByteLength { from_byte, width } => {
            let len = buffer.len().saturating_sub(*from_byte) as u64;
            be_bytes(len, *width)
        }
        Operation::Composite { body, .. } => evaluate(body, buffer),

        Operation::Add(..) => Err(EngineError::Unsupported("Add")),
        Operation::Sub(..) => Err(EngineError::Unsupported("Sub")),
        Operation::Shl(..) => Err(EngineError::Unsupported("Shl")),
        Operation::Shr(..) => Err(EngineError::Unsupported("Shr")),
        Operation::Loop { .. } => Err(EngineError::Unsupported("Loop")),
        Operation::If { .. } => Err(EngineError::Unsupported("If")),
        Operation::Call { .. } => Err(EngineError::Unsupported("Call")),
    }
}

/// Concatenate the byte strings of several operations.
fn concat(parts: &[Operation], buffer: &PacketBuffer) -> Result<Vec<u8>, EngineError> {
    let mut out = Vec::new();
    for part in parts {
        out.extend(evaluate(part, buffer)?);
    }
    Ok(out)
}

/// Element-wise bitwise op, left-padding the shorter operand with zeros.
fn bitwise(
    a: &Operation,
    b: &Operation,
    buffer: &PacketBuffer,
    f: impl Fn(u8, u8) -> u8,
) -> Result<Vec<u8>, EngineError> {
    let x = evaluate(a, buffer)?;
    let y = evaluate(b, buffer)?;
    let n = x.len().max(y.len());
    let xp = left_pad(&x, n);
    let yp = left_pad(&y, n);
    Ok(xp.iter().zip(yp.iter()).map(|(&p, &q)| f(p, q)).collect())
}

fn left_pad(v: &[u8], n: usize) -> Vec<u8> {
    if v.len() >= n {
        return v.to_vec();
    }
    let mut out = vec![0u8; n - v.len()];
    out.extend_from_slice(v);
    out
}

/// The 16-bit one's-complement "internet" checksum (RFC 1071), returned big-endian.
fn internet_checksum(data: &[u8]) -> [u8; 2] {
    let mut sum: u32 = 0;
    let mut chunks = data.chunks_exact(2);
    for chunk in &mut chunks {
        sum += u32::from(u16::from_be_bytes([chunk[0], chunk[1]]));
    }
    if let [last] = chunks.remainder() {
        sum += u32::from(u16::from_be_bytes([*last, 0]));
    }
    while (sum >> 16) != 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    (!(sum as u16)).to_be_bytes()
}

/// Encode `value` as `width` big-endian bytes, erroring if it does not fit.
fn be_bytes(value: u64, width: usize) -> Result<Vec<u8>, EngineError> {
    if width > 8 {
        return Err(EngineError::WidthTooLarge { width });
    }
    if width < 8 && value >= (1u64 << (width * 8)) {
        return Err(EngineError::LengthOverflow { value, width });
    }
    Ok(value.to_be_bytes()[8 - width..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use packet_core::BitRange;

    fn buf(bytes: &[u8]) -> PacketBuffer {
        PacketBuffer::from_bytes(bytes.to_vec())
    }

    #[test]
    fn const_returns_its_bytes() {
        assert_eq!(evaluate(&Operation::Const(vec![1, 2, 3]), &buf(&[])).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn read_range_reads_bytes() {
        let b = buf(&[0xDE, 0xAD, 0xBE, 0xEF]);
        assert_eq!(evaluate(&Operation::ReadRange(BitRange::bytes(1, 2)), &b).unwrap(), vec![0xAD, 0xBE]);
    }

    #[test]
    fn read_from_reads_tail() {
        let b = buf(&[1, 2, 3, 4]);
        assert_eq!(evaluate(&Operation::ReadFrom { from_byte: 2 }, &b).unwrap(), vec![3, 4]);
    }

    #[test]
    fn read_from_past_end_errors() {
        let b = buf(&[1, 2]);
        assert_eq!(
            evaluate(&Operation::ReadFrom { from_byte: 3 }, &b).unwrap_err(),
            EngineError::ReadFromPastEnd { from_byte: 3, buffer_len: 2 }
        );
    }

    #[test]
    fn concat_joins_parts() {
        let op = Operation::Concat(vec![Operation::Const(vec![0xAA]), Operation::Const(vec![0xBB, 0xCC])]);
        assert_eq!(evaluate(&op, &buf(&[])).unwrap(), vec![0xAA, 0xBB, 0xCC]);
    }

    #[test]
    fn xor_combines_equal_length_operands() {
        let op = Operation::Xor(
            Box::new(Operation::Const(vec![0xF0, 0x0F])),
            Box::new(Operation::Const(vec![0xFF, 0xFF])),
        );
        assert_eq!(evaluate(&op, &buf(&[])).unwrap(), vec![0x0F, 0xF0]);
    }

    #[test]
    fn xor_left_pads_shorter_operand() {
        // [0x01] XOR [0x00,0x01] == [0x00,0x00]
        let op = Operation::Xor(
            Box::new(Operation::Const(vec![0x01])),
            Box::new(Operation::Const(vec![0x00, 0x01])),
        );
        assert_eq!(evaluate(&op, &buf(&[])).unwrap(), vec![0x00, 0x00]);
    }

    #[test]
    fn not_complements_bytes() {
        let op = Operation::Not(Box::new(Operation::Const(vec![0x0F, 0xAA])));
        assert_eq!(evaluate(&op, &buf(&[])).unwrap(), vec![0xF0, 0x55]);
    }

    #[test]
    fn ones_complement_sum_matches_known_ipv4_vector() {
        // Canonical IPv4 header (checksum field zeroed) → checksum 0xB861.
        let header = vec![
            0x45, 0x00, 0x00, 0x73, 0x00, 0x00, 0x40, 0x00, 0x40, 0x11, 0x00, 0x00, 0xC0, 0xA8,
            0x00, 0x01, 0xC0, 0xA8, 0x00, 0xC7,
        ];
        let op = Operation::OnesComplementSum(vec![Operation::Const(header)]);
        assert_eq!(evaluate(&op, &buf(&[])).unwrap(), vec![0xB8, 0x61]);
    }

    #[test]
    fn byte_length_measures_to_end_of_buffer() {
        let b = buf(&[0u8; 20]);
        let op = Operation::ByteLength { from_byte: 0, width: 2 };
        assert_eq!(evaluate(&op, &b).unwrap(), vec![0x00, 0x14]);
    }

    #[test]
    fn byte_length_overflow_errors() {
        let b = buf(&[0u8; 300]);
        let op = Operation::ByteLength { from_byte: 0, width: 1 };
        assert_eq!(
            evaluate(&op, &b).unwrap_err(),
            EngineError::LengthOverflow { value: 300, width: 1 }
        );
    }

    #[test]
    fn composite_is_transparent() {
        let op = Operation::Composite {
            name: "wrap".into(),
            body: Box::new(Operation::Const(vec![0x42])),
        };
        assert_eq!(evaluate(&op, &buf(&[])).unwrap(), vec![0x42]);
    }

    #[test]
    fn reserved_ops_are_unsupported() {
        let op = Operation::Call { name: "foo".into() };
        assert_eq!(evaluate(&op, &buf(&[])).unwrap_err(), EngineError::Unsupported("Call"));
    }
}
