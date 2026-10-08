//! The plan TypeScript compiles (packages/core/src/plan.ts), decoded with serde. Decoding is the only place JSON
//! touches the engine, and it never runs inside `process`.

use serde::Deserialize;

#[derive(Deserialize, Debug, Clone)]
pub struct Source {
    pub node: usize,
    pub port: usize,
    pub late: bool,
    /// the frame whose mute silences this cable (the innermost one it leaves)
    #[serde(default)]
    pub gate: Option<usize>,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Sum,
    Cv,
    Trigger,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum InternalTag {
    #[serde(rename = "internal")]
    Internal,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum NormalPlan {
    /// a node's output: its own (read one sample late), or a parent frame's clock (`late` false when that clock has
    /// already run this sample — it runs earlier)
    Own {
        node: usize,
        port: usize,
        #[serde(default = "yes")]
        late: bool,
    },
    Value {
        value: f64,
    },
    Internal(InternalTag),
}

#[derive(Deserialize, Debug, Clone)]
pub struct InputPlan {
    pub sources: Vec<Source>,
    pub normal: Option<NormalPlan>,
    pub kind: Kind,
    pub att: f64,
    pub ratio: i32,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanNode {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub knobs: Vec<f64>,
    pub fixed: Vec<f64>,
    pub inputs: Vec<InputPlan>,
    pub connected_out: Vec<bool>,
    /// OUT nodes: the frame whose mute silences their speaker output
    #[serde(default)]
    pub gate: Option<usize>,
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct NodePort {
    pub node: usize,
    pub port: usize,
}

/// A frame: its mute state and what its meter reads (the audio leaving it, the OUT nodes inside it).
#[derive(Deserialize, Debug, Clone)]
pub struct FramePlan {
    /// the frame's id: a gain follows its frame across plans
    #[serde(default)]
    pub id: String,
    pub muted: bool,
    pub sources: Vec<NodePort>,
    pub outs: Vec<usize>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum Step {
    Node {
        node: usize,
    },
    Loop {
        #[serde(rename = "loop")]
        members: Vec<usize>,
    },
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct NodeLayout {
    pub knobs: usize,
    pub trigs: usize,
    pub outs: usize,
    /// one float: the DSP's `state()`
    pub state: usize,
    /// `TRACE_LEN` floats for a scope display
    pub trace: Option<usize>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct ReadoutLayout {
    pub size: usize,
    pub nodes: Vec<NodeLayout>,
    /// one float per frame (its meter) from here
    #[serde(default)]
    pub frames: usize,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Plan {
    pub seq: u32,
    pub nodes: Vec<PlanNode>,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub frames: Vec<FramePlan>,
    pub layout: ReadoutLayout,
}

#[derive(Debug, PartialEq)]
pub enum PlanError {
    Decode(String),
    UnknownType(String),
    Invalid(String),
}

fn yes() -> bool {
    true
}

pub fn decode(json: &[u8]) -> Result<Plan, PlanError> {
    serde_json::from_slice(json).map_err(|e| PlanError::Decode(e.to_string()))
}
