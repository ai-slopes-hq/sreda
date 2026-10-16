// The styles. Each says its tempo, scales, which roles play (and with which parts), its effect chains and twists.
import { delayReverb } from './fx';
import type { DiceStyleId, Style } from './types';

const techno: Style = {
  id: 'techno',
  label: 'techno',
  bpm: [90, 150],
  scales: [2, 3, 4, 5],
  roles: [
    { role: 'drums', p: 0.85, parts: [['drum-kit-legacy', 1]] },
    { role: 'bass', p: 1, parts: [['bass-legacy', 1]] },
    { role: 'line', p: 0.45, parts: [['lead-legacy', 1]] },
  ],
  fx: [[delayReverb('tight'), 1]],
  twists: [],
  twistCount: [0, 0],
};

const bells: Style = {
  id: 'bells',
  label: 'ambient bells',
  bpm: [40, 80],
  scales: [2, 3, 4, 5],
  roles: [
    { role: 'texture', p: 0.8, parts: [['drone-legacy', 1]] },
    { role: 'line', p: 0.8, parts: [['bells-legacy', 1]] },
  ],
  fx: [[delayReverb('wash'), 1]],
  twists: [],
  twistCount: [0, 0],
};

export const STYLES: Partial<Record<DiceStyleId, Style>> = { techno, bells };
export const STYLE_IDS = Object.keys(STYLES) as DiceStyleId[];
