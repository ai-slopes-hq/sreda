//! The contract every module's DSP implements, and what the engine hands it.

/// Samples per block: the AudioWorklet's render quantum.
pub const BLOCK: usize = 128;

/// Floats in a SCOPE trace: min A, max A, min B, max B — 256 columns each.
pub const TRACE_LEN: usize = 1024;

/// A seeded PRNG, the same sequence as the TypeScript `mulberry32`.
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng { state: seed }
    }

    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6D2B_79F5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }

    /// Uniform in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        self.next_u32() as f64 / 4_294_967_296.0
    }
}

/// Shared per-engine state a DSP may read or write.
pub struct Ctx {
    pub sample_rate: f64,
    pub rng: Rng,
    /// OUT modules add into this; the engine sends it through the master stage.
    pub master: [[f32; BLOCK]; 2],
    /// some OUT is soloed (set by the engine before the nodes run): the others fall silent
    pub solo_any: bool,
    /// decoded samples by id (SAMPLER, GRAINS)
    pub samples: crate::samples::SamplePool,
}

impl Ctx {
    pub fn new(sample_rate: f64, seed: u32) -> Self {
        Ctx {
            sample_rate,
            rng: Rng::new(seed),
            master: [[0.0; BLOCK]; 2],
            solo_any: false,
            samples: crate::samples::SamplePool::default(),
        }
    }
}

/// One module's view of its buffers for a block (or part of one).
pub struct Io<'a> {
    /// prepared inputs in spec order (mod jacks excluded: they feed `par`)
    pub inp: &'a [[f32; BLOCK]],
    /// visible knobs in spec order, in real units, modulation applied
    pub par: &'a [[f32; BLOCK]],
    /// options (index) and hidden knobs (real units), in spec order
    pub fixed: &'a [f64],
    pub out: &'a mut [[f32; BLOCK]],
    pub connected_in: &'a [bool],
    pub connected_out: &'a [bool],
}

pub trait Dsp {
    /// Fill `out[..][from..to]`. The engine calls whole blocks, or one sample at a time inside a feedback loop.
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize);
    /// Back to the initial state (after a non-finite output).
    fn reset(&mut self);
    /// A current index for the UI (STAGES, RHYTHM, SWITCH, SPREAD).
    fn state(&self) -> f32 {
        0.0
    }
    /// SCOPE's display: `TRACE_LEN` floats.
    fn trace(&self) -> Option<&[f32]> {
        None
    }
}

/// A bench for module tests: owns the buffers, runs a DSP block by block, collects its outputs.
#[cfg(test)]
pub mod bench {
    use super::*;

    pub struct Bench {
        pub ctx: Ctx,
        pub inp: Vec<[f32; BLOCK]>,
        pub par: Vec<[f32; BLOCK]>,
        pub fixed: Vec<f64>,
        pub out: Vec<[f32; BLOCK]>,
        pub connected_in: Vec<bool>,
        pub connected_out: Vec<bool>,
    }

    impl Bench {
        pub fn new(
            sample_rate: f64,
            inputs: usize,
            par: &[f64],
            fixed: &[f64],
            outputs: usize,
        ) -> Self {
            Bench {
                ctx: Ctx::new(sample_rate, 1),
                inp: vec![[0.0; BLOCK]; inputs],
                par: par.iter().map(|&v| [v as f32; BLOCK]).collect(),
                fixed: fixed.to_vec(),
                out: vec![[0.0; BLOCK]; outputs],
                connected_in: vec![false; inputs],
                connected_out: vec![true; outputs],
            }
        }

        /// Run `blocks` blocks; `feed(block, sample, inputs)` writes the inputs first. Returns every output's samples.
        pub fn run(
            &mut self,
            dsp: &mut dyn Dsp,
            blocks: usize,
            mut feed: impl FnMut(usize, usize, &mut [[f32; BLOCK]]),
        ) -> Vec<Vec<f32>> {
            let mut res = vec![Vec::with_capacity(blocks * BLOCK); self.out.len()];
            for b in 0..blocks {
                for i in 0..BLOCK {
                    feed(b, i, &mut self.inp);
                }
                self.ctx.master = [[0.0; BLOCK]; 2];
                let mut io = Io {
                    inp: &self.inp,
                    par: &self.par,
                    fixed: &self.fixed,
                    out: &mut self.out,
                    connected_in: &self.connected_in,
                    connected_out: &self.connected_out,
                };
                dsp.process(&mut io, &mut self.ctx, 0, BLOCK);
                for (o, r) in self.out.iter().zip(res.iter_mut()) {
                    r.extend_from_slice(o);
                }
            }
            res
        }
    }

    impl Bench {
        /// Runs a DSP over whole blocks and, from a fresh instance, one sample at a time with the same inputs; the
        /// outputs must be identical (the engine runs any module per sample inside a feedback loop). `inputs` holds one
        /// signal per input, each `blocks · BLOCK` long; an empty one is an unpatched input.
        pub fn blockwise_equals_per_sample(
            make: impl Fn() -> Box<dyn Dsp>,
            inputs: &[Vec<f32>],
            par: &[f64],
            fixed: &[f64],
            outputs: usize,
            blocks: usize,
        ) {
            Self::blockwise_equals_per_sample_with(
                make,
                |_| {},
                inputs,
                par,
                fixed,
                outputs,
                blocks,
            )
        }

        /// The same, with `setup` preparing the context first (samples in the pool).
        pub fn blockwise_equals_per_sample_with(
            make: impl Fn() -> Box<dyn Dsp>,
            setup: impl Fn(&mut Ctx),
            inputs: &[Vec<f32>],
            par: &[f64],
            fixed: &[f64],
            outputs: usize,
            blocks: usize,
        ) {
            let run = |per_sample: bool| {
                let mut b = Bench::new(48_000.0, inputs.len(), par, fixed, outputs);
                setup(&mut b.ctx);
                b.connected_in = inputs.iter().map(|s| !s.is_empty()).collect();
                let mut dsp = make();
                let mut res = vec![Vec::new(); outputs];
                for blk in 0..blocks {
                    for (j, sig) in inputs.iter().enumerate() {
                        if !sig.is_empty() {
                            b.inp[j].copy_from_slice(&sig[blk * BLOCK..(blk + 1) * BLOCK]);
                        }
                    }
                    let mut io = Io {
                        inp: &b.inp,
                        par: &b.par,
                        fixed: &b.fixed,
                        out: &mut b.out,
                        connected_in: &b.connected_in,
                        connected_out: &b.connected_out,
                    };
                    if per_sample {
                        for i in 0..BLOCK {
                            dsp.process(&mut io, &mut b.ctx, i, i + 1);
                        }
                    } else {
                        dsp.process(&mut io, &mut b.ctx, 0, BLOCK);
                    }
                    for (o, r) in b.out.iter().zip(res.iter_mut()) {
                        r.extend_from_slice(o);
                    }
                }
                res
            };
            assert_eq!(
                run(false),
                run(true),
                "block-wise and per-sample outputs differ"
            );
        }
    }

    /// Indices where `s` rises through zero.
    pub fn rising(s: &[f32]) -> Vec<usize> {
        (1..s.len())
            .filter(|&i| s[i - 1] < 0.0 && s[i] >= 0.0)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rng_matches_mulberry32() {
        // mulberry32(1) in JavaScript: first three outputs
        let mut r = Rng::new(1);
        assert_eq!(
            [r.next_u32(), r.next_u32(), r.next_u32()],
            [2_693_262_067, 11_749_833, 2_265_367_787]
        );
    }
}
