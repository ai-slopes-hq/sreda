// The plan: what the Rust engine decodes (engine/src/plan.rs). Field names are the wire format.
export interface Source {
  node: number;
  port: number;
  late: boolean;
  /** the frame (index in doc.groups) that silences this cable when muted: the innermost one it leaves */
  gate?: number;
}
export interface InputPlan {
  sources: Source[];
  /** a node's output (own: one sample late; a parent frame's clock: `late` false, it has run already) */
  normal: { node: number; port: number; late?: boolean } | { value: number } | 'internal' | null;
  kind: 'sum' | 'cv' | 'trigger';
  att: number;
  ratio: number;
}
export interface PlanNode {
  id: string;
  type: string;
  /** visible knobs, positions 0…1, spec order */
  knobs: number[];
  /** options (index) and hidden knobs (real units), spec order */
  fixed: number[];
  /** inputPorts(spec) order: inputs, then mod jacks */
  inputs: InputPlan[];
  connectedOut: boolean[];
  /** OUT nodes: the frame whose mute silences their speaker output */
  gate?: number;
}
/** A frame, for mute and its meter: what leaves it (audio sources of leaving cables, OUT nodes inside). */
export interface FramePlan {
  /** the frame's id: the engine keeps its mute gain by it across plans */
  id: string;
  muted: boolean;
  sources: { node: number; port: number }[];
  outs: number[];
}
export type Step = { node: number } | { loop: number[] };
/** Offsets into the readout buffer; index 0 holds the plan's seq, 1 the master peak. Counts follow the node's spec. */
export interface NodeReadouts {
  knobs: number;
  trigs: number;
  outs: number;
  /** one float: the module's current index (META-SEQ, SWITCH, SPREAD) */
  state: number;
  /** TRACE_LEN floats: SCOPE min A, max A, min B, max B (256 columns each); GRAINS the write head, 64 grain positions, 512 live peaks */
  trace: number | null;
}
export interface ReadoutLayout {
  size: number;
  nodes: NodeReadouts[];
  /** one float per frame: its meter */
  frames: number;
}
export interface Plan {
  seq: number;
  nodes: PlanNode[];
  steps: Step[];
  frames: FramePlan[];
  layout: ReadoutLayout;
}

export const TRACE_LEN = 1024;

/** Floats in the readout SharedArrayBuffer; compile throws above it. */
export const READOUT_CAPACITY = 262_144;
