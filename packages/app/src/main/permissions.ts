/**
 * What the renderer may ask the browser for. There was no handler before, so every permission is allowed, as
 * Electron does by default; the one question is Web MIDI.
 *
 * Electron 44 asks for `midiSysex` on every `requestMIDIAccess()`, even with `{ sysex: false }` (seen in the
 * request handler: the request arrives as `midiSysex` and `midi` is only checked afterwards), so refusing it
 * would refuse MIDI altogether. The app stays unable to send SysEx all the same: the renderer asks with
 * `sysex: false`, and Chromium then throws on any SysEx message at `MIDIOutput.send` (verified in the running app).
 */
export function allowPermission(_permission: string): boolean {
  return true;
}
