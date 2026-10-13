//! The engine's outbox: MIDI events a DSP pushes during a block, for the world outside the engine.

/// Events one block can hold; more are dropped and counted.
const CAPACITY: usize = 1024;

/// Two u32 words per event: `node << 16 | offset`, then the three bytes packed little-endian.
/// Allocated once with the `Ctx`; the engine clears it at the start of each block.
pub struct EventBox {
    words: Box<[u32]>,
    len: usize,
    node: usize,
    dropped: u32,
}

impl EventBox {
    pub const CAPACITY: usize = CAPACITY;

    pub fn new() -> Self {
        EventBox {
            words: vec![0; CAPACITY * 2].into_boxed_slice(),
            len: 0,
            node: 0,
            dropped: 0,
        }
    }

    /// The node whose DSP runs next (the engine sets it, so a DSP doesn't pass it).
    pub(crate) fn set_node(&mut self, node: usize) {
        self.node = node;
    }

    /// Append an event at `offset` samples into the block, or drop it when the box is full.
    pub fn push(&mut self, offset: usize, bytes: [u8; 3]) {
        if self.len == CAPACITY {
            self.dropped = self.dropped.wrapping_add(1);
            return;
        }
        let at = self.len * 2;
        self.words[at] = (self.node as u32) << 16 | offset as u32 & 0xFFFF;
        self.words[at + 1] =
            u32::from(bytes[0]) | u32::from(bytes[1]) << 8 | u32::from(bytes[2]) << 16;
        self.len += 1;
    }

    pub(crate) fn clear(&mut self) {
        self.len = 0;
    }

    /// This block's events, two words each, in push order.
    pub fn words(&self) -> &[u32] {
        &self.words[..self.len * 2]
    }

    /// Events dropped since the engine was made.
    pub fn dropped(&self) -> u32 {
        self.dropped
    }
}

impl Default for EventBox {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overflow_drops_and_counts() {
        let mut b = EventBox::new();
        for _ in 0..=EventBox::CAPACITY {
            b.push(0, [0x90, 60, 100]);
        }
        assert_eq!(b.words().len(), EventBox::CAPACITY * 2);
        assert_eq!(b.dropped(), 1);
    }

    #[test]
    fn push_order_and_packing() {
        let mut b = EventBox::new();
        b.set_node(3);
        b.push(127, [0x91, 61, 99]);
        b.set_node(5);
        b.push(0, [0x80, 0, 0]);
        assert_eq!(
            b.words(),
            &[3 << 16 | 127, 0x91 | 61 << 8 | 99 << 16, 5 << 16, 0x80]
        );
    }

    #[test]
    fn the_box_clears_each_block() {
        let mut b = EventBox::new();
        b.push(1, [0x90, 60, 100]);
        b.clear();
        assert!(b.words().is_empty());
        b.push(2, [0x90, 60, 100]);
        assert_eq!(b.words().len(), 2);
    }
}
