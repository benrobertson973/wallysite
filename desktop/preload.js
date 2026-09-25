/* The page's bridge to the desktop app: window.imovieDesktop (see IM.desktop in the web app). */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('imovieDesktop', {
  platform: process.platform,
  /** 'in' | 'out' | 'reset': make the whole window bigger, smaller or actual size. Resolves to the new zoom factor. */
  zoom: (how) => ipcRenderer.invoke('zoom', String(how)),
});
