import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fileFor, listLibrary, readEntry, writeEntry } from './library';

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
