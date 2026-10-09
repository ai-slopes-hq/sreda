import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { mergeSettings, readSkin, writeSkin } from './settings';

const file = () => join(mkdtempSync(join(tmpdir(), 'sreda-set-')), 'settings.json');

test('setting the skin keeps the library; a library write keeps the skin', async () => {
  const f = file();
  await mergeSettings(f, { library: '/music' });
  await writeSkin(f, 'NORD');
  expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ library: '/music', skin: 'NORD' });
  await mergeSettings(f, { library: '/other' });
  expect(await readSkin(f)).toBe('NORD');
});

test('a missing or corrupt file, or an unknown skin, reads as null', async () => {
  const f = file();
  expect(await readSkin(f)).toBeNull();
  writeFileSync(f, '{nope');
  expect(await readSkin(f)).toBeNull();
  writeFileSync(f, JSON.stringify({ skin: 'PURPLE' }));
  expect(await readSkin(f)).toBeNull();
  await expect(writeSkin(f, 'PURPLE')).rejects.toThrow();
  writeFileSync(f, '{nope');
  await writeSkin(f, 'TOUCH');
  expect(await readSkin(f)).toBe('TOUCH');
});

test('two quick skin writes: the last one wins and the library key is kept', async () => {
  const f = file();
  await mergeSettings(f, { library: '/music' });
  await Promise.all([writeSkin(f, 'NORD'), writeSkin(f, 'KANAGAWA'), mergeSettings(f, { library: '/other' }), writeSkin(f, 'TOUCH')]);
  expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ library: '/other', skin: 'TOUCH' });
});
