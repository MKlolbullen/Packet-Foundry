//! The `Operation` IR — the "boxes" of Packet Foundry.
//!
//! Every derived value (a checksum, a length field) is expressed as an `Operation`: a tree that
//! either is a primitive or bundles smaller `Operation`s. This is the seed of the eventual
//! drag-and-drop box language; the evaluator lives in the `protocol-engine` crate.
//!
//! Phase 1 evaluates the primitives needed to assemble real packets (constants, range reads,
//! concatenation, bitwise ops and shifts, the internet checksum, and buffer-relative lengths).
//! The remaining variants — integer arithmetic and the control-flow / call boxes — are
//! **reserved**: they round-trip through serialization but the evaluator rejects them until a
//! later phase gives them defined semantics.

use serde::{Deserialize, Serialize};

use crate::BitRange;

/// A composable operation over a packet buffer. Produces a byte string when evaluated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Operation {
    // ---- evaluated in Phase 1 ----
    /// A fixed byte string.
    Const(Vec<u8>),
    /// Read a byte-aligned range of the buffer as raw bytes.
    ReadRange(BitRange),
    /// Read from a byte offset to the end of the buffer (layout-relative; stays correct as the
    /// payload grows). Used for variable-length spans like the TCP segment.
    ReadFrom { from_byte: usize },
    /// Concatenate the results of several operations.
    Concat(Vec<Operation>),
    /// Bitwise AND of two byte strings (shorter operand left-padded with zeros).
    And(Box<Operation>, Box<Operation>),
    /// Bitwise OR of two byte strings (shorter operand left-padded with zeros).
    Or(Box<Operation>, Box<Operation>),
    /// Bitwise XOR of two byte strings (shorter operand left-padded with zeros).
    Xor(Box<Operation>, Box<Operation>),
    /// Bitwise NOT of a byte string.
    Not(Box<Operation>),
    /// Left shift by `bits`, treating the byte string as one big-endian integer: bits shifted
    /// past the most-significant end are dropped, the result stays the same length.
    Shl(Box<Operation>, u32),
    /// Right shift by `bits` (see [`Operation::Shl`] for the big-endian model).
    Shr(Box<Operation>, u32),
    /// The 16-bit one's-complement "internet" checksum over the concatenated operands, returned
    /// as 2 big-endian bytes. The classic checksum box (IPv4 header, TCP, UDP, ICMP).
    OnesComplementSum(Vec<Operation>),
    /// The number of bytes from `from_byte` to the end of the buffer, as `width` big-endian
    /// bytes. Used for IPv4 Total Length and the TCP pseudo-header length.
    ByteLength { from_byte: usize, width: usize },
    /// A named wrapper around another operation — a reusable "box" whose body is transparent to
    /// the evaluator but carries a label for the UI. (Checksums are authored as composites.)
    Composite { name: String, body: Box<Operation> },

    // ---- reserved: parsed & serialized, but not yet evaluated ----
    /// Reserved: integer addition (needs a defined width/endianness model).
    Add(Box<Operation>, Box<Operation>),
    /// Reserved: integer subtraction.
    Sub(Box<Operation>, Box<Operation>),
    /// Reserved: repeat `body` `count` times (the loop box).
    Loop { count: Box<Operation>, body: Box<Operation> },
    /// Reserved: conditional (the if box).
    If {
        cond: Box<Operation>,
        then_branch: Box<Operation>,
        else_branch: Box<Operation>,
    },
    /// Reserved: invoke a named, user-defined box from a library.
    Call { name: String },
}

impl Operation {
    /// Whether this variant is a reserved box that the Phase 1 evaluator cannot execute.
    pub fn is_reserved(&self) -> bool {
        matches!(
            self,
            Operation::Add(..)
                | Operation::Sub(..)
                | Operation::Loop { .. }
                | Operation::If { .. }
                | Operation::Call { .. }
        )
    }

    /// Convenience: the internet-checksum box, named for display.
    pub fn internet_checksum(parts: Vec<Operation>) -> Operation {
        Operation::Composite {
            name: "internet_checksum".to_string(),
            body: Box::new(Operation::OnesComplementSum(parts)),
        }
    }
}
