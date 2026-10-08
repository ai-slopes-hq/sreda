//! The sample pool (spec §7a): decoded samples by id, at the engine's rate, shared by SAMPLER and GRAINS through
//! `Ctx`. Samples arrive between blocks (a message), never inside `process`.

/// One decoded sample: two channels (a mono file has both the same), its hits (position, strength 0…1).
pub struct Sample {
    pub channels: [Vec<f32>; 2],
    pub frames: usize,
    pub hits: Vec<(usize, f32)>,
}

impl Sample {
    /// From planar floats (`channels` × `frames`), then `hits` pairs (position, strength).
    pub fn from_planar(data: &[f32], frames: usize, channels: usize, hits: usize) -> Self {
        let ch = |c: usize| data[c * frames..(c + 1) * frames].to_vec();
        let l = ch(0);
        let r = if channels > 1 { ch(1) } else { l.clone() };
        let h = &data[channels * frames..channels * frames + 2 * hits];
        Sample {
            channels: [l, r],
            frames,
            hits: h
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| (p[0] as usize, p[1]))
                .collect(),
        }
    }
}

#[derive(Default)]
pub struct SamplePool {
    slots: Vec<Option<Sample>>,
}

impl SamplePool {
    /// The sample with this id; −1 (no sample) and ids never inserted give None.
    pub fn get(&self, id: i32) -> Option<&Sample> {
        if id < 0 {
            return None;
        }
        self.slots.get(id as usize)?.as_ref()
    }
    /// Puts a sample under an id, replacing the one there (between blocks: this allocates).
    pub fn insert(&mut self, id: usize, s: Sample) {
        if self.slots.len() <= id {
            self.slots.resize_with(id + 1, || None);
        }
        self.slots[id] = Some(s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_get_and_replace() {
        let mut p = SamplePool::default();
        assert!(p.get(-1).is_none() && p.get(3).is_none());
        p.insert(3, Sample::from_planar(&[0.1, 0.2, 0.3, 5.0, 0.9], 3, 1, 1));
        let s = p.get(3).unwrap();
        assert_eq!(s.channels[0], vec![0.1, 0.2, 0.3]);
        assert_eq!(s.channels[1], s.channels[0], "mono: both channels the same");
        assert_eq!(s.hits, vec![(5, 0.9)]);
        p.insert(3, Sample::from_planar(&[1.0, 2.0], 1, 2, 0));
        let s = p.get(3).unwrap();
        assert_eq!((s.frames, s.channels[1][0]), (1, 2.0));
        assert!(p.get(0).is_none());
    }
}
