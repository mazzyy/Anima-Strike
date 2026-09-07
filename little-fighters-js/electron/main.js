/**
 * Electron main process.
 *
 * Two jobs:
 *   1. Open the game window, serving the renderer over a custom `app://`
 *      scheme. That matters: ES modules will not load over file:// because
 *      the origin is opaque, and the usual workaround (webSecurity: false)
 *      turns off protections we would rather keep.
 *   2. Hold the Azure credentials. The API key never enters the renderer —
 *      the game asks for a tactic over IPC and gets back a plain object.
 */

import { app, BrowserWindow, protocol, net, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AzureBrain } from './azure-brain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, '..', 'renderer');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const brain = new AzureBrain();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#05060d',
    title: 'Little Fighters',
    show: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Open external links in the real browser, never in the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL('app://game/index.html');
  return win;
}

app.whenReady().then(() => {
  // Serve renderer/ over app://, refusing anything that escapes the folder.
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.join(RENDERER, rel);
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(RENDERER))) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });

  ipcMain.handle('azure:tactic', async (_event, snapshot) => brain.requestTactic(snapshot));
  ipcMain.handle('azure:status', async () => brain.status());
  ipcMain.handle('azure:usage', async () => brain.totals);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
