// @vitest-environment happy-dom
import { FACTORY, SPECS, starterDoc } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import type { LibraryApi, SredaBridge } from '../library';
import type { LibEntry } from '../canvas/patching';
import { createSession, type Session } from '../store';
import { Library } from './Library';

const entries: LibEntry[] = [
  { kind: 'project', path: 'jams/zed', factory: false },
  ...FACTORY.map((e) => ({ kind: e.kind, path: `FACTORY/${e.name}`, factory: true })),
  { kind: 'group', path: 'kit/drums', factory: false },
];

function setup(project: Session['project'] = null, files = ['kit/kick.wav', 'kit/snare.wav', 'hat.wav']) {
  const session = createSession(SPECS, starterDoc(SPECS), null, project);
  const openProject = vi.spyOn(session, 'openProject');
  const placeGroup = vi.spyOn(session, 'placeGroup');
  const audition = vi.spyOn(session.samples, 'audition').mockResolvedValue();
  const lib = {
    read: vi.fn((e: LibEntry) =>
      Promise.resolve(FACTORY.find((f) => `FACTORY/${f.name}` === e.path)?.build(SPECS) ?? null),
    ),
    refresh: vi.fn(() => Promise.resolve()),
    saveAs: vi.fn(),
    clear: vi.fn(),
    importSamples: vi.fn(),
  } as unknown as LibraryApi;
  const bridge = {
    library: { samples: () => Promise.resolve(files) },
  } as unknown as SredaBridge;
  const fit = vi.fn();
  const r = render(() => (
    <Library
      session={session}
      lib={lib}
      entries={entries}
      bridge={bridge}
      fit={fit}
      middle={() => ({ x: 500, y: 300 })}
    />
  ));
  const rows = (sec: string) =>
    [...r.container.querySelectorAll<HTMLElement>(`[data-section=${sec}] .sr-lrow`)].map(
      (x) => (x.querySelector('.folder')?.textContent ?? '') + x.querySelector('.name')!.textContent,
    );
  return { ...r, session, openProject, placeGroup, audition, lib, fit, rows };
}

test('the sections list factory entries first, the library’s own after', async () => {
  const { rows, container } = setup();
  await vi.waitFor(() => expect(rows('SAMPLES')).toHaveLength(3));
  expect(rows('PROJECTS')[0]).toMatch(/^FACTORY · /);
  // a long section shows its first eight rows: the library's own come last
  for (const b of container.querySelectorAll('.sr-more')) fireEvent.click(b);
  expect(rows('PROJECTS').at(-1)).toBe('jams · zed');
  expect(rows('GROUPS').at(-1)).toBe('kit · drums');
  expect(rows('GROUPS').some((t) => t?.startsWith('FACTORY · '))).toBe(true);
});

test('one filter narrows all three sections', async () => {
  const { rows, container } = setup();
  await vi.waitFor(() => expect(rows('SAMPLES')).toHaveLength(3));
  expect(container.querySelectorAll('input')).toHaveLength(1);
  const f = container.querySelector<HTMLInputElement>('input')!;
  expect(f.placeholder).toBe('Filter projects, groups, samples');
  fireEvent.input(f, { target: { value: 'k' } });
  expect(rows('SAMPLES')).toEqual(['kit · kick.wav', 'kit · snare.wav'].filter((t) => /k/i.test(t)));
  expect(rows('PROJECTS').every((t) => /k/i.test(t))).toBe(true);
  expect(rows('GROUPS').every((t) => /k/i.test(t))).toBe(true);
  expect(rows('GROUPS')).toContain('kit · drums');
  fireEvent.input(f, { target: { value: 'kit/snare' } });
  expect(rows('SAMPLES')).toEqual(['kit · snare.wav']);
  expect(rows('PROJECTS')).toEqual([]);
  expect(rows('GROUPS')).toEqual([]);
});

test('the open project is marked open; no Save as or New here', async () => {
  const { container, rows } = setup({ path: 'FACTORY/acid', factory: true });
  await vi.waitFor(() => expect(rows('SAMPLES')).toHaveLength(3));
  const row = container.querySelector('[data-section=PROJECTS] [data-path="FACTORY/acid"]')!;
  expect(row.querySelector('.open')?.textContent).toBe('open');
  expect(container.querySelectorAll('.open')).toHaveLength(1);
  const labels = [...container.querySelectorAll('button')].map((b) => b.textContent!.trim().toLowerCase());
  expect(labels.some((t) => t.includes('save as') || t === 'new')).toBe(false);
});

test('a group row offers a drag to the canvas', async () => {
  const { container } = setup();
  const row = container.querySelector('[data-section=GROUPS] .sr-lrow')!;
  expect(row.querySelector('.drag')?.textContent).toContain('drag to canvas');
  expect(row.querySelector('.drag svg')).not.toBeNull();
});

