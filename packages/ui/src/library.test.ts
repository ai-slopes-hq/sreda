// @vitest-environment happy-dom
import { FACTORY, frameSelection, setParam, SPECS, starterDoc } from '@sreda/core';
import { expect, test } from 'vitest';
import { libraryActions, validPath, type SredaBridge } from './library';
import { createSession } from './store';

function fakeBridge(folder: string | null = '/lib') {
  const files = new Map<string, unknown>();
  const key = (kind: string, path: string) => `${kind}:${path}`;
  const calls: string[] = [];
  const disk = {
    opened: null as { path: string; doc: unknown } | null,
    saved: [] as { path: string; doc: unknown }[],
  };
  let chosen = folder;
  const bridge: SredaBridge = {
    first: async () => null,
    settings: { skin: async () => null, setSkin: async () => {} },
    project: {
      open: async () => disk.opened,
      save: async (path, doc) => {
        calls.push(`file ${path}`);
        disk.saved.push({ path, doc: structuredClone(doc) });
      },
    },
    library: {
      folder: async () => chosen,
      choose: async () => {
        calls.push('choose');
        chosen = '/picked';
        return chosen;
      },
      list: async () =>
        [...files.keys()].map((k) => ({
          kind: k.split(':')[0] as 'group' | 'project',
          path: k.split(':')[1]!,
        })),
      read: async (kind, path) => {
        const v = files.get(key(kind, path));
        if (v === 'BAD') throw new SyntaxError('bad JSON');
        return structuredClone(v);
      },
      exists: async (kind, path) => files.has(key(kind, path)),
      write: async (kind, path, doc) => {
        calls.push(`write ${kind} ${path}`);
        files.set(key(kind, path), structuredClone(doc));
      },
      samples: async () => [],
      readSample: async () => {
        throw new Error('no samples');
      },
      importSample: async (name) => name,
    },
  };
  return { bridge, files, calls, disk };
}

test('names follow the library path rule', () => {
  expect(['jam', 'acid/303 voice', 'x'.repeat(100)].every(validPath)).toBe(true);
  expect(['', '../x', '/x', 'a//b', 'a\\b', 'x'.repeat(101), 'a/./b'].some(validPath)).toBe(false);
});

test('saving an unnamed project asks for a name; then ⌘S saves straight away; the dirty mark follows', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, calls } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  expect(s.state.dirty).toBe(false);
  s.commit(setParam(s.current(), SPECS, 'm1', 'freq', 0.2));
  expect(s.state.dirty).toBe(true);
  await lib.save();
  expect(s.state.saving).toMatchObject({ kind: 'project', name: '' });
  await lib.submit('sets/jam');
  expect(calls).toEqual(['write project sets/jam']);
  expect(s.state.saving).toBeNull();
  expect(s.state.project).toEqual({ path: 'sets/jam', factory: false });
  expect(s.state.dirty).toBe(false);
  s.commit(setParam(s.current(), SPECS, 'm1', 'freq', 0.3));
  await lib.save();
  expect(s.state.saving).toBeNull();
  expect(calls).toEqual(['write project sets/jam', 'write project sets/jam']);
  expect(s.state.dirty).toBe(false);
});

test('a factory project asks for a new name; an existing name asks to replace; an invalid one stays', async () => {
  const pulse = FACTORY.find((e) => e.name === 'pulse')!.build(SPECS);
  const s = createSession(SPECS, pulse, null, { path: 'FACTORY/pulse', factory: true });
  const { bridge, calls, files } = fakeBridge();
  files.set('project:jam', {});
  const lib = libraryActions(s, SPECS, bridge);
  await lib.save();
  expect(s.state.saving).toMatchObject({ kind: 'project' });
  await lib.submit('../x');
  expect(s.state.saving).toMatchObject({ invalid: true });
  await lib.submit('jam');
  expect(s.state.saving).toMatchObject({ confirm: 'jam' });
  expect(calls).toEqual([]);
  await lib.submit('jam');
  expect(calls).toEqual(['write project jam']);
});

