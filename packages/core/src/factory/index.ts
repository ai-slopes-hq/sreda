// The factory (spec §6): read-only projects and groups shipped with the app, listed under FACTORY/.
import type { Doc } from '../doc';
import type { Specs } from '../spec';
import { build, buildWith } from './build';
import { GROUPS } from './groups';
import { PROJECTS } from './projects';

export interface FactoryEntry {
  kind: 'project' | 'group';
  name: string;
  build(specs: Specs): Doc;
  /** a group's main output (tests wire it into an OUT) */
  output?(specs: Specs): [string, string];
}

export const FACTORY: FactoryEntry[] = [
  ...PROJECTS.map((p) => ({
    kind: 'project' as const,
    name: p.name,
    build: (s: Specs) => build(s, p.build),
  })),
  ...GROUPS.map((g) => ({
    kind: 'group' as const,
    name: g.name,
    build: (s: Specs) => build(s, g.build),
    output: (s: Specs) => buildWith(s, g.build).value,
  })),
];
export { build } from './build';
export {
  dicePatch,
  DRUM_PARTS,
  PARTS,
  STYLE_IDS,
  type DiceCtx,
  type DiceStyleId,
  type DiceVoice,
} from './dice';
