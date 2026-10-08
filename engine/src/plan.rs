//! The plan TypeScript compiles (packages/core/src/plan.ts), decoded with serde. Decoding is the only place JSON
//! touches the engine, and it never runs inside `process`.

use serde::Deserialize;

#[derive(Deserialize, Debug, Clone)]
pub struct Source {
    pub node: usize,
    pub port: usize,
    pub late: bool,
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
    /// a node's output (its own, or a parent frame's clock), read one sample late
    Own {
        node: usize,
        port: usize,
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
}

#[derive(Deserialize, Debug, Clone)]
pub struct Plan {
    pub seq: u32,
    pub nodes: Vec<PlanNode>,
    pub steps: Vec<Step>,
    pub layout: ReadoutLayout,
}

#[derive(Debug, PartialEq)]
pub enum PlanError {
    Decode(String),
    UnknownType(String),
    Invalid(String),
}

pub fn decode(json: &[u8]) -> Result<Plan, PlanError> {
    serde_json::from_slice(json).map_err(|e| PlanError::Decode(e.to_string()))
}
