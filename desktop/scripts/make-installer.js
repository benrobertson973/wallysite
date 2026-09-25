// Windows installer (dist/iMovie-Setup-<version>.exe) from dist/win-unpacked, which `npm run dist:win` builds.
// Needs NSIS's makensis, on any OS: on the PATH (apt install nsis / brew install makensis / choco install nsis),
// or named by the MAKENSIS environment variable.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const src = path.join(root, 'dist', 'win-unpacked');
if (!fs.existsSync(path.join(src, 'iMovie.exe'))) {
  console.error('dist/win-unpacked/iMovie.exe is missing: run `npm run dist:win` first.');
  process.exit(1);
}
const out = path.join(root, 'dist', `iMovie-Setup-${version}.exe`);
execFileSync(process.env.MAKENSIS || 'makensis', [
  '-V2', `-DSRCDIR=${src}`, `-DOUTFILE=${out}`, `-DICON=${path.join(root, 'build', 'icon.ico')}`, `-DVERSION=${version}`,
  path.join(root, 'installer', 'imovie.nsi'),
], { stdio: 'inherit' });
console.log(`  • installer ${path.relative(root, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
