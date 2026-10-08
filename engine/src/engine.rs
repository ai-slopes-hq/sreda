//! The engine: plays a plan. Instances are kept by node id across plan swaps; a removed node keeps running for
//! 10 ms while it fades out; a re-routed input crossfades over 10 ms; knobs glide 10 ms in knob space.
//! `apply` allocates; `process` and the message setters do not.

use crate::dsp::{Ctx, Dsp, BLOCK};
use crate::inputs::TriggerInput;
use crate::master::Master;
use crate::plan::{Kind, NodeLayout, NormalPlan, Plan, PlanError, Step};
use crate::registry;
use crate::spec::{from_knob, Knob, ModuleSpec, Param};

const FADE_MS: f64 = 10.0;
const MUTE_MS: f64 = 50.0;
/// no frame gates this source / node
const NO_GATE: u32 = u32::MAX;

/// A source: which output buffer (an index into `Engine::outs`), from which slot and port.
#[derive(Clone, Copy, PartialEq)]
struct Src {
    slot: usize,
    port: usize,
    buf: usize,
    late: bool,
    /// the frame gain that scales this source (a muted frame's leaving cable), or NO_GATE
    gate: u32,
}

#[derive(Clone, Copy)]
enum Norm {
    None,
    /// another output buffer: its own (late: read one sample late) or a parent frame's clock (read as it is now)
    Own(usize, bool),
    Value(f32),
    Internal,
}

struct InputRt {
    kind: Kind,
    sources: Vec<Src>,
    normal: Norm,
    att: f64,
    trig: Option<TriggerInput>,
    /// source values for the trigger input, one per source
    scratch: Vec<f32>,
    /// the previous sources while a re-route crossfades
    old: Vec<Src>,
    xfade_left: u32,
}

struct KnobRt {
    spec: Knob,
    cur: f64,
    target: f64,
    step: f64,
    /// the last position converted and its value: a steady knob skips `from_knob` (a `powf` on exp tapers)
    last_pos: f64,
    last_value: f32,
}

struct Slot {
    id: String,
    type_: String,
    dsp: Box<dyn Dsp>,
    n_in: usize,
    inputs: Vec<InputRt>,
    inbuf: Vec<[f32; BLOCK]>,
    par: Vec<[f32; BLOCK]>,
    knobs: Vec<KnobRt>,
    fixed: Vec<f64>,
    connected_in: Vec<bool>,
    connected_out: Vec<bool>,
    out_base: usize,
    n_out: usize,
    layout: Option<NodeLayout>,
    /// OUT nodes: the frame gain on their speaker output, or NO_GATE
    gate: u32,
    /// writes to the speakers (OUT): run gated, its peak kept for the frame meter
    writes_master: bool,
    master_peak: f32,
    /// samples of fade-out left once removed from the plan; 0 while in the plan
    fade_left: u32,
    dead: bool,
}

enum StepRt {
    Node(usize),
    Loop(Vec<usize>),
    /// a removed slot fading out, placed after its sources and before the inputs that crossfade from it
    Retire(usize),
}

/// A frame's mute gain, gliding over 50 ms.
#[derive(Clone, Copy)]
struct FrameGain {
    cur: f32,
    target: f32,
    step: f32,
}

/// What a frame's meter reads: output buffers of the audio leaving it, and the OUT slots inside it.
struct FrameRt {
    bufs: Vec<usize>,
    outs: Vec<usize>,
}

pub struct Engine {
    sample_rate: f64,
    fade_len: u32,
    mute_len: u32,
    gains: Vec<FrameGain>,
    /// this block's gain per frame, per sample
    gain_buf: Vec<[f32; BLOCK]>,
    frames: Vec<FrameRt>,
    frames_at: usize,
    /// the id of the frame behind each gain (`gains[k]`): the plan's frames, then frames gone from it whose modules
    /// are still fading out
    frame_ids: Vec<String>,
    /// tests: prepare every node sample by sample (the reference `prepare_block` must equal)
    #[cfg(test)]
    per_sample: bool,
    ctx: Ctx,
    master: Master,
    /// stable slot indices: plans refer to slots through `order`
    pool: Vec<Option<Slot>>,
    order: Vec<usize>,
    steps: Vec<StepRt>,
    retiring: Vec<usize>,
    outs: Vec<[f32; BLOCK]>,
    readouts: Vec<f32>,
    seq: u32,
    listen: Option<usize>,
    out: [[f32; BLOCK]; 2],
}

fn visible_knobs(spec: &ModuleSpec) -> Vec<Knob> {
    spec.params
        .iter()
        .filter_map(|p| match p {
            Param::Knob(k) if !k.hidden => Some(k.clone()),
            _ => None,
        })
        .collect()
}

/// A source's value at sample `i` (a late one reads the previous sample), scaled by its frame gain.
fn read(outs: &[[f32; BLOCK]], gains: &[[f32; BLOCK]], s: &Src, i: usize) -> f32 {
    let v = outs[s.buf][if s.late { (i + BLOCK - 1) % BLOCK } else { i }];
    if s.gate == NO_GATE {
        v
    } else {
        v * gains[s.gate as usize][i]
    }
}

/// One input's value at sample `i` from a set of sources.
fn sum(outs: &[[f32; BLOCK]], gains: &[[f32; BLOCK]], sources: &[Src], i: usize) -> f32 {
    let mut v = 0.0;
    for s in sources {
        v += read(outs, gains, s, i);
    }
    v
}

/// Fill a slot's prepared inputs and knob values for sample `i`.
fn prepare(
    slot: &mut Slot,
    outs: &[[f32; BLOCK]],
    gains: &[[f32; BLOCK]],
    i: usize,
    fade_len: u32,
) {
    let n_in = slot.n_in;
    for (j, input) in slot.inputs.iter_mut().enumerate() {
        let raw = if let Some(t) = input.trig.as_mut() {
            let mut n = 0;
            for s in &input.sources {
                input.scratch[n] = read(outs, gains, s, i);
                n += 1;
            }
            if n == 0 {
                if let Norm::Own(b, late) = input.normal {
                    input.scratch[0] = outs[b][if late { (i + BLOCK - 1) % BLOCK } else { i }];
                    n = 1;
                }
            }
            t.sample(&input.scratch[..n])
        } else {
            let mut v = if !input.sources.is_empty() {
                sum(outs, gains, &input.sources, i)
            } else {
                match input.normal {
                    Norm::Own(b, late) => outs[b][if late { (i + BLOCK - 1) % BLOCK } else { i }],
                    Norm::Value(x) => x,
                    Norm::None | Norm::Internal => 0.0,
                }
            };
            if input.xfade_left > 0 {
                let t = 1.0 - input.xfade_left as f32 / fade_len as f32;
                v = sum(outs, gains, &input.old, i) * (1.0 - t) + v * t;
                input.xfade_left -= 1;
            }
            if input.kind == Kind::Cv {
                v *= input.att as f32;
            }
            v
        };
        if j < n_in {
            slot.inbuf[j][i] = raw;
        } else {
            let k = &mut slot.knobs[j - n_in];
            if k.cur != k.target {
                k.cur += k.step;
                if (k.step > 0.0 && k.cur >= k.target)
                    || (k.step < 0.0 && k.cur <= k.target)
                    || k.step == 0.0
                {
                    k.cur = k.target;
                }
            }
            let pos = k.cur + raw as f64;
            if pos != k.last_pos {
                k.last_pos = pos;
                k.last_value = from_knob(&k.spec, pos) as f32;
            }
            slot.par[j - n_in][i] = k.last_value;
        }
    }
}