test('a long section shows eight rows and Show all N; a click shows them all', async () => {
  const many = Array.from({ length: 17 }, (_, i) => `s${String(i).padStart(2, '0')}.wav`);
  const { container, rows } = setup(null, many);
  await vi.waitFor(() => expect(rows('SAMPLES')).toHaveLength(8));
  const more = [...container.querySelectorAll<HTMLButtonElement>('[data-section=SAMPLES] .sr-more')];
  expect(more.map((b) => b.textContent)).toEqual(['Show all 17']);
  fireEvent.click(more[0]!);
  expect(rows('SAMPLES')).toHaveLength(17);
  expect(container.querySelector('[data-section=SAMPLES] .sr-more')).toBeNull();
});

test('an empty SAMPLES says how to add some', async () => {
  const { container, rows } = setup(null, []);
  await vi.waitFor(() =>
    expect(container.querySelector('[data-section=SAMPLES] .sr-empty')?.textContent).toBe(
      'No samples yet. Import audio files or drop them here; hover a sample to hear it.',
    ),
  );
  expect(rows('SAMPLES')).toEqual([]);
});

test('a PROJECTS click opens the project and fits the view', async () => {
  const { container, openProject, fit } = setup();
  fireEvent.click(container.querySelector('[data-section=PROJECTS] [data-path="FACTORY/acid"]')!);
  await vi.waitFor(() => expect(openProject).toHaveBeenCalled());
  expect(openProject.mock.calls[0]![1]).toEqual({ path: 'FACTORY/acid', factory: true });
  expect(fit).toHaveBeenCalled();
});

test('a GROUPS click places the group at the middle of the view', async () => {
  const { container, placeGroup } = setup();
  const g = FACTORY.find((e) => e.kind === 'group')!;
  fireEvent.click(container.querySelector(`[data-section=GROUPS] [data-path="FACTORY/${g.name}"]`)!);
  await vi.waitFor(() => expect(placeGroup).toHaveBeenCalled());
  expect(placeGroup.mock.calls[0]![1]).toEqual({ x: 500, y: 300 });
});

test('hovering a SAMPLES row auditions it after 120 ms; leaving stops it', async () => {
  const { container, audition, rows } = setup();
  await vi.waitFor(() => expect(rows('SAMPLES')).toHaveLength(3));
  const row = container.querySelector('[data-section=SAMPLES] [data-path="kit/kick.wav"]')!;
  vi.useFakeTimers();
  fireEvent.mouseEnter(row);
  vi.advanceTimersByTime(100);
  expect(audition).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30);
  expect(audition).toHaveBeenCalledWith('kit/kick.wav');
  fireEvent.mouseLeave(row);
  expect(audition).toHaveBeenLastCalledWith(null);
  vi.useRealTimers();
});

test('imported samples are shown first; a section collapses', async () => {
  const session = createSession(SPECS, starterDoc(SPECS));
  session.setState('sidebar', 'highlight', ['hat.wav']);
  const bridge = {
    library: { samples: () => Promise.resolve(['kit/kick.wav', 'hat.wav']) },
  } as unknown as SredaBridge;
  const { container } = render(() => (
    <Library
      session={session}
      lib={{ refresh: () => Promise.resolve() } as unknown as LibraryApi}
      entries={[]}
      bridge={bridge}
      fit={() => {}}
      middle={() => ({ x: 0, y: 0 })}
    />
  ));
  await vi.waitFor(() =>
    expect(container.querySelectorAll('[data-section=SAMPLES] .sr-lrow')).toHaveLength(2),
  );
  const first = container.querySelector('[data-section=SAMPLES] .sr-lrow')!;
  expect(first.getAttribute('data-path')).toBe('hat.wav');
  expect(first.classList.contains('new')).toBe(true);
  fireEvent.click(container.querySelector('[data-section=SAMPLES] .sr-lhead')!);
  expect(container.querySelectorAll('[data-section=SAMPLES] .sr-lrow')).toHaveLength(0);
});

test('a highlight that changes while mounted re-lists the samples and marks the new ones', async () => {
  const session = createSession(SPECS, starterDoc(SPECS));
  let list = ['kit/kick.wav'];
  const samples = vi.fn(() => Promise.resolve([...list]));
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  const { container } = render(() => (
    <Library
      session={session}
      lib={{ refresh: () => Promise.resolve() } as unknown as LibraryApi}
      entries={[]}
      bridge={{ library: { samples } } as unknown as SredaBridge}
      fit={() => {}}
      middle={() => ({ x: 0, y: 0 })}
    />
  ));
  const rows = () => [...container.querySelectorAll('[data-section=SAMPLES] .sr-lrow')];
  await vi.waitFor(() => expect(rows()).toHaveLength(1));
  list = ['kit/kick.wav', 'new.wav'];
  session.setState('sidebar', 'highlight', ['new.wav']);
  await vi.waitFor(() => expect(rows()).toHaveLength(2));
  expect(samples).toHaveBeenCalledTimes(2);
  expect(rows()[0]!.getAttribute('data-path')).toBe('new.wav');
  expect(rows()[0]!.classList.contains('new')).toBe(true);
  await vi.waitFor(() => expect(scrolled).toHaveBeenCalled());
});
