import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

/** the class selectors a stylesheet defines as the whole selector of a top-level rule (`.sr-x {`, `.sr-x,`) */
function topLevelClasses(file: string): Set<string> {
  const css = readFileSync(resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set<string>();
  let depth = 0;
  for (const chunk of css.split(/([{}])/)) {
    if (chunk === '{') depth++;
    else if (chunk === '}') depth--;
    else if (depth === 0) {
      for (const sel of chunk.split(',')) {
        const m = /^\s*(\.[A-Za-z][\w-]*)\s*$/.exec(sel);
        if (m) out.add(m[1]!);
      }
    }
  }
  return out;
}

test('no class is a top-level rule in both canvas.css and seq.css', () => {
  const seq = topLevelClasses('seq/seq.css');
  const canvas = topLevelClasses('canvas/canvas.css');
  expect(seq.size).toBeGreaterThan(10);
  expect(canvas.size).toBeGreaterThan(50);
  expect([...seq].filter((c) => canvas.has(c))).toEqual([]);
});
