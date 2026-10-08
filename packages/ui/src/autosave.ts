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
): Promise<{ doc: Doc; notice: string | null; fresh: boolean }> {
  try {
    const db = await open();
    const raw = await request<unknown>(db, 'readonly', (s) => s.get(KEY));
    if (raw === undefined) return { doc: first, notice: null, fresh: true };
    let doc: Doc | null = null;
    try {
      doc = validateDoc(raw, specs);
    } catch {
      doc = null;
    }
    if (doc) return { doc, notice: null, fresh: false };
    // keep the unreadable save, and replace it so the next launch opens quietly
    await request(db, 'readwrite', (s) => s.put(raw, `backup-${new Date().toISOString()}`));
    await request(db, 'readwrite', (s) => s.put(first, KEY));
    return { doc: first, notice: CORRUPT_NOTICE, fresh: true };
  } catch {
    return { doc: first, notice: null, fresh: true };
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Save 500 ms after the last call. */
export function scheduleSave(doc: Doc): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    open()
      .then((db) => request(db, 'readwrite', (s) => s.put(doc, KEY)))
      .catch(() => undefined); // no storage (tests) or a full disk: the canvas keeps playing
  }, 500);
}
