// The styles (spec §6, revision 36). Each says its tempo, scales, which roles play (and with which parts), its effect
// chains and its twist pool (the twists themselves are in `twists.ts`).
import { SCALES } from '../../generators';
import {
  acidEcho,
  berlinEcho,
  delayReverb,
  digiEcho,
  driveReverb,
  droneEcho,
  dubEcho,
  glitchEcho,
  none,
  reverbKind,
} from './fx';
import type { DiceStyleId, Style } from './types';

const MINOR = [2, 3, 4, 5];
const ALL_SCALES = SCALES.map((_, i) => i);
const TWISTS: [0, 3] = [0, 3];

const techno: Style = {
  id: 'techno',
  label: 'techno',
  bpm: [125, 138],
  scales: MINOR,
  roles: [
    { role: 'drums', p: 0.9, parts: [['drums-techno', 1]] },
    {
      role: 'bass',
      p: 1,
      parts: [
        ['bass-pulse', 3],
        ['bass-reese', 2],
        ['bass-fm', 2],
      ],
    },
    { role: 'line', p: 0.35, parts: [['stab', 1]] },
  ],
  fx: [[delayReverb('tight'), 1]],
  twists: [
    ['fm', 1],
    ['shaper', 2],
    ['chance', 1],
    ['feedback', 1],
    ['switch', 1],
  ],
  twistCount: TWISTS,
};

const acid: Style = {
  id: 'acid',
  label: 'acid',
  bpm: [120, 140],
  scales: MINOR,
  roles: [
    { role: 'bass', p: 1, parts: [['bass-acid', 1]] },
    // a second line: a sub under the first, or another acid line
    {
      role: 'bass',
      p: 0.3,
      parts: [
        ['bass-sub', 2],
        ['bass-acid', 1],
      ],
    },
    { role: 'drums', p: 0.7, parts: [['drums-acid', 1]] },
    // hats or a little percussion of their own, over the kit or alone
    {
      role: 'drums',
      p: 0.4,
      parts: [
        ['hats-noise', 2],
        ['hats-metal', 1],
        ['hats-comb', 1],
        ['perc-tom', 1],
        ['perc-ping', 1],
      ],
    },
  ],
  fx: [
    [none, 1],
    [acidEcho, 2],
  ],
  twists: [
    ['shaper', 2],
    ['snh', 2],
    ['chance', 1],
    ['fm', 1],
    ['feedback', 1],
  ],
  twistCount: TWISTS,
};

const dub: Style = {
  id: 'dub',
  label: 'dub',
  bpm: [110, 125],
  scales: MINOR,
  roles: [
    { role: 'bass', p: 1, parts: [['bass-sub', 1]] },
    { role: 'line', p: 0.3, parts: [['stab', 1]] },
    { role: 'drums', p: 0.8, parts: [['drums-dub', 1]] },
  ],
  fx: [[dubEcho, 1]],
  twists: [
    ['feedback', 3],
    ['chance', 1],
    ['switch', 1],
    ['shaper', 1],
  ],
  twistCount: TWISTS,
};

const electro: Style = {
  id: 'electro',
  label: 'electro',
  bpm: [115, 130],
  scales: MINOR,
  roles: [
    { role: 'drums', p: 1, parts: [['kick-broken', 1]] },
    { role: 'drums', p: 0.9, parts: [['snare-broken', 1]] },
    { role: 'drums', p: 0.5, parts: [['hats-noise', 1]] },
    { role: 'drums', p: 0.6, parts: [['perc-tom', 1]] },
    { role: 'bass', p: 1, parts: [['bass-fm', 1]] },
    { role: 'texture', p: 0.5, parts: [['blips', 1]] },
  ],
  fx: [[digiEcho, 1]],
  twists: [
    ['shaper', 1],
    ['chance', 1],
    ['snh', 1],
  ],
  twistCount: TWISTS,
};

const idm: Style = {
  id: 'idm',
  label: 'IDM / glitch',
  bpm: [90, 170],
  scales: ALL_SCALES,
  roles: [
    {
      role: 'drums',
      p: 0.95,
      count: [2, 3],
      parts: [
        ['idm-bongo', 2],
        ['idm-tom', 1],
        ['idm-ping', 1],
        ['idm-hats', 1],
      ],
    },
    { role: 'texture', p: 0.85, parts: [['blips', 1]] },
    { role: 'line', p: 0.4, parts: [['pluck', 1]] },
  ],
  fx: [[glitchEcho, 1]],
  twists: [
    ['chance', 3],
    ['snh', 3],
    ['switch', 1],
    ['polymeter', 2],
    ['shaper', 1],
  ],
  twistCount: TWISTS,
};

