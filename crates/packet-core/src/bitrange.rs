//! Bit-level addressing and mutation — the core primitive of Packet Foundry.
//!
//! A [`BitRange`] names a contiguous run of bits inside a byte buffer, addressed **MSB-first
//! in network (big-endian) order**: `start_bit` 0 is the most-significant bit of byte 0. All
//! reads and writes are **strictly bounds-checked** and never panic — out-of-range access
//! returns a [`CoreError`] instead. This is the layer everything else stands on, so it is the
//! most heavily tested.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// A contiguous run of bits within a byte buffer (MSB-first, network order).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BitRange {
    /// Index of the first bit, where bit 0 is the MSB of byte 0.
    pub start_bit: usize,
    /// Number of bits in the range.
    pub len_bits: usize,
}

/// Errors from bit-level access. Every fallible `packet-core` operation returns one of these
/// rather than panicking.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CoreError {
    #[error("bit range (start={start}, len={len}) exceeds buffer of {buf_bits} bits")]
    OutOfBounds {
        start: usize,
        len: usize,
        buf_bits: usize,
    },
    #[error("bit range length {len} exceeds the 64-bit scalar limit")]
    RangeTooWide { len: usize },
    #[error("value {value:#x} does not fit in {len} bits")]
    ValueTooWide { value: u64, len: usize },
    #[error("bit range (start={start}, len={len}) overflows usize")]
    OffsetOverflow { start: usize, len: usize },
    #[error("bit range (start={start}, len={len}) is not byte-aligned")]
    NotByteAligned { start: usize, len: usize },
    #[error("byte slice length {got} does not match range length {expected} bytes")]
    LengthMismatch { expected: usize, got: usize },
}

/// Fold a byte slice into a `u64`, big-endian. Callers must ensure `bytes.len() <= 8`.
fn fold_big_endian(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0u64, |acc, &b| (acc << 8) | u64::from(b))
}

impl BitRange {
    /// A range of `len_bits` bits starting at `start_bit`.
    pub const fn new(start_bit: usize, len_bits: usize) -> Self {
        Self { start_bit, len_bits }
    }

    /// A byte-aligned range: `len_bytes` bytes starting at byte `start_byte`.
    pub const fn bytes(start_byte: usize, len_bytes: usize) -> Self {
        Self {
            start_bit: start_byte * 8,
            len_bits: len_bytes * 8,
        }
    }

    /// The exclusive end bit index, or an error if `start + len` overflows `usize`.
    fn end_bit(self) -> Result<usize, CoreError> {
        self.start_bit
            .checked_add(self.len_bits)
            .ok_or(CoreError::OffsetOverflow {
                start: self.start_bit,
                len: self.len_bits,
            })
    }

    /// Verify the range fits within a buffer of `buf_len` bytes.
    fn check_bounds(self, buf_len: usize) -> Result<(), CoreError> {
        let end = self.end_bit()?;
        let buf_bits = buf_len.checked_mul(8).ok_or(CoreError::OffsetOverflow {
            start: self.start_bit,
            len: self.len_bits,
        })?;
        if end > buf_bits {
            return Err(CoreError::OutOfBounds {
                start: self.start_bit,
                len: self.len_bits,
                buf_bits,
            });
        }
        Ok(())
    }

    fn require_byte_aligned(self) -> Result<(), CoreError> {
        if self.start_bit % 8 != 0 || self.len_bits % 8 != 0 {
            return Err(CoreError::NotByteAligned {
                start: self.start_bit,
                len: self.len_bits,
            });
        }
        Ok(())
    }

    /// Read the range as an unsigned integer (up to 64 bits), MSB-first.
    pub fn read_uint(self, buf: &[u8]) -> Result<u64, CoreError> {
        if self.len_bits > 64 {
            return Err(CoreError::RangeTooWide { len: self.len_bits });
        }
        self.check_bounds(buf.len())?;
        let mut val: u64 = 0;
        for i in self.start_bit..self.start_bit + self.len_bits {
            let bit = (buf[i / 8] >> (7 - (i % 8))) & 1;
            val = (val << 1) | u64::from(bit);
        }
        Ok(val)
    }

