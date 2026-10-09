// @vitest-environment happy-dom
import { FACTORY, SPECS, starterDoc } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import type { LibraryApi, SredaBridge } from '../library';
import type { LibEntry } from '../canvas/patching';
import { createSession } from '../store';
import { Library } from './Library';

const entries: LibEntry[] = [
  { kind: 'project', path: 'jams/zed', factory: false },
  ...FACTORY.map((e) => ({ kind: e.kind, path: `FACTORY/${e.name}`, factory: true })),
  { kind: 'group', path: 'kit/drums', factory: false },
];

function setup() {
  const session = createSession(SPECS, starterDoc(SPECS));
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
    library: { samples: () => Promise.resolve(['kit/kick.wav', 'kit/snare.wav', 'hat.wav']) },
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
      (x) => x.textContent,
    );
  return { ...r, session, openProject, placeGroup, audition, lib, fit, rows };
}

test('the sections list factory entries first, filtered by their own field', async () => {
  const { rows, container } = setup();
  await vi.waitFor(() => expect(rows('SAMPLES')).toHaveLength(3));
  expect(rows('PROJECTS')[0]).toMatch(/^FACTORY · /);
  expect(rows('PROJECTS').at(-1)).toBe('jams · zed');
  expect(rows('GROUPS').at(-1)).toBe('kit · drums');
  expect(rows('GROUPS').some((t) => t?.startsWith('FACTORY · '))).toBe(true);
  const f = container.querySelector<HTMLInputElement>('[data-section=SAMPLES] input')!;
  fireEvent.input(f, { target: { value: 'snare' } });
  expect(rows('SAMPLES')).toEqual(['kit · snare.wav']);
  expect(rows('PROJECTS').at(-1)).toBe('jams · zed');
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
