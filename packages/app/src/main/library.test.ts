import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  fileFor,
  importSample,
  listLibrary,
  listSamples,
  openedFiles,
  readEntry,
  readSample,
  writeEntry,
} from './library';

const tmp = () => mkdtempSync(join(tmpdir(), 'sreda-lib-'));

test('a path is /-separated segments: never empty, . or .., no backslash or NUL, at most 100 characters', () => {
  const root = tmp();
  for (const bad of ['../x', '/x', 'a//b', 'a\\b', 'x'.repeat(101), '', 'a/./b', 'a/', 'a\0b'])
    expect(() => fileFor(root, 'group', bad), bad).toThrow();
  expect(fileFor(root, 'group', 'acid/303 voice')).toBe(
    join(root, 'groups', 'acid', '303 voice.sreda-group.json'),
  );
  expect(fileFor(root, 'project', 'jam')).toBe(join(root, 'projects', 'jam.sreda.json'));
  expect(fileFor(root, 'project', 'x'.repeat(100))).toContain('projects');
});

test('the library lists nested groups and projects and ignores other files; a missing folder lists nothing', async () => {
  const root = tmp();
  mkdirSync(join(root, 'groups', 'kit'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  writeFileSync(join(root, 'groups', 'kit', 'drums.sreda-group.json'), '{}');
  writeFileSync(join(root, 'groups', 'notes.txt'), 'hi');
  writeFileSync(join(root, 'projects', 'jam.sreda.json'), '{}');
  writeFileSync(join(root, 'projects', 'jam.sreda-group.json'), '{}');
  expect(await listLibrary(root)).toEqual([
    { kind: 'group', path: 'kit/drums' },
    { kind: 'project', path: 'jam' },
  ]);
  rmSync(root, { recursive: true });
  expect(await listLibrary(root)).toEqual([]);
});

test('writing makes the folders and replaces an existing file; reading bad JSON throws', async () => {
  const root = tmp();
  await writeEntry(root, 'group', 'kit/drums', { a: 1 });
  await writeEntry(root, 'group', 'kit/drums', { a: 2 });
  const file = join(root, 'groups', 'kit', 'drums.sreda-group.json');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2 });
  expect(await readEntry(root, 'group', 'kit/drums')).toEqual({ a: 2 });
  writeFileSync(file, '{ nope');
  await expect(readEntry(root, 'group', 'kit/drums')).rejects.toThrow();
  await expect(writeEntry(root, 'project', '../escape', {})).rejects.toThrow();
});

test('samples: listed under samples/ with their extension, others ignored; read only inside samples/', async () => {
  const root = tmp();
  mkdirSync(join(root, 'samples', 'kit'), { recursive: true });
  for (const f of ['kit/kick.wav', 'kit/snare.AIFF', 'pad.flac', 'a.mp3', 'b.ogg', 'c.aif', 'notes.txt'])
    writeFileSync(join(root, 'samples', f), 'x');
  expect(await listSamples(root)).toEqual([
    'a.mp3',
    'b.ogg',
    'c.aif',
    'kit/kick.wav',
    'kit/snare.AIFF',
    'pad.flac',
  ]);
  expect(Buffer.from(await readSample(root, 'kit/kick.wav')).toString()).toBe('x');
  await expect(readSample(root, '../projects/x.wav')).rejects.toThrow();
  await expect(readSample(root, 'notes.txt')).rejects.toThrow();
  rmSync(join(root, 'samples'), { recursive: true });
  expect(await listSamples(root)).toEqual([]);
});

test('importing a file copies it into samples/ under a free name', async () => {
  const root = tmp();
  const boom = new TextEncoder().encode('boom');
  expect(await importSample(root, 'kick.wav', boom)).toBe('kick.wav');
  expect(await importSample(root, 'kick.wav', boom)).toBe('kick 2.wav');
  expect(readFileSync(join(root, 'samples', 'kick 2.wav'), 'utf8')).toBe('boom');
  // only the file's name counts: no folders, no way out of samples/
  expect(await importSample(root, '../../evil.wav', boom)).toBe('evil.wav');
  await expect(importSample(root, 'readme.txt', boom)).rejects.toThrow();
});

test('sample names the library cannot read back are not listed; an imported long name is shortened', async () => {
  const root = tmp();
  mkdirSync(join(root, 'samples'), { recursive: true });
  writeFileSync(join(root, 'samples', 'x'.repeat(120) + '.wav'), 'x');
  writeFileSync(join(root, 'samples', 'ok.wav'), 'x');
  expect(await listSamples(root)).toEqual(['ok.wav']);
  const name = await importSample(root, 'y'.repeat(150) + '.wav', new Uint8Array([1]));
  expect(name.length).toBeLessThanOrEqual(90);
  expect(Buffer.from(await readSample(root, name))[0]).toBe(1);
});

test('project.save writes only to a path that project.open returned in this run, atomically', async () => {
  const dir = tmp();
  const file = join(dir, 'x.sreda.json');
  const other = join(dir, 'other.sreda.json');
  writeFileSync(file, '{"a":1}');
  writeFileSync(other, '{"a":1}');
  const files = openedFiles();
  await expect(files.save(file, { a: 2 })).rejects.toThrow();
  expect(await files.open(file)).toEqual({ path: file, doc: { a: 1 } });
  await expect(files.save(other, { a: 2 })).rejects.toThrow();
  await expect(files.save(42, { a: 2 })).rejects.toThrow();
  expect(JSON.parse(readFileSync(other, 'utf8'))).toEqual({ a: 1 });
  await files.save(file, { a: 2 });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2 });
  expect(await files.open(join(dir, 'missing.json'))).toEqual({
    path: join(dir, 'missing.json'),
    error: true,
  });
  writeFileSync(other, 'not json');
  expect(await files.open(other)).toEqual({ path: other, error: true });
  await expect(files.save(other, { a: 3 })).rejects.toThrow();
});

test('a later run seeded with the remembered paths may save to them; a path never opened still refuses', async () => {
  const dir = tmp();
  const file = join(dir, 'x.sreda.json');
  writeFileSync(file, '{"a":1}');
  let remembered: string[] = [];
  await openedFiles([], async (r) => void (remembered = r)).open(file);
  expect(remembered).toEqual([file]);
  const next = openedFiles(remembered);
  await next.save(file, { a: 2 });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2 });
  await expect(next.save(join(dir, 'never.json'), {})).rejects.toThrow();
  // at most 20, most recent first
  const many = openedFiles([], async (r) => void (remembered = r));
  for (let i = 0; i < 25; i++) {
    const f = join(dir, `f${i}.json`);
    writeFileSync(f, '{}');
    await many.open(f);
  }
  expect(remembered).toHaveLength(20);
  expect(remembered[0]).toBe(join(dir, 'f24.json'));
});
