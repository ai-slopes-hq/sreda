// Old RHYTHM and STAGES open as META-SEQ (spec §7b, Migration). Runs on the raw document before validation: knobs are
// positions 0…1 and options indices, as saved. A RHYTHM whose GATE feeds only a STAGES' ADV merges with it; every other
// RHYTHM or STAGES converts alone.
import { euclid } from '../generators';
import { laneParam, noteModeParam, writeLane, type Lane } from '../metaseq';

export const FREE_RUNNING_NOTE = 'STAGES › free-running timing now follows a clock';

type Raw = Record<string, unknown>;
type End = [string, string];
type Seq = Raw & { id: string; type: 'rhythm' | 'stages' };

const isObj = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isEnd = (x: unknown): x is End =>
  Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string';
const isCable = (c: unknown): c is { from: End; to: End } => isObj(c) && isEnd(c['from']) && isEnd(c['to']);
const isSeq = (m: unknown): m is Seq =>
  isObj(m) && typeof m['id'] === 'string' && (m['type'] === 'rhythm' || m['type'] === 'stages');

const STEPS = Array.from({ length: 16 }, (_, k) => k);
const paramsOf = (m: Raw): Raw => (isObj(m['params']) ? m['params'] : {});
/** a linear knob's value from its saved position, or its default */
function knob(p: Raw, id: string, min: number, max: number, def: number): number {
  const raw = p[id];
  return isNum(raw) ? min + (max - min) * Math.min(1, Math.max(0, raw)) : def;
}
const option = (p: Raw, id: string, def = 0): number => (isNum(p[id]) ? Math.round(p[id]) : def);

/** RHYTHM's pads as GATE, TIE and ACC: ○ rest, ● hit, — tie; an EUCLID pattern written out from LEN, HITS and ROT. */
function rhythmLanes(p: Raw): { len: number; g: number[]; t: number[]; a: number[] } {
  const len = Math.round(knob(p, 'length', 1, 16, 16));
  const a = STEPS.map((k) => (option(p, `a${k + 1}`) === 1 ? 1 : 0));
  if (option(p, 'mode') === 0) {
    const hits = euclid(len, Math.round(knob(p, 'hits', 0, 16, 5)), Math.round(knob(p, 'rot', 0, 15, 0)));
    return { len, g: STEPS.map((k) => (hits[k] ? 1 : 0)), t: STEPS.map(() => 0), a };
  }
  const pads = STEPS.map((k) => option(p, `g${k + 1}`));
  return { len, g: pads.map((x) => (x === 1 ? 1 : 0)), t: pads.map((x) => (x === 2 ? 1 : 0)), a };
}

/** STAGES' stages: volts → NOTE semitones, slides → TIE, pulses (●) → GATE. */
function stagesLanes(p: Raw): { len: number; n: number[]; t: number[]; g: number[] } {
  return {
    len: Math.round(knob(p, 'length', 1, 16, 16)),
    n: STEPS.map((k) => Math.min(24, Math.max(0, Math.round(knob(p, `v${k + 1}`, -1, 1, 0) * 12 + 12)))),
    t: STEPS.map((k) => (option(p, `g${k + 1}`) === 1 ? 1 : 0)),
    g: STEPS.map((k) => (option(p, `p${k + 1}`) === 0 ? 1 : 0)),
  };
}

/** GEN's EUCLID index, which a lone RHYTHM in EUCLID mode takes */
const GEN_EUCLID = 7;

/** Merged, NOTE is PLAYED: stage k sounds on RHYTHM's k-th hit, so its slide goes on that hit's step (stages past the
 * hits of one RHYTHM cycle wrap over them; with no hits there is nowhere to slide). */
function slidesOnHits(rl: { len: number; g: number[] }, sl: { len: number; t: number[] }): number[] {
  const hits = STEPS.filter((k) => k < rl.len && rl.g[k] === 1);
  const out = STEPS.map(() => 0);
  if (hits.length === 0) return out;
  for (let k = 0; k < sl.len; k++) if (sl.t[k] === 1) out[hits[k % hits.length]!] = 1;
  return out;
}

/** META-SEQ's params (pattern A) from a RHYTHM, a STAGES, or both, in their saved form (knob positions, option
 * indices). The factory builds its sequencers through this too. */
export function seqParams(r: Raw | null, s: Raw | null): Record<string, number> {
  const out: Record<string, number> = {};
  const lane = (l: Lane, values: number[], len: number) => {
    Object.assign(out, writeLane(0, l, values));
    out[laneParam(0, l, 'len')] = (len - 1) / 15;
  };
  const rl = r && rhythmLanes(r);
  const sl = s && stagesLanes(s);
  if (rl) {
    lane('g', rl.g, rl.len);
    const slides = sl && slidesOnHits(rl, sl);
    lane('t', slides ? rl.t.map((x, k) => Math.max(x, slides[k]!)) : rl.t, rl.len);
    lane('a', rl.a, rl.len);
    if (!sl && r && option(r, 'mode') === 0) out['gen'] = GEN_EUCLID;
  } else if (sl) {
    lane('g', sl.g, sl.len);
    lane('t', sl.t, sl.len);
  }
  if (sl && s) {
    lane('n', sl.n, sl.len);
    out[noteModeParam(0)] = rl ? 0 : 1; // merged: PLAYED; alone: STEP
    for (const id of ['scale', 'root', 'gen']) if (isNum(s[id])) out[id] = s[id];
  }
  return out;
}

