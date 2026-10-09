// @vitest-environment happy-dom
import { addModule, connect, emptyDoc, frameSelection } from '@sreda/core';
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { TEST_SPECS as S } from '../../../core/src/testspecs';
import { Cables } from './Cables';
import { cableGeoms } from './cablegeom';

function framed() {
  const d = patch();
  const inner = frameSelection(d, S, [d.modules[0]!.id, d.modules[1]!.id]);
  return frameSelection(inner.doc, S, [inner.id, d.modules[2]!.id]).doc;
}

function patch() {
  let doc = emptyDoc;
  const ids: string[] = [];
  for (const [type, x, y] of [
    ['src', 0, 0],
    ['fx', 400, 0],
    ['sink', 800, 100],
  ] as const) {
    const a = addModule(doc, S, type, x, y);
    doc = a.doc;
    ids.push(a.id);
  }
  doc = connect(doc, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[2]!, 'l']);
  return doc;
}

let normalWhole = false;
const draw = (whole: (i: number) => boolean, nested = false) => {
  const doc = nested ? framed() : patch();
  const geoms = cableGeoms(doc, S);
  const { container } = render(() => (
    <Cables
      doc={doc}
      specs={S}
      geoms={geoms}
      hover={null}
      whole={(c) => whole(doc.cables.indexOf(c))}
      wholeNormal={() => normalWhole}
      insert={null}
    />
  ));
  return container;
};

test('cables not whole draw two stubs each and no path', () => {
  const c = draw(() => false);
  expect(c.querySelectorAll('path.stub')).toHaveLength(4);
  expect(c.querySelectorAll('path.cable')).toHaveLength(0);
});

test('a whole cable draws its path', () => {
  const c = draw((i) => i === 1);
  expect(c.querySelectorAll('path.cable')).toHaveLength(1);
  expect(c.querySelectorAll('path.stub')).toHaveLength(4);
});

test('each stub is 14 px long along the path', () => {
  const c = draw(() => false);
  for (const p of c.querySelectorAll('path.stub')) {
    const pts = [...p.getAttribute('d')!.matchAll(/[ML]([-\d.e]+) ([-\d.e]+)/g)].map((m) => [+m[1]!, +m[2]!]);
    let len = 0;
    for (let k = 1; k < pts.length; k++)
      len += Math.hypot(pts[k]![0]! - pts[k - 1]![0]!, pts[k]![1]! - pts[k - 1]![1]!);
    expect(Math.abs(len - 14)).toBeLessThanOrEqual(1);
  }
});

test('a frame clock normal is a stub until it is whole', () => {
  normalWhole = false;
  const c = draw(() => false, true);
  expect(c.querySelectorAll('path.ghost-normal')).toHaveLength(2);
  normalWhole = true;
  const w = draw(() => false, true);
  expect(w.querySelectorAll('path.ghost-normal')).toHaveLength(3);
  normalWhole = false;
});