/// A whole block of a slot's prepared inputs and knob values: the same arithmetic as `prepare` sample by sample,
/// input by input, so the loops run tight (a node outside a feedback loop reads nothing late).
fn prepare_block(slot: &mut Slot, outs: &[[f32; BLOCK]], gains: &[[f32; BLOCK]], fade_len: u32) {
    let n_in = slot.n_in;
    let mut raw = [0.0f32; BLOCK];
    for (j, input) in slot.inputs.iter_mut().enumerate() {
        if let Some(t) = input.trig.as_mut() {
            for (i, r) in raw.iter_mut().enumerate() {
                let mut n = 0;
                for s in &input.sources {
                    input.scratch[n] = read(outs, gains, s, i);
                    n += 1;
                }
                if n == 0 {
                    if let Norm::Own(b, late) = input.normal {
                        input.scratch[0] = outs[b][if late { (i + BLOCK - 1) % BLOCK } else { i }];
                        n = 1;
                    }
                }
                *r = t.sample(&input.scratch[..n]);
            }
        } else {
            if !input.sources.is_empty() {
                raw.fill(0.0);
                for s in &input.sources {
                    if s.gate == NO_GATE && !s.late {
                        for (r, x) in raw.iter_mut().zip(&outs[s.buf]) {
                            *r += *x;
                        }
                    } else {
                        for (i, r) in raw.iter_mut().enumerate() {
                            *r += read(outs, gains, s, i);
                        }
                    }
                }
            } else {
                match input.normal {
                    Norm::Own(b, late) => {
                        for (i, r) in raw.iter_mut().enumerate() {
                            *r = outs[b][if late { (i + BLOCK - 1) % BLOCK } else { i }];
                        }
                    }
                    Norm::Value(x) => raw.fill(x),
                    Norm::None | Norm::Internal => raw.fill(0.0),
                }
            }
            let mut i = 0;
            while input.xfade_left > 0 && i < BLOCK {
                let t = 1.0 - input.xfade_left as f32 / fade_len as f32;
                raw[i] = sum(outs, gains, &input.old, i) * (1.0 - t) + raw[i] * t;
                input.xfade_left -= 1;
                i += 1;
            }
            if input.kind == Kind::Cv {
                let att = input.att as f32;
                for r in raw.iter_mut() {
                    *r *= att;
                }
            }
        }
        if j < n_in {
            slot.inbuf[j] = raw;
        } else {
            let k = &mut slot.knobs[j - n_in];
            let par = &mut slot.par[j - n_in];
            for (p, r) in par.iter_mut().zip(&raw) {
                if k.cur != k.target {
                    k.cur += k.step;
                    if (k.step > 0.0 && k.cur >= k.target)
                        || (k.step < 0.0 && k.cur <= k.target)
                        || k.step == 0.0
                    {
                        k.cur = k.target;
                    }
                }
                let pos = k.cur + *r as f64;
                if pos != k.last_pos {
                    k.last_pos = pos;
                    k.last_value = from_knob(&k.spec, pos) as f32;
                }
                *p = k.last_value;
            }
        }
    }
}

/// Run a slot's DSP over `from..to`.
fn run(slot: &mut Slot, outs: &mut [[f32; BLOCK]], ctx: &mut Ctx, from: usize, to: usize) {
    let Slot {
        dsp,
        inbuf,
        par,
        fixed,
        connected_in,
        connected_out,
        out_base,
        n_out,
        ..
    } = slot;
    let mut io = crate::dsp::Io {
        inp: inbuf,
        par,
        fixed,
        out: &mut outs[*out_base..*out_base + *n_out],
        connected_in,
        connected_out,
    };
    dsp.process(&mut io, ctx, from, to);
}

/// A non-finite output zeroes the node's outputs and resets it.
fn guard(slot: &mut Slot, outs: &mut [[f32; BLOCK]]) {
    let bufs = &mut outs[slot.out_base..slot.out_base + slot.n_out];
    if bufs.iter().any(|b| b.iter().any(|x| !x.is_finite())) {
        for b in bufs.iter_mut() {
            b.fill(0.0);
        }
        slot.dsp.reset();
    }
}

impl Engine {
    pub fn new(sample_rate: f64, seed: u32) -> Self {
        Engine {
            sample_rate,
            fade_len: ((FADE_MS * 0.001 * sample_rate).round() as u32).max(1),
            mute_len: ((MUTE_MS * 0.001 * sample_rate).round() as u32).max(1),
            gains: Vec::new(),
            gain_buf: Vec::new(),
            frames: Vec::new(),
            frames_at: 0,
            frame_ids: Vec::new(),
            #[cfg(test)]
            per_sample: false,
            ctx: Ctx::new(sample_rate, seed),
            master: Master::new(sample_rate),
            pool: Vec::new(),
            order: Vec::new(),
            steps: Vec::new(),
            retiring: Vec::new(),
            outs: Vec::new(),
            readouts: vec![0.0; 2],
            seq: 0,
            listen: None,
            out: [[0.0; BLOCK]; 2],
        }
    }

