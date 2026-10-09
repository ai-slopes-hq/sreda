// <userData>/settings.json: `{ library?, skin? }`. Writes merge keys; a corrupt file reads as empty.
import { readFile, writeFile } from 'node:fs/promises';

/** the skin names of packages/ui/src/skins.ts (the main process does not import the UI) */
export const SKIN_NAMES = ['DEFAULT', 'ANNABIOSIS', 'KANAGAWA', 'TOUCH', 'NORD', 'TOKYO NIGHT'] as const;

export async function readSettings(file: string): Promise<Record<string, unknown>> {
  try {
    const v: unknown = JSON.parse(await readFile(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function mergeSettings(file: string, patch: Record<string, unknown>): Promise<void> {
  await writeFile(file, JSON.stringify({ ...(await readSettings(file)), ...patch }, null, 2));
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
