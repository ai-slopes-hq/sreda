// @vitest-environment happy-dom
import { addModule, connect, emptyDoc, SPECS, starterDoc, type Doc } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { createSession } from '../store';
import { Wires } from './Wires';

/** the starter (OSC › OUT) grown to four modules and four wires */
function four(): Doc {
  let doc = starterDoc(SPECS);
  const [osc, out] = doc.modules.map((m) => m.id) as [string, string];
  const slope = addModule(doc, SPECS, 'slope', 0, 300);
  const filter = addModule(slope.doc, SPECS, 'filter', 300, 300);
  doc = connect(filter.doc, SPECS, [slope.id, 'out'], [osc, 'pitch']);
  doc = connect(doc, SPECS, [osc, 'out'], [filter.id, 'in']);
  return connect(doc, SPECS, [filter.id, 'lp'], [out, 'l']);
}

function setup(doc: Doc = four()) {
  const session = createSession(SPECS, doc);
  const r = render(() => <Wires session={session} specs={SPECS} focus={() => {}} />);
  const text = (sel: string) => r.container.querySelector(sel)?.textContent;
  return { ...r, session, text };
}

test('the footer counts the wires and modules; a patch without problems has none', () => {
  const { container, text } = setup();
  expect(text('.sr-sfoot')).toBe('4 wires · 4 modules');
  expect(container.querySelectorAll('.sr-ok')).toHaveLength(1);
  expect(text('.sr-ok')).toBe('No problems');
  expect(container.querySelector('[data-section=problems]')).toBeNull();
  expect(text('.sr-chip')).toBe('All 4');
});

test('a normal is two lines: the normal, then what it does', () => {
  const { container } = setup();
  const nr = [...container.querySelectorAll('[data-section=normals] .sr-nrow')].find((n) =>
    n.textContent?.startsWith('OUT › R ← L'),
  )!;
  expect(nr.querySelector('.nd')?.textContent).toBe('until something is patched into R');
  expect(nr.textContent).toBe('OUT › R ← Luntil something is patched into R');
});

test('a section with nothing to list is not rendered', () => {
  const { container, session } = setup();
  // there are no frames and nothing between them
  expect([...container.querySelectorAll('.sr-wsec')].map((x) => x.getAttribute('data-section'))).toEqual([
    'ungrouped',
    'normals',
  ]);
  session.setState('sidebar', 'q', 'zzz');
  expect(container.querySelectorAll('.sr-wsec')).toHaveLength(0);
  // a filter that hides the problems does not claim there are none
  expect(container.querySelector('.sr-ok')).toBeNull();
});

test('problems are listed in their section instead of the No problems line', () => {
  const { container } = setup(addModule(emptyDoc, SPECS, 'filter', 0, 0).doc);
  expect(container.querySelector('.sr-ok')).toBeNull();
  expect(container.querySelector('[data-section=problems]')?.textContent).toContain('FILTER › IN');
});

test('the Selection chip keeps the wires touching the selection', () => {
  const { container, session } = setup();
  const rows = () => container.querySelectorAll('.sr-wrow[data-wire]').length;
  expect(rows()).toBe(4);
  session.setState('sel', [session.state.doc.modules[0]!.id]);
  fireEvent.click([...container.querySelectorAll('.sr-chip')].find((c) => c.textContent === 'Selection')!);
  expect(session.state.sidebar.selOnly).toBe(true);
  expect(rows()).toBeLessThan(4);
  fireEvent.click(container.querySelector('.sr-chip')!);
  expect(rows()).toBe(4);
});

test('a wire end is a shrinking module name and a rigid port name', () => {
  const { container } = setup();
  const port = container.querySelector('.sr-wrow .port')!;
  expect(port.querySelector('.m')!.textContent).not.toBe('');
  expect(port.querySelector('.pn')!.textContent).not.toBe('');
  const css = readFileSync(resolve(__dirname, '../canvas/canvas.css'), 'utf8');
  const m = /\n\.sr-wrow \.m \{([^}]*)\}/.exec(css)![1]!;
  for (const d of ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']) expect(m).toContain(d);
  expect(/\n\.sr-wrow \.pn \{([^}]*)\}/.exec(css)![1]).toContain('flex: none');
});
