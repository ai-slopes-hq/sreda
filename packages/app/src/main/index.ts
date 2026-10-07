import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { app, BrowserWindow, protocol, session } from 'electron';

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
  createWindow();
});

app.on('window-all-closed', () => app.quit());