    /// Swap in a new plan. An invalid plan changes nothing.
    pub fn apply(&mut self, plan: Plan) -> Result<(), PlanError> {
        // check everything before touching the running state
        let n = plan.nodes.len();
        let mut specs = Vec::with_capacity(n);
        for node in &plan.nodes {
            let spec = registry::spec_of(&node.type_)
                .ok_or_else(|| PlanError::UnknownType(node.type_.clone()))?;
            let knobs = visible_knobs(&spec).len();
            let bad = |what: &str| {
                Err(PlanError::Invalid(format!(
                    "{} ({}): {what}",
                    node.id, node.type_
                )))
            };
            let fixed = spec
                .params
                .iter()
                .filter(|p| {
                    matches!(p, Param::Option(_)) || matches!(p, Param::Knob(k) if k.hidden)
                })
                .count();
            if node.knobs.len() != knobs
                || node.fixed.len() != fixed
                || node.inputs.len() != spec.inputs.len() + knobs
                || node.connected_out.len() != spec.outputs.len()
            {
                return bad("port, knob or option count");
            }
            specs.push(spec);
        }
        // the readout layout: one entry per node, every slot inside the buffer
        if plan.layout.nodes.len() != n || plan.layout.size < 2 {
            return Err(PlanError::Invalid("readout layout".into()));
        }
        for (l, spec) in plan.layout.nodes.iter().zip(&specs) {
            let knobs = visible_knobs(spec).len();
            let trigs = spec
                .inputs
                .iter()
                .filter(|p| p.role == crate::spec::Role::Trigger)
                .count();
            let size = plan.layout.size;
            if l.knobs < 2
                || l.knobs + knobs > size
                || l.trigs + trigs > size
                || l.outs + spec.outputs.len() > size
                || l.state >= size
                || l.trace.is_some_and(|t| t + crate::dsp::TRACE_LEN > size)
            {
                return Err(PlanError::Invalid("readout layout out of range".into()));
            }
        }
        for (node, _) in plan.nodes.iter().zip(&specs) {
            for input in &node.inputs {
                for s in &input.sources {
                    if s.node >= n || s.port >= specs[s.node].outputs.len() {
                        return Err(PlanError::Invalid(format!(
                            "{}: a source out of range",
                            node.id
                        )));
                    }
                }
                if let Some(NormalPlan::Own { node: o, port, .. }) = input.normal {
                    if o >= n || port >= specs[o].outputs.len() {
                        return Err(PlanError::Invalid(format!(
                            "{}: a normal out of range",
                            node.id
                        )));
                    }
                }
            }
        }
        // frames: gates, meter sources and OUTs in range; the meters inside the readouts
        let nf = plan.frames.len();
        let gate_ok = |g: Option<usize>| g.is_none_or(|g| g < nf);
        let gates = plan.nodes.iter().all(|node| {
            gate_ok(node.gate)
                && node
                    .inputs
                    .iter()
                    .all(|ip| ip.sources.iter().all(|s| gate_ok(s.gate)))
        });
        let meters = plan.frames.iter().all(|f| {
            f.sources
                .iter()
                .all(|s| s.node < n && s.port < specs[s.node].outputs.len())
                && f.outs.iter().all(|&o| o < n)
        });
        if !gates || !meters || (nf > 0 && plan.layout.frames + nf > plan.layout.size) {
            return Err(PlanError::Invalid("frames out of range".into()));
        }
        for st in &plan.steps {
            let ok = match st {
                Step::Node { node } => *node < n,
                Step::Loop { members } => members.iter().all(|m| *m < n),
            };
            if !ok {
                return Err(PlanError::Invalid("steps out of range".into()));
            }
        }

        // frame gains follow their frame by id: the plan's frames, then the old ones that went (their modules fade
        // out still gated by them); `regate` maps an old gain index to the new one
        let mut all_ids: Vec<String> = plan
            .frames
            .iter()
            .enumerate()
            .map(|(k, f)| {
                if f.id.is_empty() {
                    format!("#{k}")
                } else {
                    f.id.clone()
                }
            })
            .collect();
        for id in &self.frame_ids {
            if !all_ids.contains(id) {
                all_ids.push(id.clone());
            }
        }
        let remap: Vec<u32> = self
            .frame_ids
            .iter()
            .map(|id| {
                all_ids
                    .iter()
                    .position(|x| x == id)
                    .map_or(NO_GATE, |k| k as u32)
            })
            .collect();
        // whether anything (a fading slot, a crossfading input) still reads a gain of a frame gone from the plan
        let ghost_used = std::cell::Cell::new(false);
        let regate = |g: u32| {
            if g == NO_GATE {
                return NO_GATE;
            }
            let r = remap.get(g as usize).copied().unwrap_or(NO_GATE);
            if r != NO_GATE && r as usize >= nf {
                ghost_used.set(true);
            }
            r
        };

        // drop slots that finished fading; then map plan nodes to slots by id (and type)
        for p in 0..self.pool.len() {
            if self.pool[p].as_ref().is_some_and(|s| s.dead) {
                self.pool[p] = None;
            }
        }
        self.retiring.retain(|&p| self.pool[p].is_some());
        let mut order = Vec::with_capacity(n);
        let mut fresh = vec![false; n];
        for (i, node) in plan.nodes.iter().enumerate() {
            let found = (0..self.pool.len()).find(|&p| {
                !order.contains(&p)
                    && self.pool[p]
                        .as_ref()
                        .is_some_and(|s| s.id == node.id && s.type_ == node.type_)
            });
            let p = match found {
                Some(p) => p,
                None => {
                    fresh[i] = true;
                    let dsp = registry::create(&node.type_, self.sample_rate)
                        .ok_or_else(|| PlanError::UnknownType(node.type_.clone()))?;
                    let spec = &specs[i];
                    let slot = Slot {
                        id: node.id.clone(),
                        type_: node.type_.clone(),
                        dsp,
                        n_in: spec.inputs.len(),
                        inputs: Vec::new(),
                        inbuf: vec![[0.0; BLOCK]; spec.inputs.len()],
                        par: Vec::new(),
                        knobs: Vec::new(),
                        fixed: Vec::new(),
                        connected_in: vec![false; spec.inputs.len()],
                        connected_out: vec![false; spec.outputs.len()],
                        out_base: 0,
                        n_out: spec.outputs.len(),
                        layout: None,
                        gate: NO_GATE,
                        writes_master: node.type_ == "out",
                        master_peak: 0.0,
                        fade_left: 0,
                        dead: false,
                    };
                    match self.pool.iter().position(|s| s.is_none()) {
                        Some(free) => {
                            self.pool[free] = Some(slot);
                            free
                        }
                        None => {
                            self.pool.push(Some(slot));
                            self.pool.len() - 1
                        }
                    }
                }
            };
            order.push(p);
        }
        // slots that were playing and are not in the new plan start fading out; revived ones stop fading
        for p in 0..self.pool.len() {
            let in_plan = order.contains(&p);
            if let Some(s) = self.pool[p].as_mut() {
                if in_plan {
                    s.fade_left = 0;
                } else if s.layout.is_some() {
                    s.layout = None;
                    s.fade_left = self.fade_len;
                    if !self.retiring.contains(&p) {
                        self.retiring.push(p);
                    }
                }
            }
        }
        self.retiring.retain(|p| !order.contains(p));

        // output buffers: every live or fading slot, contents carried over
        let mut outs = Vec::new();
        let mut moved = vec![usize::MAX; self.pool.len()];
        for (p, s) in self.pool.iter_mut().enumerate() {
            if let Some(s) = s {
                moved[p] = outs.len();
                for port in 0..s.n_out {
                    outs.push(
                        self.outs
                            .get(s.out_base + port)
                            .copied()
                            .unwrap_or([0.0; BLOCK]),
                    );
                }
            }
        }
        for (p, s) in self.pool.iter_mut().enumerate() {
            if let Some(s) = s {
                s.out_base = moved[p];
            }
        }
        let base = |pool: &Vec<Option<Slot>>, p: usize| pool[p].as_ref().map(|s| s.out_base);
        // fading slots keep their old inputs, re-pointed at the new buffers (a source that is gone is dropped)
        for &p in &self.retiring {
            let mut slot = self.pool[p].take().unwrap();
            for input in slot.inputs.iter_mut() {
                input
                    .sources
                    .retain(|s| self.pool.get(s.slot).is_some_and(|x| x.is_some()) || s.slot == p);
                for s in input.sources.iter_mut() {
                    s.buf = if s.slot == p {
                        slot.out_base
                    } else {
                        base(&self.pool, s.slot).unwrap()
                    } + s.port;
                }
                for s in input.sources.iter_mut() {
                    s.gate = regate(s.gate);
                }
                input.old.clear();
                input.xfade_left = 0;
                if let Norm::Own(..) = input.normal {
                    input.normal = Norm::None;
                }
            }
            slot.gate = regate(slot.gate);
            self.pool[p] = Some(slot);
        }

        let fade_len = self.fade_len;
        for (i, node) in plan.nodes.iter().enumerate() {
            let p = order[i];
            let mut slot = self.pool[p].take().unwrap();
            let spec = &specs[i];
            let knob_specs = visible_knobs(spec);
            let resolve = |pool: &Vec<Option<Slot>>, own: &Slot, q: usize, port: usize| -> usize {
                (if q == p {
                    own.out_base
                } else {
                    pool[q].as_ref().unwrap().out_base
                }) + port
            };
            let mut inputs = Vec::with_capacity(node.inputs.len());
            let mut old_inputs = std::mem::take(&mut slot.inputs);
            for (j, ip) in node.inputs.iter().enumerate() {
                let sources: Vec<Src> = ip
                    .sources
                    .iter()
                    .map(|s| {
                        let q = order[s.node];
                        Src {
                            slot: q,
                            port: s.port,
                            buf: resolve(&self.pool, &slot, q, s.port),
                            late: s.late,
                            gate: s.gate.map_or(NO_GATE, |g| g as u32),
                        }
                    })
                    .collect();
                let normal = match ip.normal {
                    None => Norm::None,
                    Some(NormalPlan::Value { value }) => Norm::Value(value as f32),
                    Some(NormalPlan::Internal(_)) => Norm::Internal,
                    Some(NormalPlan::Own {
                        node: o,
                        port,
                        late,
                    }) => Norm::Own(resolve(&self.pool, &slot, order[o], port), late),
                };
                let same = old_inputs.get(j).is_some_and(|o| {
                    o.sources.len() == sources.len()
                        && o.sources
                            .iter()
                            .zip(&sources)
                            .all(|(a, b)| a.slot == b.slot && a.port == b.port)
                });
                let mut rt = InputRt {
                    kind: ip.kind,
                    sources,
                    normal,
                    att: ip.att,
                    trig: None,
                    scratch: vec![0.0; ip.sources.len().max(1)],
                    old: Vec::new(),
                    xfade_left: 0,
                };
                if ip.kind == Kind::Trigger {
                    // keep the input's state (edges, counts, pending ×N events) when its sources did not change
                    let kept = if same {
                        old_inputs.get_mut(j).and_then(|o| o.trig.take())
                    } else {
                        None
                    };
                    let mut t = kept.unwrap_or_else(|| {
                        TriggerInput::new(self.sample_rate, ip.sources.len().max(1))
                    });
                    t.set_ratio(ip.ratio);
                    rt.trig = Some(t);
                } else if !fresh[i] && !same {
                    if let Some(o) = old_inputs.get(j) {
                        // crossfade from what this input read before (sources still around only)
                        rt.old = o
                            .sources
                            .iter()
                            .filter(|s| {
                                s.slot == p || self.pool.get(s.slot).is_some_and(|x| x.is_some())
                            })
                            .map(|s| Src {
                                buf: resolve(&self.pool, &slot, s.slot, s.port),
                                gate: regate(s.gate),
                                ..*s
                            })
                            .collect();
                        rt.xfade_left = fade_len;
                    }
                }
                inputs.push(rt);
            }
            slot.gate = node.gate.map_or(NO_GATE, |g| g as u32);
            slot.connected_in = node.inputs[..spec.inputs.len()]
                .iter()
                .map(|ip| !ip.sources.is_empty())
                .collect();
            slot.connected_out = node.connected_out.clone();
            slot.fixed = node.fixed.clone();
            slot.par = vec![[0.0; BLOCK]; knob_specs.len()];
            let old_knobs = std::mem::take(&mut slot.knobs);
            slot.knobs = knob_specs
                .into_iter()
                .zip(&node.knobs)
                .enumerate()
                .map(|(k, (spec, &target))| {
                    let target = target.clamp(0.0, 1.0);
                    let cur = if fresh[i] {
                        target
                    } else {
                        old_knobs.get(k).map_or(target, |o| o.cur)
                    };
                    KnobRt {
                        spec,
                        cur,
                        target,
                        step: (target - cur) / fade_len as f64,
                        last_pos: f64::NAN,
                        last_value: 0.0,
                    }
                })
                .collect();
            slot.inputs = inputs;
            slot.layout = Some(plan.layout.nodes[i]);
            self.pool[p] = Some(slot);
        }

        self.outs = outs;
        let live: Vec<StepRt> = plan
            .steps
            .iter()
            .map(|st| match st {
                Step::Node { node } => StepRt::Node(order[*node]),
                Step::Loop { members } => StepRt::Loop(members.iter().map(|m| order[*m]).collect()),
            })
            .collect();
        self.steps = self.place_retiring(live);
        // frames: a frame's gain glides to the plan's state (a new frame starts there); a frame gone from the plan
        // keeps its gain while its modules fade out
        let mute_len = self.mute_len as f32;
        let old_gains = std::mem::take(&mut self.gains);
        let old = |id: &String| {
            self.frame_ids
                .iter()
                .position(|x| x == id)
                .and_then(|k| old_gains.get(k).copied())
        };
        if !ghost_used.get() {
            all_ids.truncate(nf);
        }
        self.gains = all_ids
            .iter()
            .enumerate()
            .map(|(k, id)| match plan.frames.get(k) {
                Some(f) => {
                    let target = if f.muted { 0.0 } else { 1.0 };
                    let cur = old(id).map_or(target, |g| g.cur);
                    FrameGain {
                        cur,
                        target,
                        step: (target - cur) / mute_len,
                    }
                }
                None => old(id).unwrap_or(FrameGain {
                    cur: 1.0,
                    target: 1.0,
                    step: 0.0,
                }),
            })
            .collect();
        self.gain_buf = vec![[1.0; BLOCK]; all_ids.len()];
        self.frame_ids = all_ids;
        self.frames = plan
            .frames
            .iter()
            .map(|f| FrameRt {
                bufs: f
                    .sources
                    .iter()
                    .map(|s| self.pool[order[s.node]].as_ref().unwrap().out_base + s.port)
                    .collect(),
                outs: f.outs.iter().map(|&o| order[o]).collect(),
            })
            .collect();
        self.frames_at = plan.layout.frames;
        // buffers moved: the UI re-sends listen after a new plan
        self.listen = None;
        self.order = order;
        self.readouts = vec![0.0; plan.layout.size.max(2)];
        self.seq = plan.seq;
        Ok(())
    }

