// The library folder (spec §6): groups/**/<name>.sreda-group.json and projects/**/<name>.sreda.json. Pure Node; the
// main process reaches it over IPC (index.ts). Nothing is ever read or written outside the folder.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

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
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n');
  await rename(tmp, file);
}