test('a frame saves as a group: the frame, its contents, the cables among them', async () => {
  const framed = frameSelection(starterDoc(SPECS), SPECS, ['m1']);
  const s = createSession(SPECS, framed.doc);
  const { bridge, files } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  s.setState('sel', [framed.id]);
  await lib.save();
  expect(s.state.saving).toMatchObject({ kind: 'group', gid: framed.id, name: 'group 1' });
  await lib.submit('kit/drums');
  const saved = files.get('group:kit/drums') as { modules: { id: string }[]; cables: unknown[] };
  expect(saved.modules.map((m) => m.id)).toEqual(['m1']);
  expect(saved.cables).toEqual([]);
  expect(s.state.library).toContainEqual({ kind: 'group', path: 'kit/drums', factory: false });
});

test('with no folder yet, the first save asks for one; a library entry that will not open leaves the patch alone', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, calls, files } = fakeBridge(null);
  const lib = libraryActions(s, SPECS, bridge);
  await lib.save();
  await lib.submit('jam');
  expect(calls).toEqual(['choose', 'write project jam']);
  files.set('project:broken', 'BAD');
  files.set('project:foreign', { hello: 'world' });
  const before = s.current();
  expect(await lib.read({ kind: 'project', path: 'broken', factory: false })).toBeNull();
  expect(s.state.notice).toBe('BROKEN COULD NOT BE OPENED');
  expect(await lib.read({ kind: 'project', path: 'foreign', factory: false })).toBeNull();
  expect(s.current()).toBe(before);
});

test('NEW clears the canvas as an undo step and makes the project unnamed', () => {
  const s = createSession(SPECS, starterDoc(SPECS), null, { path: 'jam', factory: false });
  const { bridge } = fakeBridge();
  libraryActions(s, SPECS, bridge).clear();
  expect(s.current().modules).toEqual([]);
  expect(s.state.project).toBeNull();
  s.undo();
  expect(s.current().modules).toHaveLength(2);
});

test('⌘O opens a project file: a document replaces the canvas; ⌘S writes back to that file, save as goes to the library', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, calls, disk, files } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  expect(await lib.open()).toBe(false); // a cancelled dialog
  const pulse = FACTORY.find((e) => e.name === 'pulse')!.build(SPECS);
  disk.opened = { path: '/x/y/jam.sreda.json', doc: structuredClone(pulse) };
  expect(await lib.open()).toBe(true);
  expect(s.state.project).toEqual({ path: '/x/y/jam.sreda.json', factory: false, file: true });
  expect(s.state.dirty).toBe(false);
  s.commit(setParam(s.current(), SPECS, pulse.modules[0]!.id, 'freq', 0.2));
  expect(s.state.dirty).toBe(true);
  await lib.save();
  expect(s.state.saving).toBeNull();
  expect(calls).toEqual(['file /x/y/jam.sreda.json']);
  expect(disk.saved[0]!.doc).toEqual(s.current());
  expect(s.state.dirty).toBe(false);
  lib.saveAs();
  expect(s.state.saving).toMatchObject({ kind: 'project', name: '' });
  await lib.submit('sets/copy');
  expect(calls).toEqual(['file /x/y/jam.sreda.json', 'write project sets/copy']);
  expect(files.has('project:sets/copy')).toBe(true);
  expect(s.state.project).toEqual({ path: 'sets/copy', factory: false });
});

test('⌘O on something that is not a SREDA document leaves the session alone and says so', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, disk } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  const before = s.current();
  disk.opened = { path: '/x/notes.sreda.json', doc: { hello: 'world' } };
  expect(await lib.open()).toBe(false);
  expect(s.state.notice).toBe('NOTES.SREDA.JSON COULD NOT BE OPENED');
  expect(s.current()).toBe(before);
  expect(s.state.project).toBeNull();
  s.undo();
  expect(s.current()).toBe(before);
});
