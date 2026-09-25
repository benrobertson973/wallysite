/* iMovie desktop app: the web app (web/, copied from ../imovie at build time) in its own window. */
'use strict';
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('path');

const WEB = path.join(__dirname, 'web', 'index.html');
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    title: 'iMovie', backgroundColor: '#1e1e1e', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: false },
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

  win.loadFile(WEB);

  // On Windows the Windows key acts as ⌘ while iMovie is in front (Win+B splits a clip, Win+Z undoes, …)
  if (process.platform === 'win32') {
    try { require('./winkeys').attach(win); } catch (err) { console.warn('Windows key shortcuts unavailable:', err); }
  }
}

app.whenReady().then(() => {
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