    /// Write the low `len_bits` of `value` into the range, MSB-first, preserving surrounding
    /// bits. Errors (leaving the buffer untouched) if `value` does not fit in `len_bits`.
    pub fn write_uint(self, buf: &mut [u8], value: u64) -> Result<(), CoreError> {
        if self.len_bits > 64 {
            return Err(CoreError::RangeTooWide { len: self.len_bits });
        }
        self.check_bounds(buf.len())?;
        if self.len_bits < 64 && value >= (1u64 << self.len_bits) {
            return Err(CoreError::ValueTooWide {
                value,
                len: self.len_bits,
            });
        }
        for (k, i) in (self.start_bit..self.start_bit + self.len_bits).enumerate() {
            let bit = ((value >> (self.len_bits - 1 - k)) & 1) as u8;
            let idx = i / 8;
            let shift = 7 - (i % 8);
            if bit == 1 {
                buf[idx] |= 1u8 << shift;
            } else {
                buf[idx] &= !(1u8 << shift);
            }
        }
        Ok(())
    }

    /// Read a byte-aligned range as raw bytes.
    pub fn read_bytes(self, buf: &[u8]) -> Result<Vec<u8>, CoreError> {
        self.require_byte_aligned()?;
        self.check_bounds(buf.len())?;
        let start = self.start_bit / 8;
        Ok(buf[start..start + self.len_bits / 8].to_vec())
    }

    /// Write raw bytes into a byte-aligned range (length must match exactly).
    pub fn write_bytes(self, buf: &mut [u8], bytes: &[u8]) -> Result<(), CoreError> {
        self.require_byte_aligned()?;
        if bytes.len() * 8 != self.len_bits {
            return Err(CoreError::LengthMismatch {
                expected: self.len_bits / 8,
                got: bytes.len(),
            });
        }
        self.check_bounds(buf.len())?;
        let start = self.start_bit / 8;
        buf[start..start + bytes.len()].copy_from_slice(bytes);
        Ok(())
    }

    /// Validate that `bytes` is applicable to this range in a buffer of `buf_len` bytes, without
    /// writing — the exact rules `write_field_bytes` enforces, as a pure predicate. Byte-aligned
    /// ranges require the exact byte length; any other range requires `len_bits <= 64` and
    /// `bytes.len() == len_bits.div_ceil(8)` with the folded big-endian value fitting in
    /// `len_bits`.
    pub fn check_field_bytes(self, bytes: &[u8], buf_len: usize) -> Result<(), CoreError> {
        if self.start_bit % 8 == 0 && self.len_bits % 8 == 0 {
            if bytes.len() * 8 != self.len_bits {
                return Err(CoreError::LengthMismatch {
                    expected: self.len_bits / 8,
                    got: bytes.len(),
                });
            }
            self.check_bounds(buf_len)
        } else {
            // Width and byte-count checks must precede the fold — folding more than 8 bytes
            // would silently shift the high bytes out of the u64.
            if self.len_bits > 64 {
                return Err(CoreError::RangeTooWide { len: self.len_bits });
            }
            if bytes.len() != self.len_bits.div_ceil(8) {
                return Err(CoreError::LengthMismatch {
                    expected: self.len_bits.div_ceil(8),
                    got: bytes.len(),
                });
            }
            self.check_bounds(buf_len)?;
            let value = fold_big_endian(bytes);
            if self.len_bits < 64 && value >= (1u64 << self.len_bits) {
                return Err(CoreError::ValueTooWide {
                    value,
                    len: self.len_bits,
                });
            }
            Ok(())
        }
    }

