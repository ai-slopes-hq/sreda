import type { ModuleSpec } from './spec';

export const HEAD = 32,
  INSET = 6,
  TOP = 38,
  LANE = 32,
  FOOT = 10,
  HP = 56,
  U = 144;
/** A panel is exactly n × 1U high (two 1U stacked line up with a 2U) and holds as many lanes as fit: 3, 7, 12. */
export const lanesOf = (u: number): number => Math.floor((u * U - TOP - FOOT) / LANE);

export interface PanelLayout {
  w: number;
  h: number;
  lanes: number;
  jacks: Record<string, { x: number; y: number }>;
  cells: Record<string, { x: number; y: number; w: number; mode: boolean }>;
  display: { x: number; y: number; w: number; h: number } | null;
  fits: boolean;
}

/**
 * The panel grammar (spec §2): IN column | control area | OUT column; one jack per lane; the control area holds the
 * display (whole lanes, on top), knob rows (2 lanes each) and the mode strip (the bottom lane: options from the
 * left, actions from the right; 1 HP a button, 2 HP for a `▾` list with words). Positions are panel-relative.
 */
export function layoutPanel(spec: ModuleSpec): PanelLayout {
  let L = layouts.get(spec);
  if (!L) layouts.set(spec, (L = computeLayout(spec)));
  return L;
}

/** layouts per spec object: computed once (specs never change at run time) */
const layouts = new WeakMap<ModuleSpec, PanelLayout>();

function computeLayout(spec: ModuleSpec): PanelLayout {
  const visible = spec.params.filter((p) => p.kind === 'action' || !p.hidden);
  const knobs = visible.filter((p) => p.kind === 'knob');
  const modes = visible.filter((p) => p.kind !== 'knob');
  const C = spec.size[0] - 2;
  const lanes = lanesOf(spec.size[1]);
  const w = spec.size[0] * HP;
  const h = spec.size[1] * U;
  const dl = spec.display?.lanes ?? 0;
  const jacks: PanelLayout['jacks'] = {};
  const cells: PanelLayout['cells'] = {};
  spec.inputs.forEach((p, i) => (jacks[p.id] = { x: 13, y: TOP + i * LANE + LANE / 2 }));
  spec.outputs.forEach((p, i) => (jacks[p.id] = { x: w - 13, y: TOP + i * LANE + LANE / 2 }));
  knobs.forEach((p, j) => {
    const x = HP + (j % C) * HP;
    const y = TOP + (dl + Math.floor(j / C) * 2) * LANE;
    cells[p.id] = { x, y, w: HP, mode: false };
    jacks['@' + p.id] = { x: x + 7, y: y + 7 };
  });
  let left = 0;
  let right = 0;
  const my = TOP + (lanes - 1) * LANE;
  for (const p of modes) {
    const hp = p.kind === 'option' && p.options.length > 2 && !p.glyph ? 2 : 1;
    let x: number;
    if (p.kind === 'action') {
      right += hp;
      x = HP + (C - right) * HP;
    } else {
      x = HP + left * HP;
      left += hp;
    }
    cells[p.id] = { x, y: my, w: hp * HP, mode: true };
  }
  const knobRows = C > 0 ? Math.ceil(knobs.length / C) : knobs.length ? Infinity : 0;
  const used = dl + knobRows * 2 + (modes.length ? 1 : 0);
  const fits =
    used <= lanes &&
    left + right <= Math.max(0, C) &&
    Math.max(spec.inputs.length, spec.outputs.length) <= lanes;
  const display = dl ? { x: HP + 4, y: TOP + 2, w: C * HP - 8, h: dl * LANE - 6 } : null;
  return { w, h, lanes, jacks, cells, display, fits };
}
