# iMovie desktop app

The iMovie web app (`../imovie`) in its own window, built with Electron.

**Download for Windows:** [iMovie-Setup.exe](https://github.com/benrobertson973/wallysite/releases/download/imovie-windows/iMovie-Setup.exe)
(built, installed and tried out on Windows by the `iMovie for Windows` workflow on every change).

- **Windows key = ⌘** (Windows): while iMovie is in front, Win+B splits the clip under the playhead, Win+Z undoes,
  Win+C / Win+V copy and paste, and so on (a keyboard hook, active only while the iMovie window is focused).
  The Windows key on its own still opens Start; Win+L, Win+D, Win+Tab, Win+arrows, the emoji keys and
  Win+Shift+S stay with Windows. Ctrl+B etc. work too.
- **Bigger or smaller:** + and − (or Ctrl/Win + and −) resize the whole interface, Ctrl+0 goes back to actual size.
  iMovie remembers the size, and on a small or low-resolution screen it starts smaller so everything fits.
  Alt + and Alt − zoom the timeline (so do pinching and Ctrl+scroll).
- Drag files in from the desktop, camera and microphone for recording.
- Projects and imported media are kept in `%APPDATA%\iMovie` (they survive updates and uninstalling).

## Build

```sh
npm install
npm run dist:win            # dist/win-unpacked/iMovie.exe (icon + version info set without Wine)
npm run installer:win       # dist/iMovie-Setup-<version>.exe: per-user, desktop + Start menu shortcuts, uninstaller
                            # (needs NSIS's makensis, on any OS: apt install nsis / brew install makensis)
cd test && npm install && node smoke.js <path to iMovie.exe>   # opens it, edits and shares a movie
```

`npm start` runs it from source. `npm run dist:mac` builds a Mac app (on a Mac).