    /// Steps with the fading slots put in: each after the steps (or fading slots) that feed it, so whatever still
    /// reads it during its fade (a crossfading input, another fading slot) gets this block's samples.
    fn place_retiring(&self, live: Vec<StepRt>) -> Vec<StepRt> {
        let step_of = |q: usize| {
            live.iter().position(|st| match st {
                StepRt::Node(p) => *p == q,
                StepRt::Loop(m) => m.contains(&q),
                StepRt::Retire(_) => false,
            })
        };
        let n = self.retiring.len();
        // (position among the live steps, depth among fading slots)
        let mut at: Vec<(usize, usize)> = vec![(0, 0); n];
        for _ in 0..=n {
            for (k, &r) in self.retiring.iter().enumerate() {
                let Some(slot) = self.pool[r].as_ref() else {
                    continue;
                };
                let mut place = (0, 0);
                for s in slot.inputs.iter().flat_map(|i| i.sources.iter()) {
                    if s.slot == r {
                        continue;
                    }
                    if let Some(i) = step_of(s.slot) {
                        place.0 = place.0.max(i + 1);
                    } else if let Some(j) = self.retiring.iter().position(|&q| q == s.slot) {
                        place = (place.0.max(at[j].0), place.1.max(at[j].1 + 1));
                    }
                }
                at[k] = place;
            }
        }
        let mut fading: Vec<(usize, usize, usize)> = self
            .retiring
            .iter()
            .enumerate()
            .map(|(k, &r)| (at[k].0, at[k].1, r))
            .collect();
        fading.sort();
        let mut steps = Vec::with_capacity(live.len() + n);
        let mut f = fading.into_iter().peekable();
        for (i, st) in live.into_iter().enumerate() {
            while let Some(&(pos, _, r)) = f.peek() {
                if pos > i {
                    break;
                }
                steps.push(StepRt::Retire(r));
                f.next();
            }
            steps.push(st);
        }
        steps.extend(f.map(|(_, _, r)| StepRt::Retire(r)));
        steps
    }

    /// One block of a removed slot: it plays on, its contribution to the speakers ramping to silence over 10 ms.
    fn retire_block(&mut self, p: usize) {
        let fade_len = self.fade_len;
        let Some(slot) = self.pool[p].as_mut() else {
            return;
        };
        if slot.dead {
            return;
        }
        let saved = self.ctx.master;
        self.ctx.master = [[0.0; BLOCK]; 2];
        for i in 0..BLOCK {
            prepare(slot, &self.outs, &self.gain_buf, i, fade_len);
        }
        run(slot, &mut self.outs, &mut self.ctx, 0, BLOCK);
        guard(slot, &mut self.outs);
        let mine = self.ctx.master;
        self.ctx.master = saved;
        // an OUT inside a frame still answers to that frame's mute while it fades
        let gate = (slot.writes_master && slot.gate != NO_GATE)
            .then(|| &self.gain_buf[slot.gate as usize]);
        for (ch, buf) in self.ctx.master.iter_mut().enumerate() {
            for (i, x) in buf.iter_mut().enumerate() {
                let g = gate.map_or(1.0, |g| g[i]);
                *x += mine[ch][i] * g * slot.fade_left.saturating_sub(i as u32) as f32
                    / fade_len as f32;
            }
        }
        slot.fade_left = slot.fade_left.saturating_sub(BLOCK as u32);
        if slot.fade_left == 0 {
            slot.dead = true;
        }
    }

    fn slot_mut(&mut self, node: usize) -> Option<&mut Slot> {
        let p = *self.order.get(node)?;
        self.pool[p].as_mut()
    }

    /// A knob's new position 0…1; it glides there over 10 ms.
    pub fn knob(&mut self, node: usize, index: usize, value: f64) {
        let fade = self.fade_len as f64;
        if let Some(k) = self.slot_mut(node).and_then(|s| s.knobs.get_mut(index)) {
            k.target = value.clamp(0.0, 1.0);
            k.step = (k.target - k.cur) / fade;
        }
    }

    /// A fixed value — an option's index or a hidden knob in real units — without a new plan.
    pub fn fixed(&mut self, node: usize, index: usize, value: f64) {
        if let Some(f) = self.slot_mut(node).and_then(|s| s.fixed.get_mut(index)) {
            *f = value;
        }
    }

    pub fn att(&mut self, node: usize, input: usize, value: f64) {
        if let Some(i) = self.slot_mut(node).and_then(|s| s.inputs.get_mut(input)) {
            i.att = value.clamp(-1.0, 1.0);
        }
    }

    pub fn ratio(&mut self, node: usize, input: usize, value: i32) {
        if let Some(t) = self
            .slot_mut(node)
            .and_then(|s| s.inputs.get_mut(input))
            .and_then(|i| i.trig.as_mut())
        {
            t.set_ratio(value);
        }
    }

    /// Mute or unmute a frame: its gain glides to 0 or 1 over 50 ms.
    pub fn mute(&mut self, frame: usize, on: bool) {
        let len = self.mute_len as f32;
        if let Some(g) = self.gains.get_mut(frame) {
            g.target = if on { 0.0 } else { 1.0 };
            g.step = (g.target - g.cur) / len;
        }
    }

    /// The speakers fade in over `ms` (a project just opened).
    pub fn fade_in(&mut self, ms: f64) {
        self.master.fade_in(ms);
    }

    /// Where the frame meters start in the readouts.
    pub fn layout_frames(&self) -> usize {
        self.frames_at
    }

    /// Send one node output to the speakers instead of the patch (through the master stage).
    pub fn listen(&mut self, target: Option<(usize, usize)>) {
        self.listen = target.and_then(|(node, port)| {
            let p = *self.order.get(node)?;
            let s = self.pool[p].as_ref()?;
            (port < s.n_out).then_some(s.out_base + port)
        });
    }

    pub fn process(&mut self) -> (&[f32; BLOCK], &[f32; BLOCK]) {
        self.ctx.master = [[0.0; BLOCK]; 2];
        // this block's frame gains, gliding toward mute / unmute
        for (g, buf) in self.gains.iter_mut().zip(self.gain_buf.iter_mut()) {
            for x in buf.iter_mut() {
                if g.cur != g.target {
                    g.cur += g.step;
                    if (g.step > 0.0 && g.cur >= g.target)
                        || (g.step < 0.0 && g.cur <= g.target)
                        || g.step == 0.0
                    {
                        g.cur = g.target;
                    }
                }
                *x = g.cur;
            }
        }
        let fade_len = self.fade_len;
        let steps = std::mem::take(&mut self.steps);
        for st in &steps {
            match st {
                StepRt::Node(p) => {
                    let slot = self.pool[*p].as_mut().unwrap();
                    #[cfg(test)]
                    let reference = self.per_sample;
                    #[cfg(not(test))]
                    let reference = false;
                    if reference {
                        for i in 0..BLOCK {
                            prepare(slot, &self.outs, &self.gain_buf, i, fade_len);
                        }
                    } else {
                        prepare_block(slot, &self.outs, &self.gain_buf, fade_len);
                    }
                    if slot.writes_master && slot.gate != NO_GATE {
                        // an OUT inside a frame: its speaker output through the frame's gain
                        let saved = self.ctx.master;
                        self.ctx.master = [[0.0; BLOCK]; 2];
                        run(slot, &mut self.outs, &mut self.ctx, 0, BLOCK);
                        let g = &self.gain_buf[slot.gate as usize];
                        let mut peak = 0.0f32;
                        let mine = self.ctx.master;
                        self.ctx.master = saved;
                        for (ch, buf) in mine.iter().enumerate() {
                            for (i, x) in buf.iter().enumerate() {
                                let y = x * g[i];
                                peak = peak.max(y.abs());
                                self.ctx.master[ch][i] += y;
                            }
                        }
                        slot.master_peak = peak;
                    } else {
                        run(slot, &mut self.outs, &mut self.ctx, 0, BLOCK);
                    }
                    guard(slot, &mut self.outs);
                }
                StepRt::Loop(members) => {
                    for i in 0..BLOCK {
                        for p in members {
                            let slot = self.pool[*p].as_mut().unwrap();
                            prepare(slot, &self.outs, &self.gain_buf, i, fade_len);
                            run(slot, &mut self.outs, &mut self.ctx, i, i + 1);
                        }
                    }
                    for p in members {
                        guard(self.pool[*p].as_mut().unwrap(), &mut self.outs);
                    }
                }
                StepRt::Retire(p) => self.retire_block(*p),
            }
        }
        self.steps = steps;

        self.out = match self.listen {
            Some(b) => [self.outs[b], self.outs[b]],
            None => self.ctx.master,
        };
        let [l, r] = &mut self.out;
        self.master.process(l, r);
        self.readouts[1] = self.out[0]
            .iter()
            .chain(self.out[1].iter())
            .fold(0.0f32, |a, x| a.max(x.abs()));
        self.write_readouts();
        (&self.out[0], &self.out[1])
    }

