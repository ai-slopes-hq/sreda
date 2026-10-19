import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySkin, SKIN_NAMES, SKINS, TOKENS } from './skins';

const here = import.meta.dirname;
const ROOT_BLOCK = /^:root \{([^}]*)\}\n/;
const rootBlock = ROOT_BLOCK.exec(readFileSync(join(here, 'canvas/canvas.css'), 'utf8'))![1]!;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(css|ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('skins', () => {
  it('every skin defines every token', () => {
    for (const name of SKIN_NAMES) {
      for (const t of TOKENS) {
        const format = t === 'shadow' ? /^rgba\(\d+,\d+,\d+,\.\d+\)$/ : /^#[0-9a-f]{6}$/;
        expect(SKINS[name][t], `${name} ${t}`).toMatch(format);
      }
    }
  });

  it("DEFAULT's values are the :root values in canvas.css", () => {
    const root = new Map([...rootBlock.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
    expect(root.size).toBe(TOKENS.length);
    expect(TOKENS.length).toBe(31);
    // Prettier writes rgba(0, 0, 0, 0.55); skins.ts keeps it compact
    const norm = (v: string | undefined) => v?.replace(/\s+/g, '').replace(/(?<!\d)0\./g, '.');
    for (const t of TOKENS) expect(norm(root.get(t)), t).toBe(norm(SKINS.DEFAULT[t]));
  });

  it('applySkin sets the tokens on the root', () => {
    const set = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => set.set(k, v) } } as unknown as HTMLElement;
    applySkin('NORD', root);
    expect(set.get('--ground')).toBe('#2e3440');
    expect(set.size).toBe(TOKENS.length);
  });

  it('ORCA is grey but for destructive, and its roles step down in brightness', () => {
    const orca = SKINS.ORCA;
    const grey = (hex: string) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);
    for (const t of TOKENS) {
      if (t === 'shadow' || t === 'destructive') continue;
      expect(grey(orca[t]), t).toBe(true);
    }
    expect(grey(orca.destructive)).toBe(false);
    const level = (t: 'role-audio' | 'role-trigger' | 'role-pitch' | 'role-mod') => parseInt(orca[t].slice(1, 3), 16);
    expect(level('role-audio')).toBeGreaterThan(level('role-trigger'));
    expect(level('role-trigger')).toBeGreaterThan(level('role-pitch'));
    expect(level('role-pitch')).toBeGreaterThan(level('role-mod'));
  });

  it('no colour literal outside skins.ts and the :root block', () => {
    const literal = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(|hsla?\(|\b(?:black|white)\b(?!-space)/;
    const bad: string[] = [];
    for (const file of sources(here)) {
      if (file.endsWith('skins.ts') || /\.test\.tsx?$/.test(file)) continue;
      const source = readFileSync(file, 'utf8');
      const text = file.endsWith('canvas.css') ? source.replace(ROOT_BLOCK, '') : source;
      text.split('\n').forEach((line, i) => {
        if (literal.test(line)) bad.push(`${relative(here, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
