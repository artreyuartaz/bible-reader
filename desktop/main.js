// Desktop shell: serves the same front end + API as server.js, but through a custom app:// protocol
// handled in-process, so there is no web host, no port and no network involved. Run: npm run desktop
const { app, BrowserWindow, protocol, shell, Menu } = require('electron');
const path = require('path');

// Where bookmarks/notes live. Running from source keeps using the repo's data/ (shared with the web app);
// the portable build stores them next to the .exe, an installed build in the user profile.
if (!process.env.DATA_DIR && app.isPackaged) {
  process.env.DATA_DIR = path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData'), 'data');
}
const { handle } = require('../core');

const ORIGIN = 'app://bible';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 480, minHeight: 400, title: 'Bible Reader', icon: path.join(__dirname, '..', 'bible-app-leather.ico'), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(ORIGIN + '/');
  // Never navigate away from the app; anything external opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    const origin = req.headers.get('origin');
    const body = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await req.arrayBuffer());
    const out = handle({
      method: req.method,
      url: u.pathname + u.search,
      contentType: req.headers.get('content-type'),
      sameOrigin: !origin || origin === ORIGIN,
      body,
    });
    return new Response(req.method === 'HEAD' ? null : out.body, { status: out.status, headers: out.headers });
  });
  // Keep the usual shortcuts (copy/paste, zoom, reload, dev tools) without a visible menu bar.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