    fn write_readouts(&mut self) {
        self.readouts[0] = self.seq as f32;
        // frame meters: the peak of what leaves each frame, after its gain
        for (k, f) in self.frames.iter().enumerate() {
            let mut peak = 0.0f32;
            for &b in &f.bufs {
                peak = self.outs[b].iter().fold(peak, |a, x| a.max(x.abs()));
            }
            for &p in &f.outs {
                if let Some(s) = self.pool[p].as_ref() {
                    peak = peak.max(s.master_peak);
                }
            }
            self.readouts[self.frames_at + k] = peak * self.gain_buf[k][BLOCK - 1];
        }
        for s in self.pool.iter().flatten() {
            let Some(l) = s.layout else { continue };
            // a knob's position with its modulation, at the block's last sample
            for (k, knob) in s.knobs.iter().enumerate() {
                let modv = if s.inputs[s.n_in + k].sources.is_empty() {
                    0.0
                } else {
                    crate::spec::to_knob(&knob.spec, s.par[k][BLOCK - 1] as f64) - knob.cur
                };
                self.readouts[l.knobs + k] = (knob.cur + modv).clamp(0.0, 1.0) as f32;
            }
            let mut t = 0;
            for input in &s.inputs[..s.n_in] {
                if let Some(tr) = &input.trig {
                    self.readouts[l.trigs + t] = (tr.count() & 0xFF_FFFF) as f32;
                    t += 1;
                }
            }
            for port in 0..s.n_out {
                self.readouts[l.outs + port] = self.outs[s.out_base + port]
                    .iter()
                    .fold(0.0f32, |a, x| a.max(x.abs()));
            }
            self.readouts[l.state] = s.dsp.state();
            if let (Some(t), Some(src)) = (l.trace, s.dsp.trace()) {
                let n = src.len().min(crate::dsp::TRACE_LEN);
                self.readouts[t..t + n].copy_from_slice(&src[..n]);
            }
        }
    }

    pub fn readouts(&self) -> &[f32] {
        &self.readouts
    }

    /// A node's output buffer from the last block (plan index, output index).
    pub fn output(&self, node: usize, port: usize) -> &[f32; BLOCK] {
        let s = self.pool[self.order[node]].as_ref().unwrap();
        &self.outs[s.out_base + port]
    }

    /// L block then R block, contiguous (the WASM export hands out this pointer).
    pub fn out_ptr(&self) -> *const f32 {
        self.out.as_ptr() as *const f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::{
        FramePlan, InputPlan, Kind, NodeLayout, NodePort, NormalPlan, PlanNode, ReadoutLayout,
        Source, Step,
    };
    use crate::registry::spec_of;
    use crate::spec::Param;
    use crate::testmods::BOOM_RESETS;
    use std::sync::atomic::Ordering;

    const SR: f64 = 48_000.0;

    fn src(node: usize, late: bool) -> Source {
        Source {
            node,
            port: 0,
            late,
            gate: None,
        }
    }
    fn input(sources: Vec<Source>, kind: Kind) -> InputPlan {
        InputPlan {
            sources,
            normal: None,
            kind,
            att: 1.0,
            ratio: 1,
        }
    }
    fn none(kind: Kind) -> InputPlan {
        input(vec![], kind)
    }
    fn node(id: &str, ty: &str, knobs: &[f64], fixed: &[f64], inputs: Vec<InputPlan>) -> PlanNode {
        let outs = spec_of(ty).unwrap().outputs.len();
        PlanNode {
            id: id.into(),
            type_: ty.into(),
            knobs: knobs.to_vec(),
            fixed: fixed.to_vec(),
            inputs,
            connected_out: vec![true; outs],
            gate: None,
        }
    }
    fn plan(seq: u32, nodes: Vec<PlanNode>, steps: Vec<Step>) -> Plan {
        let mut off = 2;
        let layout = nodes
            .iter()
            .map(|n| {
                let s = spec_of(&n.type_).unwrap();
                let knobs = off;
                off += s
                    .params
                    .iter()
                    .filter(|p| matches!(p, Param::Knob(k) if !k.hidden))
                    .count();
                let trigs = off;
                off += s
                    .inputs
                    .iter()
                    .filter(|p| p.role == crate::spec::Role::Trigger)
                    .count();
                let outs = off;
                off += s.outputs.len();
                let state = off;
                off += 1;
                let trace = s
                    .display
                    .as_ref()
                    .is_some_and(|d| d.kind == "scope")
                    .then(|| {
                        off += crate::dsp::TRACE_LEN;
                        off - crate::dsp::TRACE_LEN
                    });
                NodeLayout {
                    knobs,
                    trigs,
                    outs,
                    state,
                    trace,
                }
            })
            .collect();
        Plan {
            seq,
            nodes,
            steps,
            frames: vec![],
            layout: ReadoutLayout {
                size: off,
                nodes: layout,
                frames: off,
            },
        }
    }
    /// the plan with frames: their meters after the nodes' readouts
    fn with_frames(mut p: Plan, frames: Vec<FramePlan>) -> Plan {
        p.layout.frames = p.layout.size;
        p.layout.size += frames.len();
        p.frames = frames;
        p
    }
    fn frame(muted: bool, sources: &[(usize, usize)], outs: &[usize]) -> FramePlan {
        FramePlan {
            id: String::new(),
            muted,
            sources: sources
                .iter()
                .map(|&(node, port)| NodePort { node, port })
                .collect(),
            outs: outs.to_vec(),
        }
    }
    fn gated(node: usize, gate: usize) -> Source {
        Source {
            gate: Some(gate),
            ..src(node, false)
        }
    }
    fn chain(n: usize) -> Vec<Step> {
        (0..n).map(|node| Step::Node { node }).collect()
    }
    /// dc knob position for a value (dc's v is −10…10)
    fn dcv(v: f64) -> f64 {
        (v + 10.0) / 20.0
    }
    fn run(e: &mut Engine, blocks: usize) -> Vec<f32> {
        let mut l = Vec::new();
        for _ in 0..blocks {
            l.extend_from_slice(e.process().0);
        }
        l
    }
    fn peak(s: &[f32]) -> f32 {
        s.iter().fold(0.0, |a, x| a.max(x.abs()))
    }
    fn osc(id: &str) -> PlanNode {
        // 110 Hz saw; mod jacks @freq @pw @fmi after PTCH FM SYNC
        node(
            id,
            "osc",
            &[0.5737, 0.5, 0.0],
            &[2.0],
            vec![
                none(Kind::Cv),
                none(Kind::Sum),
                none(Kind::Trigger),
                none(Kind::Cv),
                none(Kind::Cv),
                none(Kind::Cv),
            ],
        )
    }
    fn out(id: &str, from: usize, level: f64) -> PlanNode {
        node(
            id,
            "out",
            &[level],
            &[],
            vec![
                input(vec![src(from, false)], Kind::Sum),
                none(Kind::Sum),
                none(Kind::Cv),
            ],
        )
    }

    /// dc 1 → gain, the cable gated by frame 0 (the dc is inside it, the gain outside)
    fn gated_dc() -> Engine {
        let dc = node("a", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]);
        let gain = node(
            "b",
            "gain",
            &[0.5],
            &[],
            vec![input(vec![gated(0, 0)], Kind::Sum), none(Kind::Cv)],
        );
        let mut e = Engine::new(SR, 1);
        e.apply(with_frames(
            plan(1, vec![dc, gain], chain(2)),
            vec![frame(false, &[(0, 0)], &[])],
        ))
        .unwrap();
        e
    }
    fn gain_out(e: &mut Engine, blocks: usize) -> Vec<f32> {
        let mut o = Vec::new();
        for _ in 0..blocks {
            e.process();
            o.extend_from_slice(e.output(1, 0));
        }
        o
    }

