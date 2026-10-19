// <userData>/settings.json: `{ library?, skin? }`. Writes merge keys; a corrupt file reads as empty.
import { readFile, rename, writeFile } from 'node:fs/promises';

/** the skin names of packages/ui/src/skins.ts (the main process does not import the UI) */
export const SKIN_NAMES = ['DEFAULT', 'ANNABIOSIS', 'KANAGAWA', 'TOUCH', 'NORD', 'TOKYO NIGHT', 'ORCA'] as const;

export async function readSettings(file: string): Promise<Record<string, unknown>> {
  try {
    const v: unknown = JSON.parse(await readFile(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** the writes in flight, per file: a write starts when the one before it has finished */
const chains = new Map<string, Promise<void>>();

/** Merge keys into the file: writes run one after another (read-modify-write), each through a temporary file renamed over it. */
export function mergeSettings(file: string, patch: Record<string, unknown>): Promise<void> {
  const run = async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...(await readSettings(file)), ...patch }, null, 2));
    await rename(tmp, file);
  };
  const next = (chains.get(file) ?? Promise.resolve()).then(run, run);
  const tail = next.catch(() => {});
  chains.set(file, tail);
  void tail.then(() => chains.get(file) === tail && chains.delete(file));
  return next;
}

/** the saved skin, or null when there is none or it is not a known name */
export async function readSkin(file: string): Promise<string | null> {
  const skin = (await readSettings(file))['skin'];
  return typeof skin === 'string' && (SKIN_NAMES as readonly string[]).includes(skin) ? skin : null;
}

export async function writeSkin(file: string, name: unknown): Promise<void> {
  if (typeof name !== 'string' || !(SKIN_NAMES as readonly string[]).includes(name)) throw new Error('bad skin');
  await mergeSettings(file, { skin: name });
}
