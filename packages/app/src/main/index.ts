import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } from 'electron';
import {
  existsEntry,
  importFiles,
  importSample,
  listLibrary,
  listSamples,
  openedFiles,
  readEntry,
  readSample,
  SAMPLE_EXT,
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

/** The standard macOS menus (app, Edit, View, Window), with a File menu after the app menu. */
function buildMenu(): void {
  const mac = process.platform === 'darwin';
  const file: Electron.MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        id: 'importSamples',
        label: 'Import Samples…',
        accelerator: 'Shift+CmdOrCtrl+I',
        click: () => BrowserWindow.getAllWindows()[0]?.webContents.send('menu:importSamples'),
      },
      { type: 'separator' },
      { role: mac ? 'close' : 'quit' },
    ],
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      file,
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

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
/** the folder dialog: the chosen folder is remembered as the library */
async function chooseFolder(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: 'Choose a library folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  const folder = r.canceled ? null : (r.filePaths[0] ?? null);
  if (folder) await mergeSettings(settingsFile(), { library: folder });
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

// paths `project:open` handed out survive a relaunch in settings.json, so ⌘S still works on a resumed project
const projectFiles = (async () => {
  const saved = (await readSettings(settingsFile()))['openedFiles'];
  const list = Array.isArray(saved) ? saved.filter((p): p is string => typeof p === 'string') : [];
  return openedFiles(list, (recent) => mergeSettings(settingsFile(), { openedFiles: recent }));
})();

function serveLibrary(): void {
  // ⌘O: any project file on disk (e2e: SREDA_E2E_OPEN stands in for the dialog)
  ipcMain.handle('project:open', async () => {
    let file = e2e ? (process.env['SREDA_E2E_OPEN'] ?? null) : null;
    if (!file) {
      const r = await dialog.showOpenDialog({
        title: 'Open a project',
        properties: ['openFile'],
        filters: [{ name: 'SREDA project', extensions: ['json'] }],
      });
      file = r.canceled ? null : (r.filePaths[0] ?? null);
    }
    return file ? (await projectFiles).open(file) : null;
  });
  ipcMain.handle('project:save', async (_e, path: unknown, doc: unknown) =>
    (await projectFiles).save(path, doc),
  );
  ipcMain.handle('library:folder', () => libraryFolder());
  ipcMain.handle('library:choose', () => chooseFolder());
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
  // File › Import Samples…: audio files picked in a dialog (e2e: SREDA_E2E_IMPORT, comma-separated paths)
  const pickAudio = async (title: string, multi: boolean): Promise<string[]> => {
    const stub = e2e ? process.env['SREDA_E2E_IMPORT'] : undefined;
    if (stub) return stub.split(',').filter(Boolean);
    const r = await dialog.showOpenDialog({
      title,
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Audio', extensions: SAMPLE_EXT.map((x) => x.slice(1)) }],
    });
    return r.canceled ? [] : r.filePaths;
  };
  ipcMain.handle('library:importFromDialog', async () =>
    importFiles(await root(), await pickAudio('Import samples', true)),
  );
  // LOAD on a SAMPLER / GRAINS: one audio file, copied into samples/; the library folder is asked for first
  ipcMain.handle('samples:pickOne', async () => {
    const folder = (await libraryFolder()) ?? (await chooseFolder());
    if (!folder) return null;
    const files = await pickAudio('Load a sample', false);
    return (await importFiles(folder, files.slice(0, 1)))[0] ?? null;
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
  buildMenu();
  // e2e runs open the starter patch on a first launch, not the factory project Pulse
  ipcMain.handle('sreda:first', () => (process.env['SREDA_FIRST'] === 'starter' ? 'starter' : null));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
