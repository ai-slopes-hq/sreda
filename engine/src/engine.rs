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

/// A source: which output buffer (an index into `Engine::outs`), from which slot and port.
#[derive(Clone, Copy, PartialEq)]
struct Src {
    slot: usize,
    port: usize,
    buf: usize,
    late: bool,
}

#[derive(Clone, Copy)]
enum Norm {
    None,
    /// an own output buffer, read one sample late
    Own(usize),
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
    /// samples of fade-out left once removed from the plan; 0 while in the plan
    fade_left: u32,
    dead: bool,
}

enum StepRt {
    Node(usize),
    Loop(Vec<usize>),
}

pub struct Engine {
    sample_rate: f64,
    fade_len: u32,
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

/// One input's value at sample `i` from a set of sources (late ones read the previous sample).
fn sum(outs: &[[f32; BLOCK]], sources: &[Src], i: usize) -> f32 {
    let mut v = 0.0;
    for s in sources {
        v += outs[s.buf][if s.late { (i + BLOCK - 1) % BLOCK } else { i }];
    }
    v
}

/// Fill a slot's prepared inputs and knob values for sample `i`.
fn prepare(slot: &mut Slot, outs: &[[f32; BLOCK]], i: usize, fade_len: u32) {
    let n_in = slot.n_in;
    for (j, input) in slot.inputs.iter_mut().enumerate() {
        let raw = if let Some(t) = input.trig.as_mut() {
            let mut n = 0;
            for s in &input.sources {
                input.scratch[n] = outs[s.buf][if s.late { (i + BLOCK - 1) % BLOCK } else { i }];
                n += 1;
            }
            if n == 0 {
                if let Norm::Own(b) = input.normal {
                    input.scratch[0] = outs[b][(i + BLOCK - 1) % BLOCK];
                    n = 1;
                }
            }
            t.sample(&input.scratch[..n])
        } else {
            let mut v = if !input.sources.is_empty() {
                sum(outs, &input.sources, i)
            } else {
                match input.normal {
                    Norm::Own(b) => outs[b][(i + BLOCK - 1) % BLOCK],
                    Norm::Value(x) => x,
                    Norm::None | Norm::Internal => 0.0,
                }
            };
            if input.xfade_left > 0 {
                let t = 1.0 - input.xfade_left as f32 / fade_len as f32;
                v = sum(outs, &input.old, i) * (1.0 - t) + v * t;
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
            slot.par[j - n_in][i] = from_knob(&k.spec, k.cur + raw as f64) as f32;
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
            if node.knobs.len() != knobs
                || node.inputs.len() != spec.inputs.len() + knobs
                || node.connected_out.len() != spec.outputs.len()
            {
                return bad("port or knob count");
            }
            specs.push(spec);
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
                if let Some(NormalPlan::Own { node: o, port }) = input.normal {
                    if o >= n || port >= specs[o].outputs.len() {
                        return Err(PlanError::Invalid(format!(
                            "{}: a normal out of range",
                            node.id
                        )));
                    }
                }
            }
        }
        for st in &plan.steps {
            let ok = match st {
                Step::Node { node } => *node < n,
                Step::Loop { members } => members.iter().all(|m| *m < n),
            };
            if !ok || plan.layout.nodes.len() != n {
                return Err(PlanError::Invalid("steps or layout out of range".into()));
            }
        }

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
                input.old.clear();
                input.xfade_left = 0;
                if let Norm::Own(_) = input.normal {
                    input.normal = Norm::None;
                }
            }
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
                        }
                    })
                    .collect();
                let normal = match ip.normal {
                    None => Norm::None,
                    Some(NormalPlan::Value { value }) => Norm::Value(value as f32),
                    Some(NormalPlan::Internal(_)) => Norm::Internal,
                    Some(NormalPlan::Own { node: o, port }) => {
                        Norm::Own(resolve(&self.pool, &slot, order[o], port))
                    }
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
                                ..*s
                            })
                            .collect();
                        rt.xfade_left = fade_len;
                    }
                }
                inputs.push(rt);
            }
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
                    }
                })
                .collect();
            slot.inputs = inputs;
            slot.layout = Some(plan.layout.nodes[i]);
            self.pool[p] = Some(slot);
        }

        self.outs = outs;
        self.steps = plan
            .steps
            .iter()
            .map(|st| match st {
                Step::Node { node } => StepRt::Node(order[*node]),
                Step::Loop { members } => StepRt::Loop(members.iter().map(|m| order[*m]).collect()),
            })
            .collect();
        // buffers moved: the UI re-sends listen after a new plan
        self.listen = None;
        self.order = order;
        self.readouts = vec![0.0; plan.layout.size.max(2)];
        self.seq = plan.seq;
        Ok(())
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
        let fade_len = self.fade_len;
        let steps = std::mem::take(&mut self.steps);
        for st in &steps {
            match st {
                StepRt::Node(p) => {
                    let slot = self.pool[*p].as_mut().unwrap();
                    for i in 0..BLOCK {
                        prepare(slot, &self.outs, i, fade_len);
                    }
                    run(slot, &mut self.outs, &mut self.ctx, 0, BLOCK);
                    guard(slot, &mut self.outs);
                }
                StepRt::Loop(members) => {
                    for i in 0..BLOCK {
                        for p in members {
                            let slot = self.pool[*p].as_mut().unwrap();
                            prepare(slot, &self.outs, i, fade_len);
                            run(slot, &mut self.outs, &mut self.ctx, i, i + 1);
                        }
                    }
                    for p in members {
                        guard(self.pool[*p].as_mut().unwrap(), &mut self.outs);
                    }
                }
            }
        }
        self.steps = steps;

        // removed nodes play on for 10 ms, their contribution to the speakers ramping to silence
        for r in 0..self.retiring.len() {
            let p = self.retiring[r];
            let Some(slot) = self.pool[p].as_mut() else {
                continue;
            };
            if slot.dead {
                continue;
            }
            let saved = self.ctx.master;
            self.ctx.master = [[0.0; BLOCK]; 2];
            for i in 0..BLOCK {
                prepare(slot, &self.outs, i, fade_len);
            }
            run(slot, &mut self.outs, &mut self.ctx, 0, BLOCK);
            guard(slot, &mut self.outs);
            let mine = self.ctx.master;
            self.ctx.master = saved;
            for (ch, buf) in self.ctx.master.iter_mut().enumerate() {
                for (i, x) in buf.iter_mut().enumerate() {
                    *x += mine[ch][i] * slot.fade_left.saturating_sub(i as u32) as f32
                        / fade_len as f32;
                }
            }
            slot.fade_left = slot.fade_left.saturating_sub(BLOCK as u32);
            if slot.fade_left == 0 {
                slot.dead = true;
            }
        }

        self.out = match self.listen {
            Some(b) => [self.outs[b], self.outs[b]],
            None => self.ctx.master,
        };
        let [l, r] = &mut self.out;
        self.master.process(l, r);
        self.readouts[1] = self.out[0].iter().chain(self.out[1].iter()).fold(0.0f32, |a, x| a.max(x.abs()));
        self.write_readouts();
        (&self.out[0], &self.out[1])
    }

    fn write_readouts(&mut self) {
        self.readouts[0] = self.seq as f32;
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
        InputPlan, Kind, NodeLayout, NormalPlan, PlanNode, ReadoutLayout, Source, Step,
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
                NodeLayout { knobs, trigs, outs }
            })
            .collect();
        Plan {
            seq,
            nodes,
            steps,
            layout: ReadoutLayout {
                size: off,
                nodes: layout,
            },
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
    fn readout_one_holds_the_master_peak() {
        let mut e = Engine::new(SR, 1);
        e.apply(plan(1, vec![osc("o"), out("x", 0, 1.0)], chain(2))).unwrap();
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