    #[test]
    fn muting_a_frame_glides_its_leaving_cables_to_silence_in_50_ms_and_back() {
        let mut e = gated_dc();
        assert!((gain_out(&mut e, 10)[BLOCK * 10 - 1] - 1.0).abs() < 1e-6);
        e.mute(0, true);
        let down = gain_out(&mut e, 40);
        let silent = down.iter().position(|x| x.abs() <= 0.001).unwrap();
        assert!(silent.abs_diff(2400) <= 48, "−60 dB after {silent} samples");
        assert!(down.windows(2).all(|w| (w[1] - w[0]).abs() <= 0.01));
        assert!(down[BLOCK * 40 - 1].abs() < 1e-6);
        e.mute(0, false);
        let up = gain_out(&mut e, 40);
        let back = up.iter().position(|x| *x >= 0.999).unwrap();
        assert!(back.abs_diff(2400) <= 48, "back after {back} samples");
        assert!(up.windows(2).all(|w| (w[1] - w[0]).abs() <= 0.01));
    }

    fn framed(id: &str, muted: bool, sources: &[(usize, usize)], outs: &[usize]) -> FramePlan {
        FramePlan {
            id: id.into(),
            ..frame(muted, sources, outs)
        }
    }

    #[test]
    fn a_frame_keeps_its_own_gain_when_another_frame_before_it_goes() {
        // g2 is muted; its gated source must stay silent when g1 (unmuted, listed first) is deleted
        let dc = node("a", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]);
        let gain = |gate| {
            node(
                "b",
                "gain",
                &[0.5],
                &[],
                vec![input(vec![gated(0, gate)], Kind::Sum), none(Kind::Cv)],
            )
        };
        let mut e = Engine::new(SR, 1);
        let two = vec![
            framed("g1", false, &[], &[]),
            framed("g2", true, &[(0, 0)], &[]),
        ];
        e.apply(with_frames(
            plan(1, vec![dc.clone(), gain(1)], chain(2)),
            two,
        ))
        .unwrap();
        assert!(peak(&gain_out(&mut e, 30)) < 1e-6);
        e.apply(with_frames(
            plan(2, vec![dc, gain(0)], chain(2)),
            vec![framed("g2", true, &[(0, 0)], &[])],
        ))
        .unwrap();
        assert!(peak(&gain_out(&mut e, 30)) < 1e-6, "the muted frame leaked");
    }

    #[test]
    fn unframing_while_an_input_crossfades_from_a_gated_cable_is_safe() {
        // a gated cable is re-routed in the same plan that removes its frame: the crossfade still reads that gain
        let dc = node("a", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]);
        let dc2 = node("c", "dc", &[dcv(0.5)], &[], vec![none(Kind::Cv)]);
        let gain = |src: Source| {
            node(
                "b",
                "gain",
                &[0.5],
                &[],
                vec![input(vec![src], Kind::Sum), none(Kind::Cv)],
            )
        };
        let mut e = Engine::new(SR, 1);
        e.apply(with_frames(
            plan(
                1,
                vec![dc.clone(), dc2.clone(), gain(gated(0, 0))],
                chain(3),
            ),
            vec![framed("g1", true, &[(0, 0)], &[])],
        ))
        .unwrap();
        run(&mut e, 30);
        e.apply(plan(2, vec![dc, dc2, gain(src(1, false))], chain(3)))
            .unwrap();
        let o = gain_out(&mut e, 10);
        assert!(o.iter().all(|x| x.is_finite() && *x <= 0.5 + 1e-6));
    }

    #[test]
    fn deleting_a_muted_frames_out_stays_silent_while_it_fades() {
        let mut o = out("o", 0, 1.0);
        o.gate = Some(0);
        let mut e = Engine::new(SR, 1);
        e.apply(with_frames(
            plan(1, vec![osc("s"), o], chain(2)),
            vec![framed("g1", true, &[], &[1])],
        ))
        .unwrap();
        run(&mut e, 30);
        assert!(peak(&run(&mut e, 10)) < 1e-6);
        // the frame and its OUT go: the OUT fades out over 10 ms, still muted
        e.apply(plan(2, vec![osc("s")], chain(1))).unwrap();
        assert!(
            peak(&run(&mut e, 10)) < 1e-6,
            "the muted OUT blipped while fading"
        );
    }

    #[test]
    fn the_frame_meter_reads_what_leaves_and_0_when_muted() {
        let mut e = gated_dc();
        e.process();
        let at = e.layout_frames();
        assert!((e.readouts()[at] - 1.0).abs() < 1e-6);
        e.mute(0, true);
        for _ in 0..30 {
            e.process();
        }
        assert_eq!(e.readouts()[at], 0.0);
    }

    #[test]
    fn an_out_inside_a_muted_frame_goes_silent_while_its_source_runs() {
        let mut o = out("o", 0, 1.0);
        o.gate = Some(0);
        let mut e = Engine::new(SR, 1);
        e.apply(with_frames(
            plan(1, vec![osc("s"), o], chain(2)),
            vec![frame(false, &[], &[1])],
        ))
        .unwrap();
        assert!(peak(&run(&mut e, 40)) > 0.1);
        let meter = e.layout_frames();
        assert!(e.readouts()[meter] > 0.1);
        e.mute(0, true);
        run(&mut e, 20); // 53 ms
        assert!(peak(&run(&mut e, 40)) < 0.001);
        assert!(peak(e.output(0, 0)) > 0.5, "the source keeps running");
        assert_eq!(e.readouts()[meter], 0.0);
    }

    #[test]
    fn preparing_a_block_at_once_equals_preparing_it_sample_by_sample() {
        for name in ["all-a", "all-b", "200", "frames"] {
            let path = format!(
                "{}/tests/fixtures/plan-{name}.json",
                env!("CARGO_MANIFEST_DIR")
            );
            let plan = crate::plan::decode(&std::fs::read(path).unwrap()).unwrap();
            let mut fast = Engine::new(SR, 7);
            let mut slow = Engine::new(SR, 7);
            slow.per_sample = true;
            fast.apply(plan.clone()).unwrap();
            slow.apply(plan).unwrap();
            for b in 0..400 {
                if b == 100 {
                    // a glide and a mute mid-run
                    fast.knob(0, 0, 0.9);
                    slow.knob(0, 0, 0.9);
                    fast.mute(0, true);
                    slow.mute(0, true);
                }
                let a = *fast.process().0;
                let c = *slow.process().0;
                assert_eq!(a, c, "{name}: block {b} differs");
            }
        }
    }

    #[test]
    fn a_nested_frame_at_ratio_1_ticks_exactly_with_its_parent_at_any_tempo() {
        // 130 BPM: beats of 22 153.8 samples start anywhere in a block, so pulses straddle block ends
        let parent = node("g1", "clock", &[], &[1.0, 130.0], vec![none(Kind::Trigger)]);
        let mut clk = none(Kind::Trigger);
        clk.normal = Some(NormalPlan::Own {
            node: 0,
            port: 0,
            late: false,
        });
        let child = node("g2", "clock", &[], &[0.0, 120.0], vec![clk]);
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![parent, child], chain(2))).unwrap();
        let (mut p, mut c) = (Vec::new(), Vec::new());
        for _ in 0..3000 {
            e.process();
            p.extend_from_slice(e.output(0, 0));
            c.extend_from_slice(e.output(1, 0));
        }
        let rises = |s: &[f32]| {
            (1..s.len())
                .filter(|&i| s[i] > 0.5 && s[i - 1] <= 0.5)
                .count()
        };
        assert!(rises(&p) >= 16);
        assert_eq!(rises(&c), rises(&p));
    }

    #[test]
    fn a_nested_frame_takes_its_parents_clock_through_its_ratio() {
        // node 0: the parent frame's clock, own clock on at 120 BPM; node 1: the child, clock off, ÷2
        let parent = node("g1", "clock", &[], &[1.0, 120.0], vec![none(Kind::Trigger)]);
        let mut clk = none(Kind::Trigger);
        clk.normal = Some(NormalPlan::Own {
            node: 0,
            port: 0,
            late: false,
        });
        clk.ratio = -2;
        let child = node("g2", "clock", &[], &[0.0, 120.0], vec![clk]);
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![parent, child], chain(2))).unwrap();
        let mut out = Vec::new();
        for _ in 0..1600 {
            e.process();
            out.extend_from_slice(e.output(1, 0));
        }
        let r: Vec<usize> = (1..out.len())
            .filter(|&i| out[i] > 0.5 && out[i - 1] <= 0.5)
            .collect();
        assert!(r.len() >= 3, "{r:?}");
        for w in r.windows(2) {
            assert!((w[1] - w[0]).abs_diff(48_000) <= 2, "{r:?}");
        }
    }

    #[test]
    fn a_cable_carries_samples() {
        let mut e = Engine::new(SR, 1);
        let gain = node(
            "g",
            "gain",
            &[0.5],
            &[],
            vec![input(vec![src(0, false)], Kind::Sum), none(Kind::Cv)],
        );
        e.apply(plan(
            1,
            vec![
                node("d", "dc", &[dcv(0.5)], &[], vec![none(Kind::Cv)]),
                gain,
            ],
            chain(2),
        ))
        .unwrap();
        run(&mut e, 1);
        assert!(e.output(1, 0).iter().all(|x| (x - 0.5).abs() < 1e-6));
    }

    #[test]
    fn two_cables_into_an_audio_input_sum() {
        let mut e = Engine::new(SR, 1);
        let gain = node(
            "g",
            "gain",
            &[0.5],
            &[],
            vec![
                input(vec![src(0, false), src(1, false)], Kind::Sum),
                none(Kind::Cv),
            ],
        );
        let a = node("a", "dc", &[dcv(0.3)], &[], vec![none(Kind::Cv)]);
        let b = node("b", "dc", &[dcv(0.2)], &[], vec![none(Kind::Cv)]);
        e.apply(plan(1, vec![a, b, gain], chain(3))).unwrap();
        run(&mut e, 1);
        assert!((e.output(2, 0)[64] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_mod_jack_sweeps_the_knob_range_and_minus_one_inverts() {
        for (knob, att, want) in [(0.0, 1.0, 2.0), (1.0, -1.0, 0.0), (0.25, 0.5, 1.5)] {
            let mut e = Engine::new(SR, 1);
            let mut mj = input(vec![src(0, false)], Kind::Cv);
            mj.att = att;
            let gain = node(
                "g",
                "gain",
                &[knob],
                &[],
                vec![input(vec![src(0, false)], Kind::Sum), mj],
            );
            e.apply(plan(
                1,
                vec![
                    node("d", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]),
                    gain,
                ],
                chain(2),
            ))
            .unwrap();
            run(&mut e, 1);
            assert!(
                (e.output(1, 0)[64] - want).abs() < 1e-5,
                "knob {knob} att {att}: {}",
                e.output(1, 0)[64]
            );
        }
    }

    #[test]
    fn a_knob_change_glides_over_10_ms() {
        let mut e = Engine::new(SR, 1);
        let gain = node(
            "g",
            "gain",
            &[0.0],
            &[],
            vec![input(vec![src(0, false)], Kind::Sum), none(Kind::Cv)],
        );
        e.apply(plan(
            1,
            vec![
                node("d", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]),
                gain,
            ],
            chain(2),
        ))
        .unwrap();
        run(&mut e, 1);
        e.knob(1, 0, 0.5);
        run(&mut e, 2); // 256 samples ≈ 5.3 ms
        let mid = e.output(1, 0)[127];
        assert!(mid > 0.45 && mid < 0.6, "half way: {mid}");
        run(&mut e, 2);
        assert!((e.output(1, 0)[127] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_non_finite_output_is_zeroed_and_the_module_reset() {
        let before = BOOM_RESETS.load(Ordering::Relaxed);
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![node("b", "boom", &[], &[], vec![])], chain(1)))
            .unwrap();
        run(&mut e, 2);
        assert!(e.output(0, 0).iter().all(|x| *x == 0.0));
        assert!(BOOM_RESETS.load(Ordering::Relaxed) > before);
    }

    #[test]
    fn state_and_trace_reach_the_readouts() {
        let mut e = Engine::new(SR, 1);
        let p = plan(1, vec![node("s", "stater", &[], &[], vec![])], chain(1));
        let l = p.layout.nodes[0];
        e.apply(p).unwrap();
        run(&mut e, 1);
        assert_eq!(e.readouts()[l.state], 3.0);
        let t = l.trace.expect("a scope display has a trace");
        assert!(e.readouts()[t..t + crate::dsp::TRACE_LEN]
            .iter()
            .enumerate()
            .all(|(i, v)| *v == i as f32));
    }

    #[test]
    fn readout_one_holds_the_master_peak() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![osc("o"), out("x", 0, 1.0)], chain(2)))
            .unwrap();
        run(&mut e, 20);
        let (l, _) = e.process();
        let want = peak(l);
        assert!((e.readouts()[1] - want).abs() < 1e-6 && want > 0.5);
    }

    #[test]
    fn listen_replaces_the_output() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![osc("o"), out("x", 0, 0.0)], chain(2)))
            .unwrap();
        assert!(peak(&run(&mut e, 20)) < 1e-4, "OUT at level 0 is silent");
        e.listen(Some((0, 0)));
        assert!(peak(&run(&mut e, 20)) > 0.5);
        e.listen(None);
        assert!(peak(&run(&mut e, 200)[25_000..]) < 1e-3);
    }

    #[test]
    fn a_per_sample_loop_matches_a_hand_computation() {
        // y[n] = 0.5 · (1 + y[n−1])
        let mut e = Engine::new(SR, 1);
        let gain = node(
            "g",
            "gain",
            &[0.25],
            &[],
            vec![
                input(vec![src(0, false), src(1, true)], Kind::Sum),
                none(Kind::Cv),
            ],
        );
        e.apply(plan(
            1,
            vec![
                node("d", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]),
                gain,
            ],
            vec![Step::Node { node: 0 }, Step::Loop { members: vec![1] }],
        ))
        .unwrap();
        run(&mut e, 1);
        let y = e.output(1, 0);
        for (i, want) in [0.5, 0.75, 0.875, 0.9375].iter().enumerate() {
            assert!((y[i] - want).abs() < 1e-6, "y[{i}] = {}", y[i]);
        }
    }

    #[test]
    fn a_changed_input_crossfades_over_10_ms() {
        let mut e = Engine::new(SR, 1);
        let a = || node("a", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]);
        let b = || node("b", "dc", &[dcv(0.0)], &[], vec![none(Kind::Cv)]);
        let gain = |from| {
            node(
                "g",
                "gain",
                &[0.5],
                &[],
                vec![input(vec![src(from, false)], Kind::Sum), none(Kind::Cv)],
            )
        };
        e.apply(plan(1, vec![a(), b(), gain(0)], chain(3))).unwrap();
        run(&mut e, 1);
        e.apply(plan(2, vec![a(), b(), gain(1)], chain(3))).unwrap();
        run(&mut e, 2);
        let mid = e.output(2, 0)[0]; // sample 128 ≈ 2.7 ms in
        assert!(mid > 0.6 && mid < 0.8, "mid fade: {mid}");
        run(&mut e, 3);
        assert!(e.output(2, 0)[127].abs() < 1e-6);
    }

    #[test]
    fn a_removed_node_ramps_out_over_10_ms() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![osc("o"), out("x", 0, 1.0)], chain(2)))
            .unwrap();
        run(&mut e, 40);
        e.apply(plan(2, vec![osc("o")], chain(1))).unwrap();
        let after = run(&mut e, 10);
        assert!(peak(&after[..64]) > 0.1, "not cut at once");
        assert!(
            peak(&after[(480 + 128)..]) < 0.02,
            "gone after 10 ms + 1 block: {}",
            peak(&after[608..])
        );
    }

    /// the largest jump between neighbouring samples
    fn max_step(s: &[f32]) -> f32 {
        s.windows(2).fold(0.0, |a, w| a.max((w[1] - w[0]).abs()))
    }
    fn sine(id: &str) -> PlanNode {
        let mut n = osc(id);
        n.fixed = vec![0.0]; // SIN
        n
    }

    #[test]
    fn deleting_a_playing_source_does_not_click() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![sine("o"), out("x", 0, 1.0)], chain(2)))
            .unwrap();
        let before = run(&mut e, 40);
        let normal = max_step(&before[2000..]);
        e.apply(plan(
            2,
            vec![out("x", 0, 1.0)]
                .into_iter()
                .map(|mut n| {
                    n.inputs[0].sources.clear();
                    n
                })
                .collect(),
            chain(1),
        ))
        .unwrap();
        let mut joined = before[before.len() - 128..].to_vec();
        joined.extend(run(&mut e, 10));
        assert!(
            max_step(&joined) < normal * 2.0 + 0.01,
            "step {} vs {}",
            max_step(&joined),
            normal
        );
    }

    #[test]
    fn deleting_a_playing_out_does_not_click() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![sine("o"), out("x", 0, 1.0)], chain(2)))
            .unwrap();
        let before = run(&mut e, 40);
        let normal = max_step(&before[2000..]);
        e.apply(plan(2, vec![sine("o")], chain(1))).unwrap();
        let mut joined = before[before.len() - 128..].to_vec();
        joined.extend(run(&mut e, 10));
        assert!(
            max_step(&joined) < normal * 2.0 + 0.01,
            "step {} vs {}",
            max_step(&joined),
            normal
        );
    }

    #[test]
    fn deleting_source_and_out_together_does_not_click() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![sine("o"), out("x", 0, 1.0)], chain(2)))
            .unwrap();
        let before = run(&mut e, 40);
        let normal = max_step(&before[2000..]);
        e.apply(plan(2, vec![], vec![])).unwrap();
        let mut joined = before[before.len() - 128..].to_vec();
        joined.extend(run(&mut e, 10));
        assert!(
            max_step(&joined) < normal * 2.0 + 0.01,
            "step {} vs {}",
            max_step(&joined),
            normal
        );
    }

    #[test]
    fn a_mix_fed_back_into_itself_stays_bounded_and_recovers() {
        let mut e = Engine::new(SR, 1);
        let mix = |looped: bool| {
            let mut a = input(vec![src(0, false)], Kind::Sum);
            if looped {
                a.sources.push(src(1, true));
            }
            node(
                "m",
                "mix",
                &[1.0, 1.0, 1.0, 1.0],
                &[],
                vec![
                    a,
                    none(Kind::Sum),
                    none(Kind::Sum),
                    none(Kind::Sum),
                    none(Kind::Cv),
                    none(Kind::Cv),
                    none(Kind::Cv),
                    none(Kind::Cv),
                ],
            )
        };
        let dc = || node("d", "dc", &[dcv(10.0)], &[], vec![none(Kind::Cv)]);
        e.apply(plan(
            1,
            vec![dc(), mix(true), out("x", 1, 1.0)],
            vec![
                Step::Node { node: 0 },
                Step::Loop { members: vec![1] },
                Step::Node { node: 2 },
            ],
        ))
        .unwrap();
        for _ in 0..(SR as usize / BLOCK) {
            let (l, r) = e.process();
            assert!(l
                .iter()
                .chain(r.iter())
                .all(|x| x.is_finite() && x.abs() <= 1.0));
        }
        // the loop cable removed and the DC source silenced
        e.apply(plan(
            2,
            vec![
                node("d", "dc", &[dcv(0.0)], &[], vec![none(Kind::Cv)]),
                mix(false),
                out("x", 1, 1.0),
            ],
            chain(3),
        ))
        .unwrap();
        let after = run(&mut e, (0.6 * SR) as usize / BLOCK);
        assert!(
            peak(&after[(0.5 * SR) as usize..]) < 0.01,
            "still {}",
            peak(&after[(0.5 * SR) as usize..])
        );
    }

    #[test]
    fn a_delay_fed_back_into_itself_stays_finite() {
        let mut e = Engine::new(SR, 1);
        // DELAY at 0.95 feedback with its own output cabled into its input, fed by a saw
        let delay = node(
            "d",
            "delay",
            &[0.55, 1.0, 0.5, 0.0],
            &[0.0, 0.0],
            vec![
                input(vec![src(0, false), src(1, true)], Kind::Sum),
                none(Kind::Trigger),
                none(Kind::Cv),
                none(Kind::Cv),
                none(Kind::Cv),
                none(Kind::Cv),
            ],
        );
        e.apply(plan(
            1,
            vec![osc("o"), delay, out("x", 1, 1.0)],
            vec![
                Step::Node { node: 0 },
                Step::Loop { members: vec![1] },
                Step::Node { node: 2 },
            ],
        ))
        .unwrap();
        for _ in 0..(5.0 * SR) as usize / BLOCK {
            let (l, r) = e.process();
            assert!(l
                .iter()
                .chain(r.iter())
                .all(|x| x.is_finite() && x.abs() <= 1.0));
        }
    }

    #[test]
    fn a_fixed_message_changes_an_option_without_a_plan() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![osc("o"), out("x", 0, 1.0)], chain(2)))
            .unwrap();
        run(&mut e, 4);
        let square = |e: &Engine| e.output(0, 0).iter().filter(|x| x.abs() > 0.95).count();
        assert!(square(&e) < 64, "a saw first");
        e.fixed(0, 0, 3.0); // WAVE → SQR
        run(&mut e, 2);
        assert!(square(&e) > 100, "now a square: {}", square(&e));
        e.fixed(9, 9, 1.0); // out of range: ignored
    }

    #[test]
    fn malformed_plans_are_refused() {
        let good = || plan(1, vec![osc("o"), out("x", 0, 1.0)], chain(2));
        let mut e = Engine::new(SR, 1);
        e.apply(good()).unwrap();
        let mut no_fixed = good();
        no_fixed.nodes[0].fixed.clear();
        assert!(matches!(e.apply(no_fixed), Err(PlanError::Invalid(_))));
        let mut small = good();
        small.layout.size = 3;
        assert!(matches!(e.apply(small), Err(PlanError::Invalid(_))));
        let mut short = good();
        short.layout.nodes.pop();
        short.steps.clear();
        assert!(matches!(e.apply(short), Err(PlanError::Invalid(_))));
        // the old plan is still playing
        assert!(peak(&run(&mut e, 10)) > 0.3);
    }

    #[test]
    fn runaway_feedback_stays_finite_and_within_one() {
        let mut e = Engine::new(SR, 1);
        let gain = node(
            "g",
            "gain",
            &[0.95],
            &[],
            vec![
                input(vec![src(0, false), src(1, true)], Kind::Sum),
                none(Kind::Cv),
            ],
        );
        let nodes = vec![
            node("d", "dc", &[dcv(0.1)], &[], vec![none(Kind::Cv)]),
            gain,
            out("x", 1, 1.0),
        ];
        e.apply(plan(
            1,
            nodes,
            vec![
                Step::Node { node: 0 },
                Step::Loop { members: vec![1] },
                Step::Node { node: 2 },
            ],
        ))
        .unwrap();
        for _ in 0..(2.0 * SR) as usize / BLOCK {
            let (l, r) = e.process();
            assert!(l
                .iter()
                .chain(r.iter())
                .all(|x| x.is_finite() && x.abs() <= 1.0));
        }
    }

    #[test]
    fn cv_inputs_apply_the_attenuverter_and_normals() {
        let mut e = Engine::new(SR, 1);
        let mut patched = input(vec![src(0, false)], Kind::Cv);
        patched.att = -0.5;
        let mut normalled = none(Kind::Cv);
        normalled.normal = Some(NormalPlan::Value { value: 0.25 });
        let nodes = vec![
            node("d", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]),
            node("a", "cvthru", &[], &[], vec![patched]),
            node("b", "cvthru", &[], &[], vec![normalled]),
        ];
        e.apply(plan(1, nodes, chain(3))).unwrap();
        run(&mut e, 1);
        assert!((e.output(1, 0)[10] + 0.5).abs() < 1e-6);
        assert!((e.output(2, 0)[10] - 0.25).abs() < 1e-6);
    }

    #[test]
    fn a_trigger_input_counts_and_pulses() {
        let mut e = Engine::new(SR, 1);
        let p = plan(
            1,
            vec![
                node("d", "dc", &[dcv(1.0)], &[], vec![none(Kind::Cv)]),
                node(
                    "t",
                    "trig",
                    &[],
                    &[],
                    vec![input(vec![src(0, false)], Kind::Trigger)],
                ),
            ],
            chain(2),
        );
        let trig_at = p.layout.nodes[1].trigs;
        e.apply(p).unwrap();
        run(&mut e, 1);
        assert_eq!(
            e.output(1, 0).iter().filter(|x| **x > 0.5).count(),
            48,
            "a 1 ms pulse"
        );
        run(&mut e, 4);
        assert_eq!(e.readouts()[trig_at], 1.0);
    }

    #[test]
    fn readouts_hold_seq_knob_positions_and_output_peaks() {
        let mut e = Engine::new(SR, 1);
        let gain = node(
            "g",
            "gain",
            &[0.5],
            &[],
            vec![input(vec![src(0, false)], Kind::Sum), none(Kind::Cv)],
        );
        let p = plan(
            7,
            vec![
                node("d", "dc", &[dcv(0.5)], &[], vec![none(Kind::Cv)]),
                gain,
            ],
            chain(2),
        );
        let (k, o) = (p.layout.nodes[1].knobs, p.layout.nodes[0].outs);
        e.apply(p).unwrap();
        run(&mut e, 1);
        let r = e.readouts();
        assert_eq!(r[0], 7.0);
        assert_eq!(r[1], 0.0, "nothing reaches the speakers here");
        assert!((r[k] - 0.5).abs() < 1e-6);
        assert!((r[o] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn an_unknown_type_is_refused_and_the_old_plan_keeps_playing() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![osc("o"), out("x", 0, 1.0)], chain(2)))
            .unwrap();
        run(&mut e, 5);
        let mut bad = plan(2, vec![osc("o"), out("x", 0, 1.0)], chain(2));
        bad.nodes[1].type_ = "nope".into();
        assert_eq!(e.apply(bad), Err(PlanError::UnknownType("nope".into())));
        assert!(peak(&run(&mut e, 10)) > 0.3);
    }

    #[test]
    fn a_source_index_out_of_range_is_refused() {
        let mut e = Engine::new(SR, 1);
        assert!(matches!(
            e.apply(plan(1, vec![out("x", 5, 1.0)], chain(1))),
            Err(PlanError::Invalid(_))
        ));
    }
}
