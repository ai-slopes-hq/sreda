// The library folder (spec §6): groups/**/<name>.sreda-group.json and projects/**/<name>.sreda.json. Pure Node; the
// main process reaches it over IPC (index.ts). Nothing is ever read or written outside the folder.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';

export type Kind = 'group' | 'project';
const DIR: Record<Kind, string> = { group: 'groups', project: 'projects' };
const EXT: Record<Kind, string> = { group: '.sreda-group.json', project: '.sreda.json' };

/** `/`-separated segments: never empty, `.` or `..`, no `\` or NUL, at most 100 characters (as in packages/ui). */
export function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path
      .split('/')
      .every((s) => s.length > 0 && s.length <= 100 && s !== '.' && s !== '..' && !/[\\\0]/.test(s))
  );
}

/** The file an entry lives in; throws for an invalid path or one that would leave the folder. */
export function fileFor(root: string, kind: Kind, path: string): string {
  if (!validPath(path)) throw new Error(`invalid library path: ${path}`);
  const file = join(root, DIR[kind], ...path.split('/')) + EXT[kind];
  if (!file.startsWith(root + sep)) throw new Error(`outside the library: ${path}`);
  return file;
}

/** Every group and project in the folder (subfolders are path prefixes); a missing folder has none. */
export async function listLibrary(root: string): Promise<{ kind: Kind; path: string }[]> {
  const out: { kind: Kind; path: string }[] = [];
  for (const kind of ['group', 'project'] as const) {
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // no such folder
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.isDirectory()) await walk(join(dir, e.name), `${prefix}${e.name}/`);
        else if (e.isFile() && e.name.endsWith(EXT[kind])) {
          const name = e.name.slice(0, -EXT[kind].length);
          const path = prefix + name;
          if (validPath(path)) out.push({ kind, path });
        }
      }
    };
    await walk(join(root, DIR[kind]), '');
  }
  return out;
}

export async function readEntry(root: string, kind: Kind, path: string): Promise<unknown> {
  return JSON.parse(await readFile(fileFor(root, kind, path), 'utf8'));
}

export async function existsEntry(root: string, kind: Kind, path: string): Promise<boolean> {
  try {
    await readFile(fileFor(root, kind, path));
    return true;
  } catch {
    return false;
  }
}

/** Write an entry: its folders made, replaced atomically (a temporary file renamed over it). */
export async function writeEntry(root: string, kind: Kind, path: string, doc: unknown): Promise<void> {
  const file = fileFor(root, kind, path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeJsonAtomic(file, doc);
}

/** The audio files the sample pool reads (spec §7a). */
export const SAMPLE_EXT = ['.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg'];
const isSample = (name: string) => SAMPLE_EXT.includes(extname(name).toLowerCase());

/** The file a sample lives in; throws for an invalid path, a non-audio file or one that would leave samples/. */
function sampleFile(root: string, path: string): string {
  if (!validPath(path) || !isSample(path)) throw new Error(`invalid sample path: ${path}`);
  const base = join(root, 'samples');
  const file = join(base, ...path.split('/'));
  if (!file.startsWith(base + sep)) throw new Error(`outside samples: ${path}`);
  return file;
}

/** Every audio file under samples/, as `/`-separated paths with their extension, sorted; a missing folder has none. */
export async function listSamples(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name), `${prefix}${e.name}/`);
      // only names the library can read back (as for groups and projects: ≤ 100 characters, no `\`)
      else if (isSample(e.name) && validPath(prefix + e.name)) out.push(prefix + e.name);
    }
  };
  await walk(join(root, 'samples'), '');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A sample's bytes. */
export async function readSample(root: string, path: string): Promise<ArrayBuffer> {
  const b = await readFile(sampleFile(root, path));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Writes a dropped audio file into samples/ under a free name (`kick 2.wav`); returns its path. */
export async function importSample(
  root: string,
  name: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const base = basename(name);
  if (!isSample(base)) throw new Error(`not an audio file: ${name}`);
  const ext = extname(base);
  // a name the library can read back: no `\`, short enough to take a ` 99` suffix
  const stem =
    basename(base, ext)
      .replace(/[\\\0]/g, '_')
      .slice(0, 90 - ext.length) || 'sample';
  await mkdir(join(root, 'samples'), { recursive: true });
  for (let n = 1; ; n++) {
    const name = n === 1 ? stem + ext : `${stem} ${n}${ext}`;
    const file = sampleFile(root, name);
    try {
      await stat(file);
    } catch {
      await writeFile(file, new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), {
        flag: 'wx',
      });
      return name;
    }
  }
}

/** Copies audio files picked in a dialog into samples/ (free names); returns their library paths. Files that are not audio or cannot be read are skipped. */
export async function importFiles(root: string, files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    if (!isSample(file)) continue;
    try {
      out.push(await importSample(root, basename(file), await readFile(file)));
    } catch {
      // unreadable: skipped
    }
  }
  return out;
}

/** Replace a file with a document: written to a temporary file (a name of its own), renamed over it. */
export async function writeJsonAtomic(file: string, doc: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n');
  await rename(tmp, file);
}

/** What `save` rejects with for a path that was not opened (or has aged out of the remembered ones); the renderer looks for it. */
export const NOT_OPENED = 'not an opened project file';

/** the minimal shape of a SREDA project: an object with a `modules` array (validation proper is the renderer's) */
const looksLikeProject = (doc: unknown): boolean =>
  typeof doc === 'object' && doc !== null && Array.isArray((doc as { modules?: unknown }).modules);

/** the most opened paths remembered across runs */
export const OPENED_LIMIT = 20;

/**
 * Project files outside the library: only a path `open` handed out (in this run, or in an earlier one that
 * `persist`ed it) may be written back.
 */
export function openedFiles(
  initial: string[] = [],
  persist: (recent: string[]) => Promise<void> = async () => {},
) {
  let recent = initial.slice(0, OPENED_LIMIT);
  return {
    /** the file's parsed JSON; its path may be saved to from now on. A file that is not JSON, or not shaped like a project, comes back as `error` and is not remembered. */
    async open(file: string): Promise<{ path: string; doc?: unknown; error?: true }> {
      let doc: unknown;
      try {
        doc = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        return { path: file, error: true };
      }
      if (!looksLikeProject(doc)) return { path: file, error: true };
      recent = [file, ...recent.filter((p) => p !== file)].slice(0, OPENED_LIMIT);
      // the file is open either way: a settings file that cannot be written only costs ⌘S after a relaunch
      await persist(recent).catch(() => {});
      return { path: file, doc };
    },
    async save(path: unknown, doc: unknown): Promise<void> {
      if (typeof path !== 'string' || !recent.includes(path)) throw new Error(NOT_OPENED);
      // a symlink is written through, not replaced
      const real = await realpath(path).catch(() => path);
      await writeJsonAtomic(real, doc);
    },
  };
}
