//! The sample pool (spec §7a): decoded samples by id, at the engine's rate, shared by SAMPLER and GRAINS through
//! `Ctx`. Samples arrive between blocks (a message), never inside `process`.

/// One decoded sample: two channels (a mono file has both the same), its hits (position, strength 0…1).
pub struct Sample {
    pub channels: [Vec<f32>; 2],
    pub frames: usize,
    pub hits: Vec<(usize, f32)>,
}

impl Sample {
    /// From planar floats (`channels` × `frames`), then `hits` pairs (position, strength). Takes the staging buffer:
    /// the left channel is that buffer cut short, not a copy.
    pub fn from_planar(mut data: Vec<f32>, frames: usize, channels: usize, hits: usize) -> Self {
        let h: Vec<(usize, f32)> = data[channels * frames..channels * frames + 2 * hits]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| (p[0] as usize, p[1]))
            .collect();
        let (l, r) = if channels > 1 {
            let mut r = data.split_off(frames);
            r.truncate(frames);
            // the left channel kept the whole staging buffer's capacity: cut it to its frames
            data.shrink_to_fit();
            r.shrink_to_fit();
            (data, r)
        } else {
            data.truncate(frames);
            let r = data.clone();
            (data, r)
        };
        Sample {
            channels: [l, r],
            frames,
            hits: h,
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
    /// Frees an id's sample (between blocks); a later `insert` under the id works.
    pub fn remove(&mut self, id: usize) {
        if let Some(slot) = self.slots.get_mut(id) {
            *slot = None;
        }
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
        p.insert(
            3,
            Sample::from_planar(vec![0.1, 0.2, 0.3, 5.0, 0.9], 3, 1, 1),
        );
        let s = p.get(3).unwrap();
        assert_eq!(s.channels[0], vec![0.1, 0.2, 0.3]);
        assert_eq!(s.channels[1], s.channels[0], "mono: both channels the same");
        assert_eq!(s.hits, vec![(5, 0.9)]);
        p.insert(3, Sample::from_planar(vec![1.0, 2.0], 1, 2, 0));
        let s = p.get(3).unwrap();
        assert_eq!((s.frames, s.channels[1][0]), (1, 2.0));
        p.insert(
            4,
            Sample::from_planar(vec![1.0, 2.0, 3.0, 4.0, 1.0, 0.5], 2, 2, 1),
        );
        let s = p.get(4).unwrap();
        assert_eq!(
            (&s.channels[0][..], &s.channels[1][..]),
            (&[1.0, 2.0][..], &[3.0, 4.0][..])
        );
        assert_eq!(s.hits, vec![(1, 0.5)]);
        assert!(p.get(0).is_none());
    }

    #[test]
    fn remove_frees_the_slot_and_the_id_can_be_filled_again() {
        let mut p = SamplePool::default();
        p.insert(2, Sample::from_planar(vec![0.5], 1, 1, 0));
        p.remove(2);
        p.remove(9);
        assert!(p.get(2).is_none());
        p.insert(2, Sample::from_planar(vec![0.25], 1, 1, 0));
        assert_eq!(p.get(2).unwrap().channels[0], vec![0.25]);
    }

    #[test]
    fn a_stereo_sample_holds_only_its_frames() {
        let s = Sample::from_planar(vec![0.0; 2 * 100 + 4], 100, 2, 2);
        assert_eq!(s.channels[0].capacity(), 100);
        assert_eq!(s.channels[1].capacity(), 100);
    }
}
