import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron';
import {
  existsEntry,
  importSample,
  listLibrary,
  listSamples,
  readEntry,
  readSample,
  writeEntry,
  type Kind,
} from './library';
import { mergeSettings, readSettings, readSkin, writeSkin } from './settings';

// Every response carries COOP / COEP so the renderer is cross-origin isolated (SharedArrayBuffer).
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// e2e tests give every run its own user-data folder (IndexedDB autosave lives there).
const userData = process.env['SREDA_USER_DATA'];
if (userData) app.setPath('userData', userData);

// The built renderer is served from app://sreda/ (a file:// page cannot be cross-origin isolated).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function serveRenderer(): void {
  const root = join(__dirname, '../renderer');
  protocol.handle('app', async (request) => {
    const path = normalize(decodeURIComponent(new URL(request.url).pathname)).replace(/^([/\\])+/, '');
    const file = join(root, path || 'index.html');
    if (!file.startsWith(root)) return new Response('not found', { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...ISOLATION },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// e2e runs keep the window hidden: a real mouse over a visible test window injects pointer events into the
// synthetic drags (seen as flaky knob drags); hidden windows must not be throttled.
const e2e = !!process.env['SREDA_E2E'];

function createWindow(): void {
  const win = new BrowserWindow({
    show: !e2e,
    width: 1440,
    height: 900,
    title: 'SREDA',
    backgroundColor: '#121210',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: !e2e,
    },
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadURL('app://sreda/index.html');
}

// The library folder: SREDA_LIBRARY (e2e) or the one chosen once, remembered in <userData>/settings.json.
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
async function libraryFolder(): Promise<string | null> {
  let folder = process.env['SREDA_LIBRARY'] ?? null;
  if (!folder)
    try {
      const lib = (await readSettings(settingsFile()))['library'];
      folder = typeof lib === 'string' ? lib : null;
    } catch {
      folder = null;
    }
  if (!folder) return null;
  try {
    return (await stat(folder)).isDirectory() ? folder : null;
  } catch {
    return null; // the folder was moved or deleted: ask again
  }
}
async function root(): Promise<string> {
  const folder = await libraryFolder();
  if (!folder) throw new Error('no library folder');
  return folder;
}
const kindOf = (k: unknown): Kind => {
  if (k !== 'group' && k !== 'project') throw new Error('bad kind');
  return k;
};
const pathOf = (p: unknown): string => {
  if (typeof p !== 'string') throw new Error('bad path');
  return p; // library.ts refuses invalid paths and anything outside the folder
};

function serveLibrary(): void {
  ipcMain.handle('library:folder', () => libraryFolder());
  ipcMain.handle('library:choose', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose a library folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = r.canceled ? null : (r.filePaths[0] ?? null);
    if (folder) await mergeSettings(settingsFile(), { library: folder });
    return folder;
  });
  ipcMain.handle('settings:skin', () => readSkin(settingsFile()));
  ipcMain.handle('settings:setSkin', (_e, name: unknown) => writeSkin(settingsFile(), name));
  ipcMain.handle('library:list', async () => listLibrary(await root()));
  ipcMain.handle('library:read', async (_e, kind: unknown, path: unknown) =>
    readEntry(await root(), kindOf(kind), pathOf(path)),
  );
  ipcMain.handle('library:exists', async (_e, kind: unknown, path: unknown) =>
    existsEntry(await root(), kindOf(kind), pathOf(path)),
  );
  ipcMain.handle('library:write', async (_e, kind: unknown, path: unknown, doc: unknown) =>
    writeEntry(await root(), kindOf(kind), pathOf(path), doc),
  );
  ipcMain.handle('library:samples', async () => listSamples(await root()));
  ipcMain.handle('library:readSample', async (_e, path: unknown) => readSample(await root(), pathOf(path)));
  // a file the user dropped: its name and bytes, written into samples/ (nothing is read from elsewhere)
  ipcMain.handle('library:importSample', async (_e, name: unknown, bytes: unknown) => {
    if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Uint8Array)) throw new Error('bad bytes');
    return importSample(await root(), pathOf(name), bytes);
  });
}

void app.whenReady().then(() => {
  // Add the isolation headers to responses that lack them (a duplicated header value breaks isolation).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    const present = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
    for (const [name, value] of Object.entries(ISOLATION))
      if (!present.has(name.toLowerCase())) headers[name] = [value];
    callback({ responseHeaders: headers });
  });
  serveRenderer();
  serveLibrary();
  // e2e runs open the starter patch on a first launch, not the factory project Pulse
  ipcMain.handle('sreda:first', () => (process.env['SREDA_FIRST'] === 'starter' ? 'starter' : null));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
