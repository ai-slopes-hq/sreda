//! Module specs: ports, params, normals, size and display. Each module declares its own; `pnpm specs` exports them
//! all to `packages/core/src/generated/specs.json`, which TypeScript reads.

use serde::Serialize;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Audio,
    Mod,
    Pitch,
    Trigger,
}

#[derive(Serialize, Clone, Debug)]
pub struct Port {
    pub id: &'static str,
    pub label: &'static str,
    pub role: Role,
}

pub const fn port(id: &'static str, label: &'static str, role: Role) -> Port {
    Port { id, label, role }
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Taper {
    Lin,
    Exp,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    Hz,
    S,
    Note,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Knob {
    pub id: &'static str,
    pub label: &'static str,
    pub min: f64,
    pub max: f64,
    pub def: f64,
    pub taper: Taper,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<Unit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub random_range: Option<(f64, f64)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mod_depth: Option<f64>,
    #[serde(skip_serializing_if = "is_false")]
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph: Option<&'static str>,
}

/// A knob with a linear taper and nothing else set; chain the setters for the rest.
pub fn knob(id: &'static str, label: &'static str, min: f64, max: f64, def: f64) -> Knob {
    Knob {
        id,
        label,
        min,
        max,
        def,
        taper: Taper::Lin,
        step: None,
        unit: None,
        random_range: None,
        mod_depth: None,
        hidden: false,
        glyph: None,
    }
}

impl Knob {
    pub fn exp(mut self) -> Self {
        self.taper = Taper::Exp;
        self
    }
    pub fn step(mut self, step: f64) -> Self {
        self.step = Some(step);
        self
    }
    pub fn unit(mut self, unit: Unit) -> Self {
        self.unit = Some(unit);
        self
    }
    /// The range R randomises within (default: the whole range).
    pub fn random(mut self, lo: f64, hi: f64) -> Self {
        self.random_range = Some((lo, hi));
        self
    }
    /// The default attenuverter of this knob's mod jack (1 when unset).
    pub fn mod_depth(mut self, d: f64) -> Self {
        self.mod_depth = Some(d);
        self
    }
    pub fn hidden(mut self) -> Self {
        self.hidden = true;
        self
    }
    pub fn glyph(mut self, g: &'static str) -> Self {
        self.glyph = Some(g);
        self
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub id: &'static str,
    pub label: &'static str,
    pub options: &'static [&'static str],
    pub def: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glyph: Option<&'static str>,
    #[serde(skip_serializing_if = "is_false")]
    pub hidden: bool,
}

pub fn choice(
    id: &'static str,
    label: &'static str,
    options: &'static [&'static str],
    def: u32,
) -> Choice {
    Choice {
        id,
        label,
        options,
        def,
        glyph: None,
        hidden: false,
    }
}

impl Choice {
    pub fn glyph(mut self, g: &'static str) -> Self {
        self.glyph = Some(g);
        self
    }
    pub fn hidden(mut self) -> Self {
        self.hidden = true;
        self
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Param {
    Knob(Knob),
    Option(Choice),
    Action {
        id: &'static str,
        label: &'static str,
    },
}

impl From<Knob> for Param {
    fn from(k: Knob) -> Self {
        Param::Knob(k)
    }
}

impl From<Choice> for Param {
    fn from(c: Choice) -> Self {
        Param::Option(c)
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct When {
    pub param: &'static str,
    pub value: u32,
}

/// What an input reads while it has no cables.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Normal {
    /// one of the module's own outputs (read one sample late), optionally only while an option has a value
    Own {
        input: &'static str,
        own: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        when: Option<When>,
    },
    /// something inside the DSP (named for display)
    Internal {
        input: &'static str,
        internal: &'static str,
    },
    /// a constant
    Value { input: &'static str, value: f64 },
}

#[derive(Serialize, Clone, Debug)]
pub struct Display {
    pub lanes: u8,
    pub kind: &'static str,
}

#[derive(Serialize, Clone, Debug)]
pub struct ModuleSpec {
    #[serde(rename = "type")]
    pub type_: &'static str,
    pub label: &'static str,
    pub desc: &'static str,
    /// (HP, U)
    pub size: (u8, u8),
    pub inputs: Vec<Port>,
    pub outputs: Vec<Port>,
    pub params: Vec<Param>,
    pub normals: Vec<Normal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<Display>,
}

/// Knob position 0…1 → value: log space for an exp taper, clamped, snapped to the step.
pub fn from_knob(p: &Knob, k: f64) -> f64 {
    let k = k.clamp(0.0, 1.0);
    let v = match p.taper {
        Taper::Exp => p.min * (p.max / p.min).powf(k),
        Taper::Lin => p.min + (p.max - p.min) * k,
    };
    match p.step {
        Some(step) => (v / step).round() * step,
        None => v,
    }
}

/// Value → knob position 0…1.
pub fn to_knob(p: &Knob, v: f64) -> f64 {
    let k = match p.taper {
        Taper::Exp => (v / p.min).ln() / (p.max / p.min).ln(),
        Taper::Lin => (v - p.min) / (p.max - p.min),
    };
    k.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_exp_taper_maps_the_middle_to_the_geometric_mean() {
        let k = knob("cut", "CUT", 20.0, 20_000.0, 1000.0).exp();
        assert!((from_knob(&k, 0.5) - (20.0f64 * 20_000.0).sqrt()).abs() < 1e-6);
        assert!((to_knob(&k, (20.0f64 * 20_000.0).sqrt()) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn a_stepped_knob_snaps() {
        let k = knob("len", "LEN", 1.0, 16.0, 16.0).step(1.0);
        assert_eq!(from_knob(&k, 0.52), 9.0);
    }

    #[test]
    fn from_knob_clamps() {
        let k = knob("x", "X", 0.0, 1.0, 0.5);
        assert_eq!(from_knob(&k, 1.7), 1.0);
        assert_eq!(from_knob(&k, -0.2), 0.0);
    }
}
