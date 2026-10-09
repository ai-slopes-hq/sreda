// The canvas autosaves to IndexedDB 500 ms after the last edit; opening the app resumes it (spec §6, §9).
import { validateDoc, type Doc, type Specs } from '@sreda/core';

const DB = 'sreda';
const STORE = 'session';
const KEY = 'current';
export const CORRUPT_NOTICE = 'AUTOSAVE WAS UNREADABLE — KEPT AS BACKUP, OPENED A NEW PATCH';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  f: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = f(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The saved canvas, or `first` on a first launch; an unreadable save is kept under `backup-<time>`. */
export async function loadSaved(
  specs: Specs,
  first: Doc,
): Promise<{ doc: Doc; notice: string | null; fresh: boolean; project: Project }> {
  try {
    const db = await open();
    const raw = await request<unknown>(db, 'readonly', (s) => s.get(KEY));
    if (raw === undefined) return { doc: first, notice: null, fresh: true, project: null };
    // { doc, project } since Plan 3; a bare document before
    const saved =
      typeof raw === 'object' && raw !== null && 'doc' in raw
        ? (raw as { doc: unknown; project?: unknown })
        : null;
    const project = saved ? readProject(saved.project) : null;
    let doc: Doc | null = null;
    try {
      doc = validateDoc(saved ? saved.doc : raw, specs);
    } catch {
      doc = null;
    }
    if (doc) return { doc, notice: null, fresh: false, project };
    // keep the unreadable save, and replace it so the next launch opens quietly
    await request(db, 'readwrite', (s) => s.put(raw, `backup-${new Date().toISOString()}`));
    await request(db, 'readwrite', (s) => s.put({ doc: first, project: null }, KEY));
    return { doc: first, notice: CORRUPT_NOTICE, fresh: true, project: null };
  } catch {
    return { doc: first, notice: null, fresh: true, project: null };
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

type Project = { path: string; factory: boolean; file?: true } | null;
function readProject(x: unknown): Project {
  if (typeof x !== 'object' || x === null) return null;
  const p = x as { path?: unknown; factory?: unknown; file?: unknown };
  if (typeof p.path !== 'string') return null;
  return p.file === true
    ? { path: p.path, factory: false, file: true }
    : { path: p.path, factory: p.factory === true };
}

/** Save the canvas and its project name 500 ms after the last call. */
export function scheduleSave(doc: Doc, project: Project): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    open()
      .then((db) => request(db, 'readwrite', (s) => s.put({ doc, project }, KEY)))
      .catch(() => undefined); // no storage (tests) or a full disk: the canvas keeps playing
  }, 500);
}
