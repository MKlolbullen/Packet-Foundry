//! [`PacketBuffer`] — the authoritative byte store, with bit-level accessors delegating to
//! [`BitRange`]. Serializes to/from a hex string so a document round-trips exactly.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{BitRange, CoreError};

/// The canonical bytes of a packet. Everything else in a document is a view over this.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PacketBuffer {
    bytes: Vec<u8>,
}

impl PacketBuffer {
    pub fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    pub fn from_bytes(bytes: impl Into<Vec<u8>>) -> Self {
        Self { bytes: bytes.into() }
    }

    /// A zero-filled buffer of `len` bytes.
    pub fn with_len(len: usize) -> Self {
        Self { bytes: vec![0u8; len] }
    }

    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.bytes
    }

    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.bytes
    }

    /// Read a range as an unsigned integer (up to 64 bits).
    pub fn read_uint(&self, range: BitRange) -> Result<u64, CoreError> {
        range.read_uint(&self.bytes)
    }

    /// Write an unsigned integer into a range.
    pub fn write_uint(&mut self, range: BitRange, value: u64) -> Result<(), CoreError> {
        range.write_uint(&mut self.bytes, value)
    }

    /// Read a byte-aligned range as raw bytes.
    pub fn read_bytes(&self, range: BitRange) -> Result<Vec<u8>, CoreError> {
        range.read_bytes(&self.bytes)
    }

    /// Write raw bytes into a byte-aligned range.
    pub fn write_bytes(&mut self, range: BitRange, bytes: &[u8]) -> Result<(), CoreError> {
        range.write_bytes(&mut self.bytes, bytes)
    }

    /// Write a field-sized byte array into a range, aligned or not — see
    /// [`BitRange::write_field_bytes`].
    pub fn write_field_bytes(&mut self, range: BitRange, bytes: &[u8]) -> Result<(), CoreError> {
        range.write_field_bytes(&mut self.bytes, bytes)
    }

    /// Append bytes to the end of the buffer, returning the byte offset they start at. Used when
    /// stacking layers.
    pub fn append(&mut self, bytes: &[u8]) -> usize {
        let offset = self.bytes.len();
        self.bytes.extend_from_slice(bytes);
        offset
    }
}

impl Serialize for PacketBuffer {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&hex::encode(&self.bytes))
    }
}

impl<'de> Deserialize<'de> for PacketBuffer {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        let bytes = hex::decode(&s).map_err(serde::de::Error::custom)?;
        Ok(Self { bytes })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_uint_delegates_to_bitrange() {
        let buf = PacketBuffer::from_bytes([0x45]);
        assert_eq!(buf.read_uint(BitRange::new(0, 4)).unwrap(), 0x4);
        assert_eq!(buf.read_uint(BitRange::new(4, 4)).unwrap(), 0x5);
    }

    #[test]
    fn write_then_read_roundtrips() {
        let mut buf = PacketBuffer::with_len(2);
        buf.write_uint(BitRange::new(4, 8), 0x23).unwrap();
        assert_eq!(buf.read_uint(BitRange::new(4, 8)).unwrap(), 0x23);
    }

    #[test]
    fn read_write_bytes_roundtrips() {
        let mut buf = PacketBuffer::with_len(4);
        buf.write_bytes(BitRange::bytes(1, 2), &[0xAA, 0xBB]).unwrap();
        assert_eq!(buf.as_slice(), &[0x00, 0xAA, 0xBB, 0x00]);
        assert_eq!(buf.read_bytes(BitRange::bytes(1, 2)).unwrap(), vec![0xAA, 0xBB]);
    }

    #[test]
    fn append_returns_start_offset_and_grows() {
        let mut buf = PacketBuffer::new();
        assert_eq!(buf.append(&[1, 2]), 0);
        assert_eq!(buf.append(&[3]), 2);
        assert_eq!(buf.as_slice(), &[1, 2, 3]);
    }

    #[test]
    fn out_of_bounds_read_is_error_not_panic() {
        let buf = PacketBuffer::with_len(1);
        assert!(buf.read_uint(BitRange::new(0, 9)).is_err());
    }
}
