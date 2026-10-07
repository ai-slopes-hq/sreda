// The canvas autosaves to IndexedDB 500 ms after the last edit; opening the app resumes it (spec §6, §9).
import { starterDoc, validateDoc, type Doc, type Specs } from '@sreda/core';

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

/** The saved canvas, or the starter patch on a first launch; an unreadable save is kept under `backup-<time>`. */
export async function loadSaved(specs: Specs): Promise<{ doc: Doc; notice: string | null }> {
  try {
    const db = await open();
    const raw = await request<unknown>(db, 'readonly', (s) => s.get(KEY));
    if (raw === undefined) return { doc: starterDoc(specs), notice: null };
    const doc = validateDoc(raw, specs);
    if (doc) return { doc, notice: null };
    await request(db, 'readwrite', (s) => s.put(raw, `backup-${new Date().toISOString()}`));
    return { doc: starterDoc(specs), notice: CORRUPT_NOTICE };
  } catch {
    return { doc: starterDoc(specs), notice: null };
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Save 500 ms after the last call. */
export function scheduleSave(doc: Doc): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void open().then((db) => request(db, 'readwrite', (s) => s.put(doc, KEY)));
  }, 500);
}
