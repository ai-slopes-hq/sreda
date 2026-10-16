// @vitest-environment happy-dom
import { addModule, FACTORY, frameSelection, setParam, SPECS, starterDoc } from '@sreda/core';
import { expect, test } from 'vitest';
import { libraryActions, validPath, type SredaBridge } from './library';
import { createSession } from './store';
import { dicePatch } from '@sreda/core';

function fakeBridge(folder: string | null = '/lib') {
  const files = new Map<string, unknown>();
  const key = (kind: string, path: string) => `${kind}:${path}`;
  const calls: string[] = [];
  const disk = {
    opened: null as { path: string; doc?: unknown; error?: true } | null,
    saved: [] as { path: string; doc: unknown }[],
    imported: [] as string[],
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
      importFromDialog: async () => disk.imported,
      pickOne: async () => null,
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
  expect(s.state.notice).toBe('broken could not be opened');
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

test('DICE replaces the canvas with a random playable patch as an undo step; the project is unnamed', () => {
  const s = createSession(SPECS, starterDoc(SPECS), null, { path: 'jam', factory: false });
  const { bridge } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  lib.dice(7);
  expect(s.state.doc).toEqual(dicePatch(SPECS, 7).doc);
  expect(s.state.project).toBeNull();
  expect(s.state.notice).toBe(`Dice: ${dicePatch(SPECS, 7).label}`);
  s.undo();
  expect(s.state.doc.modules.map((m) => m.type)).toEqual(['osc', 'out']);
  // without a seed every throw differs
  lib.dice();
  const a = JSON.stringify(s.state.doc);
  lib.dice();
  expect(JSON.stringify(s.state.doc)).not.toBe(a);
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
  expect(s.state.notice).toBe('notes.sreda.json could not be opened');
  expect(s.current()).toBe(before);
  expect(s.state.project).toBeNull();
  s.undo();
  expect(s.current()).toBe(before);
});

test('an old STAGES opens as META-SEQ, from ⌘O or the library, and the notice says what changed', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, disk, files } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  const old = {
    version: 1,
    modules: [{ id: 'm1', type: 'stages', x: 400, y: 0, parent: null, params: {}, atts: {}, ratios: {} }],
    cables: [],
    groups: [],
    master: 1,
    nextId: 2,
  };
  disk.opened = { path: '/x/old.sreda.json', doc: old };
  expect(await lib.open()).toBe(true);
  expect(s.current().modules.map((m) => m.type)).toEqual(['metaseq', 'slope']);
  expect(s.state.notice).toBe('STAGES › free-running timing now follows a clock');
  s.setState('notice', null);
  files.set('project:old', old);
  expect((await lib.read({ kind: 'project', path: 'old', factory: false }))!.modules[0]!.type).toBe('metaseq');
  expect(s.state.notice).toBe('STAGES › free-running timing now follows a clock');
});

test('⌘O on an unreadable file names it in the notice', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, disk } = fakeBridge();
  disk.opened = { path: '/x/broken.sreda.json', error: true };
  expect(await libraryActions(s, SPECS, bridge).open()).toBe(false);
  expect(s.state.notice).toBe('broken.sreda.json could not be opened');
});

test('Import Samples: a selected SAMPLER gets the first file (one undo step); nothing selected opens LIBRARY', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, disk } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  const added = addModule(s.current(), SPECS, 'sampler', 100, 100);
  s.commit(added.doc);
  disk.imported = ['kick.wav', 'kick 2.wav'];
  s.setState('sel', [added.id]);
  const undo = s.current();
  await lib.importSamples();
  expect(s.current().modules.find((m) => m.id === added.id)?.sample).toBe('kick.wav');
  expect(s.state.sidebar.tab).not.toBe('LIBRARY');
  s.undo();
  expect(s.current()).toEqual(undo);

  s.setState('sel', []);
  await lib.importSamples();
  expect(s.state.sidebar).toMatchObject({
    open: true,
    tab: 'LIBRARY',
    highlight: ['kick.wav', 'kick 2.wav'],
  });
  expect(s.current().modules.find((m) => m.id === added.id)?.sample).toBeUndefined();
});

test('⌘S on an opened file main no longer remembers says to open it again; any other failure says it could not be saved', async () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { bridge, disk } = fakeBridge();
  const lib = libraryActions(s, SPECS, bridge);
  disk.opened = { path: '/x/jam.sreda.json', doc: structuredClone(starterDoc(SPECS)) };
  expect(await lib.open()).toBe(true);
  bridge.project.save = async () => {
    throw new Error("Error invoking remote method 'project:save': Error: not an opened project file");
  };
  await lib.save();
  expect(s.state.notice).toBe('jam.sreda.json — open it again (⌘O) to save');
  bridge.project.save = async () => {
    throw new Error('EACCES');
  };
  await lib.save();
  expect(s.state.notice).toBe('jam.sreda.json could not be saved');
});
