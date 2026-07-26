//! In-memory undo/redo via reversible byte-diff edits.
//!
//! Each [`Edit`] records the byte span it touched plus the `before`/`after` bytes, so it can be
//! replayed in either direction. History is a session concern and is **not** serialized in Phase
//! 1. (The interactive GUI will drive it; the CLI does not need it, but the model belongs here.)

use crate::PacketBuffer;

/// A reversible edit to a contiguous byte span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    pub offset: usize,
    pub before: Vec<u8>,
    pub after: Vec<u8>,
}

/// Undo/redo stacks over a [`PacketBuffer`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EditHistory {
    undo: Vec<Edit>,
    redo: Vec<Edit>,
}

impl EditHistory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Record an already-applied edit. Clears the redo stack (a new edit forks history).
    pub fn record(&mut self, edit: Edit) {
        self.redo.clear();
        self.undo.push(edit);
    }

    /// Revert the most recent edit, writing its `before` bytes back. Returns `false` if there is
    /// nothing to undo or the edit no longer fits the buffer.
    pub fn undo(&mut self, buffer: &mut PacketBuffer) -> bool {
        match self.undo.pop() {
            Some(edit) => {
                if apply(buffer, edit.offset, &edit.before) {
                    self.redo.push(edit);
                    true
                } else {
                    self.undo.push(edit);
                    false
                }
            }
            None => false,
        }
    }

    /// Re-apply the most recently undone edit. Returns `false` if there is nothing to redo or the
    /// edit no longer fits the buffer.
    pub fn redo(&mut self, buffer: &mut PacketBuffer) -> bool {
        match self.redo.pop() {
            Some(edit) => {
                if apply(buffer, edit.offset, &edit.after) {
                    self.undo.push(edit);
                    true
                } else {
                    self.redo.push(edit);
                    false
                }
            }
            None => false,
        }
    }
}

/// Write `bytes` at `offset`, returning `false` (without touching the buffer) if the span does
/// not fit — history never panics on a resized buffer.
fn apply(buffer: &mut PacketBuffer, offset: usize, bytes: &[u8]) -> bool {
    let slice = buffer.as_mut_slice();
    let Some(end) = offset.checked_add(bytes.len()) else {
        return false;
    };
    if end > slice.len() {
        return false;
    }
    slice[offset..end].copy_from_slice(bytes);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undo_restores_before_and_redo_reapplies_after() {
        // Simulate: buffer started 0xAA, an edit wrote 0xBB.
        let mut buffer = PacketBuffer::from_bytes([0xBB]);
        let mut history = EditHistory::new();
        history.record(Edit {
            offset: 0,
            before: vec![0xAA],
            after: vec![0xBB],
        });

        assert!(history.undo(&mut buffer));
        assert_eq!(buffer.as_slice(), &[0xAA]);
        assert!(history.can_redo());

        assert!(history.redo(&mut buffer));
        assert_eq!(buffer.as_slice(), &[0xBB]);
    }

    #[test]
    fn recording_clears_the_redo_stack() {
        let mut buffer = PacketBuffer::from_bytes([0x02]);
        let mut history = EditHistory::new();
        history.record(Edit { offset: 0, before: vec![0x01], after: vec![0x02] });
        history.undo(&mut buffer);
        assert!(history.can_redo());

        history.record(Edit { offset: 0, before: vec![0x01], after: vec![0x03] });
        assert!(!history.can_redo(), "a fresh edit must discard the redo stack");
    }

    #[test]
    fn undo_on_empty_history_returns_false() {
        let mut buffer = PacketBuffer::from_bytes([0x00]);
        let mut history = EditHistory::new();
        assert!(!history.undo(&mut buffer));
    }
}
