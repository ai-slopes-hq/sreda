import { expect, test } from 'vitest';
import { allowPermission } from './permissions';

// Electron 44 requests `midiSysex` for every Web MIDI access (even `sysex: false`): refusing it breaks MIDI.
// SysEx is kept out by the renderer asking with `sysex: false` (Chromium then refuses to send it).
test('allowPermission allows midi and midiSysex (Electron asks for midiSysex on every MIDI request)', () => {
  expect(allowPermission('midi')).toBe(true);
  expect(allowPermission('midiSysex')).toBe(true);
});

test('allowPermission leaves every other permission as Electron decides by default (allowed)', () => {
  expect(allowPermission('clipboard-read')).toBe(true);
  expect(allowPermission('media')).toBe(true);
});
