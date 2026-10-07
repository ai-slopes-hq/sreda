// The plan: what the Rust engine decodes (engine/src/plan.rs). Field names are the wire format.
export interface Source {
  node: number;
  port: number;
  late: boolean;
}
export interface InputPlan {
  sources: Source[];
  normal: { node: number; port: number } | { value: number } | 'internal' | null;
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
}
export type Step = { node: number } | { loop: number[] };
/** Offsets into the readout buffer; index 0 holds the plan's seq. Counts follow the node's spec. */
export interface ReadoutLayout {
  size: number;
  nodes: { knobs: number; trigs: number; outs: number }[];
}
export interface Plan {
  seq: number;
  nodes: PlanNode[];
  steps: Step[];
  layout: ReadoutLayout;
}

/** Floats in the readout SharedArrayBuffer; compile throws above it. */
export const READOUT_CAPACITY = 262_144;
