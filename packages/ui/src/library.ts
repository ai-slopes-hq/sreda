// The library (spec §6): what the Electron preload exposes as `window.sreda`, and the save / open flows over it.
import { emptyDoc, extractGroup, FACTORY, isGroupId, validateDoc, type Doc, type Specs } from '@sreda/core';
import type { LibEntry } from './canvas/patching';
import type { Saving, SessionApi } from './store';

type Kind = 'group' | 'project';

/** The main process's services (packages/app/src/preload). */
export interface SredaBridge {
  /** e2e runs ask for the starter patch on a first launch instead of the factory project Pulse */
  first(): Promise<'starter' | null>;
  settings: {
    /** the saved skin name, or null */
    skin(): Promise<string | null>;
    /** remembered in <userData>/settings.json beside the library folder */
    setSkin(name: string): Promise<void>;
  };
  library: {
    /** the remembered folder, if it still exists */
    folder(): Promise<string | null>;
    /** a folder dialog; remembered in <userData>/settings.json */
    choose(): Promise<string | null>;
    list(): Promise<{ kind: Kind; path: string }[]>;
    /** parsed JSON; throws on bad JSON */
    read(kind: Kind, path: string): Promise<unknown>;
    exists(kind: Kind, path: string): Promise<boolean>;
    write(kind: Kind, path: string, doc: unknown): Promise<void>;
    /** every audio file under samples/ ('drums/kick 909.wav') */
    samples(): Promise<string[]>;
    /** a sample's raw bytes; throws when it is not there */
    readSample(path: string): Promise<ArrayBuffer>;
    /** writes a dropped audio file into samples/ under a free name; returns its path */
    importSample(name: string, bytes: ArrayBuffer): Promise<string>;
  };
}

declare global {
  interface Window {
    sreda?: SredaBridge;
  }
}

/** `/`-separated segments: never empty, `.` or `..`, no `\` or NUL, at most 100 characters (as in packages/app). */
export function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path
      .split('/')
      .every((s) => s.length > 0 && s.length <= 100 && s !== '.' && s !== '..' && !/[\\\0]/.test(s))
  );
}

/** Save, save as, save a frame as a group, open, NEW — against the library folder. */
export function libraryActions(s: SessionApi, specs: Specs, bridge: SredaBridge | undefined = window.sreda) {
  const lib = bridge?.library;
  /** replace the name field's state (a store set would merge into the old one) */
  const setSaving = (v: Saving | null): void => {
    s.setState('saving', null);
    if (v) s.setState('saving', v);
  };

  /** the folder, asked for once (a cancelled dialog cancels whatever needed it) */
  async function ensureFolder(): Promise<boolean> {
    if (!lib) return false;
    return !!((await lib.folder()) ?? (await lib.choose()));
  }

  async function refresh(): Promise<void> {
    if (!lib || !(await lib.folder())) return;
    s.setState(
      'library',
      (await lib.list()).map((e) => ({ ...e, factory: false })),
    );
  }

  async function write(kind: Kind, path: string, doc: Doc): Promise<boolean> {
    if (!lib || !(await ensureFolder())) return false;
    try {
      await lib.write(kind, path, doc);
      return true;
    } catch {
      s.setState('notice', `${path.toUpperCase()} COULD NOT BE SAVED`);
      return false;
    }
  }

  function saveGroup(gid: string): void {
    const g = s.current().groups.find((x) => x.id === gid);
    if (g) setSaving({ kind: 'group', gid, name: g.name.toLowerCase() });
  }

  return {
    refresh,
    saveGroup,
    /** ⌘S: one frame selected saves it as a group; else the project (straight away when it has a name of its own) */
    async save(): Promise<void> {
      const sel = s.state.sel;
      if (sel.length === 1 && isGroupId(sel[0]!)) return saveGroup(sel[0]!);
      const p = s.state.project;
      if (p && !p.factory) {
        if (await write('project', p.path, s.current())) s.markSaved();
        return;
      }
      setSaving({ kind: 'project', name: '' });
    },
    /** ⇧⌘S: always asks for a name */
    saveAs(): void {
      const p = s.state.project;
      setSaving({ kind: 'project', name: p && !p.factory ? p.path : '' });
    },
    /** Enter in the name field: an invalid name stays; an existing one asks once to be replaced */
    async submit(name: string): Promise<void> {
      const sv = s.state.saving;
      if (!sv) return;
      const path = name.trim();
      if (!validPath(path)) {
        setSaving({ kind: sv.kind, ...(sv.gid ? { gid: sv.gid } : {}), name, invalid: true });
        return;
      }
      if (!(await ensureFolder())) {
        setSaving(null);
        return;
      }
      if (sv.confirm !== path && (await lib!.exists(sv.kind, path))) {
        setSaving({ ...sv, name, confirm: path, invalid: false });
        return;
      }
      const doc = sv.kind === 'group' ? extractGroup(s.current(), sv.gid!) : s.current();
      if (!(await write(sv.kind, path, doc))) return;
      if (sv.kind === 'project') {
        s.setProject({ path, factory: false });
        s.markSaved();
      }
      setSaving(null);
      await refresh();
    },
    cancel(): void {
      setSaving(null);
    },
    /** a picker entry as a document, or null with a notice when it will not open */
    async read(entry: LibEntry): Promise<Doc | null> {
      if (entry.factory) return FACTORY.find((e) => `FACTORY/${e.name}` === entry.path)?.build(specs) ?? null;
      let doc: Doc | null;
      try {
        doc = lib ? validateDoc(await lib.read(entry.kind, entry.path), specs) : null;
      } catch {
        doc = null;
      }
      if (!doc) s.setState('notice', `${entry.path.toUpperCase()} COULD NOT BE OPENED`);
      return doc;
    },
    /** NEW: an empty canvas (an undo step), the project unnamed */
    clear(): void {
      s.commit(emptyDoc);
      s.setProject(null);
    },
  };
}

export type LibraryApi = ReturnType<typeof libraryActions>;