/** The META-SEQ port an old one's port becomes, or null when it has none. */
function portFor(type: 'rhythm' | 'stages', port: string, merged: boolean): string | null {
  if (['clk', 'reset', 'dice', 'gate', 'acc', 'eoc', 'cv'].includes(port)) return port;
  if (type === 'stages' && port === 'pulse') return 'gate';
  if (type === 'stages' && port === 'adv' && !merged) return 'clk';
  return null;
}
const portLabel = (port: string) => (port === '@length' ? 'LEN' : port.replace('@', '').toUpperCase());

/** Every RHYTHM and STAGES in `json` as a META-SEQ; what the user should know goes to `notes` (each once). The same
 * object comes back when there is nothing to migrate. */
export function migrateSequencers(json: unknown, notes: string[]): unknown {
  if (!isObj(json) || !Array.isArray(json['modules']) || !Array.isArray(json['cables'])) return json;
  const modules = json['modules'] as unknown[];
  if (!modules.some(isSeq)) return json;
  const cables = json['cables'] as unknown[];
  const groups = Array.isArray(json['groups']) ? json['groups'] : [];
  const note = (text: string) => {
    if (!notes.includes(text)) notes.push(text);
  };
  const seqs = new Map(modules.filter(isSeq).map((m) => [m.id, m]));
  const wired = cables.filter(isCable);
  const into = (id: string, port: string) => wired.filter((c) => c.to[0] === id && c.to[1] === port);

  // RHYTHM id → the STAGES it merges into
  const mergeInto = new Map<string, string>();
  for (const r of seqs.values()) {
    if (r.type !== 'rhythm') continue;
    const out = wired.filter((c) => c.from[0] === r.id && c.from[1] === 'gate');
    const to = out.length === 1 ? out[0]!.to : null;
    if (to && seqs.get(to[0])?.type === 'stages' && to[1] === 'adv' && into(to[0], 'adv').length === 1)
      mergeInto.set(r.id, to[0]);
  }
  const rhythmOf = new Map([...mergeInto].map(([r, s]) => [s, seqs.get(r)!]));

  const num = (id: unknown) => Number(/^[mg](\d+)$/.exec(String(id))?.[1] ?? 0);
  const ids = [...modules, ...groups].map((x) => (isObj(x) ? num(x['id']) : 0));
  let nextId = Math.max(isNum(json['nextId']) ? json['nextId'] : 1, Math.max(0, ...ids) + 1);
  const frames = new Set(groups.map((g) => (isObj(g) ? g['id'] : null)));

  const outModules: unknown[] = [];
  const added: { from: End; to: End }[] = [];
  for (const m of modules) {
    if (!isSeq(m)) {
      outModules.push(m);
      continue;
    }
    if (mergeInto.has(m.id)) continue;
    const r = m.type === 'rhythm' ? m : (rhythmOf.get(m.id) ?? null);
    const s = m.type === 'stages' ? m : null;
    const ratios: Record<string, number> = {};
    for (const src of [s, r]) {
      const given = src && isObj(src['ratios']) ? src['ratios'] : {};
      for (const [port, v] of Object.entries(given)) {
        const to = portFor(src!.type, port, src === s && r !== null);
        if (to && isNum(v)) ratios[to] = v; // RHYTHM's last: it wins
      }
    }
    outModules.push({
      id: m.id,
      type: 'metaseq',
      x: m['x'],
      y: m['y'],
      parent: m['parent'] ?? null,
      params: seqParams(r && paramsOf(r), s && paramsOf(s)),
      atts: {},
      ratios,
    });
    // a free-running STAGES follows its frame's clock, or a cycling SLOPE beside it
    if (s && !r && into(s.id, 'adv').length === 0) {
      note(FREE_RUNNING_NOTE);
      const parent = s['parent'];
      if (typeof parent === 'string' && frames.has(parent)) added.push({ from: [parent, 'clkOut'], to: [s.id, 'clk'] });
      else {
        const id = `m${nextId++}`;
        const x = isNum(s['x']) ? s['x'] - 300 : 0;
        outModules.push({ id, type: 'slope', x, y: s['y'], parent: null, params: { cycle: 1 }, atts: {}, ratios: {} });
        added.push({ from: [id, 'eoc'], to: [s.id, 'clk'] });
      }
    }
  }

  // cables follow: a merged RHYTHM's to the STAGES' id; a port without a place is dropped with a note
  const end = (e: End, isInput: boolean): End | null => {
    const m = seqs.get(e[0]);
    if (!m) return e;
    const merged = m.type === 'rhythm' ? mergeInto.has(m.id) : rhythmOf.has(m.id);
    const port = portFor(m.type, e[1], merged);
    if (port === null && isInput) note(`${m.type.toUpperCase()} › ${portLabel(e[1])} is gone; its cable was removed`);
    return port === null ? null : [mergeInto.get(e[0]) ?? e[0], port];
  };
  // an input takes one cable: a merged RHYTHM's win over the STAGES'
  const rhythmFed = new Set(
    wired.filter((c) => mergeInto.has(c.to[0])).map((c) => `${mergeInto.get(c.to[0])}:${c.to[1]}`),
  );
  const mapped: unknown[] = [];
  const seen = new Set<string>();
  for (const c of cables) {
    if (!isCable(c)) {
      mapped.push(c);
      continue;
    }
    if (mergeInto.get(c.from[0]) === c.to[0] && c.from[1] === 'gate' && c.to[1] === 'adv') continue;
    if (rhythmOf.has(c.to[0]) && rhythmFed.has(`${c.to[0]}:${c.to[1]}`)) continue;
    const from = end(c.from, false);
    const to = end(c.to, true);
    const key = JSON.stringify([from, to]);
    if (!from || !to || seen.has(key)) continue;
    seen.add(key);
    mapped.push({ from, to });
  }
  return { ...json, modules: outModules, cables: [...mapped, ...added], nextId };
}