    /// Write a field-sized byte array into this range — byte-aligned ranges take the bytes
    /// verbatim (`write_bytes` semantics, exact length); sub-byte/unaligned ranges interpret
    /// them as a big-endian value packed right-aligned into `ceil(len_bits/8)` bytes and write
    /// via `write_uint` (preserving surrounding bits). Matches the convention descriptor
    /// defaults already use for sub-byte fields — see protocol-engine's `write_default`.
    pub fn write_field_bytes(self, buf: &mut [u8], bytes: &[u8]) -> Result<(), CoreError> {
        self.check_field_bytes(bytes, buf.len())?;
        if self.start_bit % 8 == 0 && self.len_bits % 8 == 0 {
            self.write_bytes(buf, bytes)
        } else {
            self.write_uint(buf, fold_big_endian(bytes))
        }
    }

    /// Whether this range shares any bit position with `other`. A zero-length range contains no
    /// bit positions, so it never overlaps anything, including another zero-length range.
    pub fn overlaps(self, other: BitRange) -> bool {
        if self.len_bits == 0 || other.len_bits == 0 {
            return false;
        }
        let a_end = self.start_bit + self.len_bits;
        let b_end = other.start_bit + other.len_bits;
        self.start_bit < b_end && other.start_bit < a_end
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ---- read_uint ----

    #[test]
    fn reads_a_whole_byte() {
        assert_eq!(BitRange::new(0, 8).read_uint(&[0xAB]).unwrap(), 0xAB);
    }

    #[test]
    fn reads_high_nibble() {
        // IPv4 version nibble of 0x45.
        assert_eq!(BitRange::new(0, 4).read_uint(&[0x45]).unwrap(), 0x4);
    }

    #[test]
    fn reads_low_nibble() {
        // IPv4 IHL nibble of 0x45.
        assert_eq!(BitRange::new(4, 4).read_uint(&[0x45]).unwrap(), 0x5);
    }

    #[test]
    fn reads_across_a_byte_boundary() {
        // bits 4..12 of 0x12,0x34 == 0b0010_0011 == 0x23.
        assert_eq!(BitRange::new(4, 8).read_uint(&[0x12, 0x34]).unwrap(), 0x23);
    }

    #[test]
    fn reads_a_16_bit_word() {
        assert_eq!(BitRange::new(0, 16).read_uint(&[0x12, 0x34]).unwrap(), 0x1234);
    }

    #[test]
    fn reads_full_64_bits() {
        let buf = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        assert_eq!(BitRange::new(0, 64).read_uint(&buf).unwrap(), 0x0102030405060708);
    }

    #[test]
    fn reads_zero_length_as_zero() {
        assert_eq!(BitRange::new(5, 0).read_uint(&[0xFF]).unwrap(), 0);
    }

    #[test]
    fn read_past_end_is_out_of_bounds() {
        let err = BitRange::new(0, 9).read_uint(&[0x00]).unwrap_err();
        assert_eq!(err, CoreError::OutOfBounds { start: 0, len: 9, buf_bits: 8 });
    }

    #[test]
    fn read_starting_past_end_is_out_of_bounds() {
        assert!(matches!(
            BitRange::new(8, 1).read_uint(&[0x00]).unwrap_err(),
            CoreError::OutOfBounds { .. }
        ));
    }

    #[test]
    fn read_wider_than_64_bits_errors() {
        let buf = [0u8; 16];
        assert_eq!(
            BitRange::new(0, 65).read_uint(&buf).unwrap_err(),
            CoreError::RangeTooWide { len: 65 }
        );
    }

    // ---- write_uint ----

    #[test]
    fn writes_two_nibbles_into_one_byte() {
        let mut buf = [0x00];
        BitRange::new(0, 4).write_uint(&mut buf, 0x4).unwrap();
        BitRange::new(4, 4).write_uint(&mut buf, 0x5).unwrap();
        assert_eq!(buf, [0x45]);
    }

    #[test]
    fn writes_across_a_byte_boundary() {
        let mut buf = [0x00, 0x00];
        BitRange::new(4, 8).write_uint(&mut buf, 0x23).unwrap();
        assert_eq!(buf, [0x02, 0x30]);
        assert_eq!(BitRange::new(4, 8).read_uint(&buf).unwrap(), 0x23);
    }

    #[test]
    fn write_preserves_surrounding_bits() {
        let mut buf = [0xFF, 0xFF];
        BitRange::new(4, 8).write_uint(&mut buf, 0x00).unwrap();
        assert_eq!(buf, [0xF0, 0x0F]);
    }

    #[test]
    fn write_value_too_wide_errors() {
        let mut buf = [0x00];
        assert_eq!(
            BitRange::new(0, 4).write_uint(&mut buf, 0x1F).unwrap_err(),
            CoreError::ValueTooWide { value: 0x1F, len: 4 }
        );
        assert_eq!(buf, [0x00], "buffer must be untouched on error");
    }

    #[test]
    fn write_past_end_is_out_of_bounds() {
        let mut buf = [0x00];
        assert!(matches!(
            BitRange::new(0, 9).write_uint(&mut buf, 0).unwrap_err(),
            CoreError::OutOfBounds { .. }
        ));
    }

    #[test]
    fn writes_full_64_bits() {
        let mut buf = [0u8; 8];
        BitRange::new(0, 64).write_uint(&mut buf, 0xDEADBEEFCAFEF00D).unwrap();
        assert_eq!(buf, [0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xF0, 0x0D]);
    }

    // ---- read_bytes / write_bytes ----

    #[test]
    fn reads_byte_aligned_slice() {
        let buf = [0xDE, 0xAD, 0xBE, 0xEF];
        assert_eq!(BitRange::bytes(1, 2).read_bytes(&buf).unwrap(), vec![0xAD, 0xBE]);
    }

    #[test]
    fn read_bytes_unaligned_errors() {
        assert!(matches!(
            BitRange::new(4, 8).read_bytes(&[0x00, 0x00]).unwrap_err(),
            CoreError::NotByteAligned { .. }
        ));
    }

    #[test]
    fn writes_byte_aligned_slice() {
        let mut buf = [0x00, 0x00, 0x00, 0x00];
        BitRange::bytes(1, 2).write_bytes(&mut buf, &[0xAA, 0xBB]).unwrap();
        assert_eq!(buf, [0x00, 0xAA, 0xBB, 0x00]);
    }

    #[test]
    fn write_bytes_length_mismatch_errors() {
        let mut buf = [0x00, 0x00, 0x00];
        assert_eq!(
            BitRange::bytes(1, 2).write_bytes(&mut buf, &[0xAA]).unwrap_err(),
            CoreError::LengthMismatch { expected: 2, got: 1 }
        );
    }

    // ---- field-bytes write: aligned ranges verbatim, sub-byte ranges as right-aligned values

    #[test]
    fn field_bytes_aligned_writes_verbatim() {
        let mut buf = [0x00, 0x00, 0x00, 0x00];
        BitRange::bytes(1, 2).write_field_bytes(&mut buf, &[0xAA, 0xBB]).unwrap();
        assert_eq!(buf, [0x00, 0xAA, 0xBB, 0x00]);
    }

    #[test]
    fn field_bytes_sub_byte_writes_value_and_preserves_neighbours() {
        // The IPv4 Version/IHL byte: set the high nibble to 6, the low nibble (5) must survive.
        let mut buf = [0x45, 0xFF];
        BitRange::new(0, 4).write_field_bytes(&mut buf, &[0x06]).unwrap();
        assert_eq!(buf, [0x65, 0xFF]);
    }

    #[test]
    fn field_bytes_aligned_wrong_length_is_length_mismatch() {
        let mut buf = [0x00, 0x00, 0x00];
        assert_eq!(
            BitRange::bytes(0, 2).write_field_bytes(&mut buf, &[0xAA]).unwrap_err(),
            CoreError::LengthMismatch { expected: 2, got: 1 }
        );
    }

    #[test]
    fn field_bytes_sub_byte_wrong_length_is_length_mismatch() {
        let mut buf = [0x00, 0x00];
        // A 12-bit range needs ceil(12/8) = 2 bytes.
        assert_eq!(
            BitRange::new(4, 12).write_field_bytes(&mut buf, &[0x0F]).unwrap_err(),
            CoreError::LengthMismatch { expected: 2, got: 1 }
        );
    }

    #[test]
    fn field_bytes_sub_byte_overwide_value_errors_untouched() {
        let mut buf = [0x45];
        assert_eq!(
            BitRange::new(0, 4).write_field_bytes(&mut buf, &[0x10]).unwrap_err(),
            CoreError::ValueTooWide { value: 0x10, len: 4 }
        );
        assert_eq!(buf, [0x45]);
    }

    #[test]
    fn field_bytes_unaligned_wider_than_64_bits_errors() {
        let mut buf = [0x00; 16];
        assert!(matches!(
            BitRange::new(4, 72).write_field_bytes(&mut buf, &[0x00; 9]).unwrap_err(),
            CoreError::RangeTooWide { len: 72 }
        ));
    }

    #[test]
    fn check_field_bytes_mirrors_write_without_mutating() {
        let buf = [0x45, 0xFF];
        assert!(BitRange::new(0, 4).check_field_bytes(&[0x06], buf.len()).is_ok());
        assert!(BitRange::new(0, 4).check_field_bytes(&[0x10], buf.len()).is_err());
        assert!(BitRange::bytes(0, 2).check_field_bytes(&[0xAA, 0xBB], buf.len()).is_ok());
        assert!(BitRange::bytes(0, 2).check_field_bytes(&[0xAA], buf.len()).is_err());
        // Out of bounds for the buffer.
        assert!(BitRange::new(12, 8).check_field_bytes(&[0x01], buf.len()).is_err());
    }

    // ---- property: writing a value then reading it back is identity, and bits outside
    //      the range are never disturbed. Seeds are clamped into valid domains in-test.
    proptest! {
        #[test]
        fn write_then_read_roundtrips_and_preserves_neighbours(
            buf in prop::collection::vec(any::<u8>(), 1..16usize),
            start_seed in any::<usize>(),
            len_seed in 0usize..=64,
            value_seed in any::<u64>(),
        ) {
            let total = buf.len() * 8;
            let start = start_seed % total;
            let len = core::cmp::min(len_seed, total - start);
            let mask = match len {
                0 => 0,
                64 => u64::MAX,
                n => (1u64 << n) - 1,
            };
            let value = value_seed & mask;
            let range = BitRange::new(start, len);

            let mut written = buf.clone();
            range.write_uint(&mut written, value).unwrap();
            prop_assert_eq!(range.read_uint(&written).unwrap(), value);

            for i in 0..total {
                if i < start || i >= start + len {
                    let before = (buf[i / 8] >> (7 - i % 8)) & 1;
                    let after = (written[i / 8] >> (7 - i % 8)) & 1;
                    prop_assert_eq!(before, after, "bit {} outside range was modified", i);
                }
            }
        }
    }

    // ---- overlaps ----

    #[test]
    fn disjoint_ranges_do_not_overlap() {
        assert!(!BitRange::new(0, 8).overlaps(BitRange::new(16, 8)));
    }

    #[test]
    fn adjacent_ranges_do_not_overlap() {
        // [0,8) and [8,16) touch at the boundary but share no bit.
        assert!(!BitRange::new(0, 8).overlaps(BitRange::new(8, 8)));
    }

    #[test]
    fn partially_overlapping_ranges_overlap() {
        assert!(BitRange::new(0, 8).overlaps(BitRange::new(4, 8)));
    }

    #[test]
    fn a_range_containing_another_overlaps() {
        assert!(BitRange::new(0, 32).overlaps(BitRange::new(8, 8)));
        assert!(BitRange::new(8, 8).overlaps(BitRange::new(0, 32)));
    }

    #[test]
    fn identical_ranges_overlap() {
        assert!(BitRange::new(4, 12).overlaps(BitRange::new(4, 12)));
    }

    #[test]
    fn zero_length_range_never_overlaps() {
        assert!(!BitRange::new(4, 0).overlaps(BitRange::new(0, 32)));
        assert!(!BitRange::new(4, 0).overlaps(BitRange::new(4, 0)));
    }
}
