/* iMovie desktop app: the web app (web/, copied from ../imovie at build time) in its own window. */
'use strict';
const { app, BrowserWindow, Menu, ipcMain, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, 'web', 'index.html');
let win = null;

// ---- settings (%APPDATA%\iMovie\settings.json) ----
let settings = {};
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch (err) { settings = {}; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 1)); } catch (err) { console.warn('Could not save settings:', err); }
}

// ---- interface size: + and − make the whole window bigger or smaller, like a browser's zoom ----
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** The editor is laid out for about 1280×720 or more; on a small or scaled-up screen it starts smaller so it all fits. */
function fittingZoom() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const fit = Math.min(1, width / 1280, height / 720);
  return ZOOMS.filter((z) => z >= 0.67 && z <= fit + 1e-6).pop() || 0.67;
}
function currentZoom() {
  const z = Number(settings.zoom);
  return ZOOMS.includes(z) ? z : fittingZoom();
}
/** Smallest window that still fits the editor at zoom z (never more than the screen). */
function minSize(z) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return [Math.min(Math.round(1000 * z), width), Math.min(Math.round(640 * z), height)];
}
ipcMain.handle('zoom', (e, how) => {
  const wc = e.sender;
  const cur = wc.getZoomFactor();
  let z = cur;
  if (how === 'in') z = ZOOMS.find((s) => s > cur + 0.001) || ZOOMS[ZOOMS.length - 1];
  else if (how === 'out') z = ZOOMS.slice().reverse().find((s) => s < cur - 0.001) || ZOOMS[0];
  else if (how === 'reset') z = 1;
  if (z !== cur) {
    wc.setZoomFactor(z);
    settings.zoom = z;
    saveSettings();
    const w = BrowserWindow.fromWebContents(wc);
    if (w) w.setMinimumSize(...minSize(z));
  }
  return z;
});

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  const zoom = currentZoom();
  const [minWidth, minHeight] = minSize(zoom);
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth, minHeight,
    title: 'iMovie', backgroundColor: '#1e1e1e', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), zoomFactor: zoom,
      contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => { if (!process.env.IMOVIE_TEST) win.maximize(); win.show(); });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  // stay in the app: a file dropped outside a drop target mustn't replace the page; web links open in the browser
  wc.on('will-navigate', (e, url) => { if (url !== wc.getURL()) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:')) return { action: 'allow' }; // "Show" after a share opens the movie in a window
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // a trackpad pinch zooms the timeline (the page receives it as ctrl+wheel), not the whole window
  wc.setVisualZoomLevelLimits(1, 1);
  // the saved interface size (the page's + and − keys change it)
  wc.on('did-finish-load', () => { const z = currentZoom(); if (Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z); });

  win.loadFile(WEB);

  // On Windows the Windows key acts as ⌘ while iMovie is in front (Win+B splits a clip, Win+Z undoes, …)
  if (process.platform === 'win32') {
    try {
      global.winKeys = require('./winkeys').attach(win);
    } catch (err) {
      global.winKeys = { error: String((err && err.message) || err) };
      console.warn('Windows key shortcuts unavailable:', err);
    }
  }
}

app.whenReady().then(() => {
  loadSettings();
  // camera and microphone (FaceTime import, voiceover), saving shared movies, clipboard
  const allowed = new Set(['media', 'fileSystem', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allowed.has(perm));
  if (process.platform === 'darwin') {
    // text fields need the standard Edit menu for ⌘C / ⌘V on a Mac; everything else is the app's own menu bar
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]));
  } else Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