const polymeter: Style = {
  id: 'polymeter',
  label: 'minimal polymeter',
  bpm: [118, 126],
  scales: ALL_SCALES,
  roles: [
    {
      role: 'drums',
      p: 1,
      count: [3, 4],
      parts: [
        ['poly-bongo', 2],
        ['poly-ping', 1],
        ['poly-tom', 1],
        ['poly-hats', 1],
      ],
    },
    { role: 'bass', p: 0.9, parts: [['bass-sub', 1]] },
  ],
  fx: [[reverbKind('room'), 1]],
  twists: [
    ['chance', 2],
    ['snh', 1],
    ['shaper', 1],
    ['feedback', 1],
    ['switch', 1],
  ],
  twistCount: TWISTS,
};

const berlin: Style = {
  id: 'berlin',
  label: 'Berlin school',
  bpm: [90, 120],
  scales: [1, 2, 3, 6],
  roles: [
    { role: 'line', p: 1, parts: [['arp', 1]] },
    { role: 'line', p: 0.8, parts: [['pad', 1]] },
    // a second voice over the arp: another arp, a pluck, bells or a stab
    {
      role: 'line',
      p: 0.45,
      parts: [
        ['arp', 1],
        ['pluck', 1],
        ['bells', 1],
        ['stab', 1],
      ],
    },
    {
      role: 'bass',
      p: 0.35,
      parts: [
        ['bass-sub', 1],
        ['bass-pulse', 1],
      ],
    },
  ],
  fx: [[berlinEcho, 1]],
  twists: [
    ['snh', 2],
    ['feedback', 2],
    ['fm', 1],
    ['switch', 1],
    ['grains', 1],
  ],
  twistCount: TWISTS,
};

const westcoast: Style = {
  id: 'westcoast',
  label: 'west coast',
  bpm: [70, 110],
  scales: ALL_SCALES,
  roles: [
    { role: 'line', p: 1, count: [1, 2], parts: [['westcoast', 1]] },
    { role: 'drums', p: 0.7, parts: [['perc-bongo', 1]] },
    { role: 'texture', p: 0.6, parts: [['blips', 1]] },
    { role: 'texture', p: 0.4, parts: [['chaos-bells', 1]] },
  ],
  fx: [[reverbKind('plate'), 1]],
  twists: [
    ['snh', 2],
    ['switch', 2],
    ['fm', 1],
    ['shaper', 1],
    ['feedback', 1],
    ['grains', 1],
  ],
  twistCount: TWISTS,
};

const industrial: Style = {
  id: 'industrial',
  label: 'industrial',
  bpm: [100, 140],
  scales: MINOR,
  roles: [
    { role: 'drums', p: 0.95, parts: [['drums-industrial', 1]] },
    { role: 'bass', p: 0.9, parts: [['bass-pulse', 1]] },
    { role: 'texture', p: 0.35, parts: [['wash', 1]] },
  ],
  fx: [[driveReverb, 1]],
  twists: [
    ['shaper', 3],
    ['feedback', 1],
    ['chance', 1],
  ],
  twistCount: TWISTS,
};

// a drone may already have GRAINS, so it has no `grains` twist; it has no gate or oscillator input for `fm`, `snh`
// or `switch` to use. Every twist in a pool must be able to apply to that style's parts (a test throws 500 of each).
const drone: Style = {
  id: 'drone',
  label: 'drone',
  bpm: [40, 70],
  scales: [5, 6],
  roles: [
    { role: 'texture', p: 1, count: [1, 2], parts: [['drone', 1]] },
    { role: 'texture', p: 0.4, parts: [['grains', 1]] },
    // the other textures, sparingly: a wash, chance-played blips or bells
    {
      role: 'texture',
      p: 0.45,
      parts: [
        ['wash', 2],
        ['blips', 1],
        ['chaos-bells', 1],
      ],
    },
    { role: 'line', p: 0.25, parts: [['pad', 1]] },
  ],
  fx: [[droneEcho, 1]],
  twists: [
    ['feedback', 2],
    ['shaper', 1],
  ],
  twistCount: TWISTS,
};

const bells: Style = {
  id: 'bells',
  label: 'ambient bells',
  bpm: [40, 80],
  scales: [5, 6],
  roles: [
    {
      role: 'line',
      p: 0.95,
      parts: [
        ['bells', 3],
        ['pad', 1],
        ['pluck', 1],
      ],
    },
    { role: 'texture', p: 0.35, parts: [['drone', 1]] },
    // chance-played bells or a wash under them
    {
      role: 'texture',
      p: 0.4,
      parts: [
        ['chaos-bells', 2],
        ['wash', 1],
      ],
    },
    { role: 'line', p: 0.3, parts: [['pad', 1]] },
  ],
  fx: [[delayReverb('wash'), 1]],
  twists: [
    ['fm', 1],
    ['feedback', 2],
    ['chance', 2],
    ['grains', 1],
    ['shaper', 1],
  ],
  twistCount: TWISTS,
};

export const STYLES: Record<DiceStyleId, Style> = {
  techno,
  acid,
  dub,
  electro,
  idm,
  polymeter,
  berlin,
  westcoast,
  industrial,
  drone,
  bells,
};
export const STYLE_IDS = Object.keys(STYLES) as DiceStyleId[];
