# iMovie desktop app

The iMovie web app (`../imovie`) in its own window, built with Electron.

- **Windows key = ⌘** (Windows): while iMovie is in front, Win+B splits the clip under the playhead, Win+Z undoes,
  Win+C / Win+V copy and paste, and so on (a keyboard hook, active only while the iMovie window is focused).
  The Windows key on its own still opens Start; Win+L, Win+D, Win+Tab, Win+arrows, the emoji keys and
  Win+Shift+S stay with Windows. Ctrl+B etc. work too.
- Pinch to zoom the timeline, drag files in from the desktop, camera and microphone for recording.
- Projects and imported media are kept in `%APPDATA%\iMovie` (they survive updates and uninstalling).

## Build

```sh
npm install
npm run dist:win            # dist/win-unpacked/iMovie.exe (icon + version info set without Wine)
# installer (per-user, desktop + Start menu shortcuts), with NSIS's makensis on any OS:
makensis -DSRCDIR=$PWD/dist/win-unpacked -DOUTFILE=$PWD/dist/iMovie-Setup-1.0.0.exe \
         -DICON=$PWD/build/icon.ico -DVERSION=1.0.0 installer/imovie.nsi
```

`npm start` runs it from source. `npm run dist:mac` builds a Mac app (on a Mac).
