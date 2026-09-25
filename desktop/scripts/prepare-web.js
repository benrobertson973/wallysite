// Copies the web app (../imovie) into web/, which is what the desktop app loads.
'use strict';
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'imovie');
const dst = path.join(__dirname, '..', 'web');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith('README.md') });
console.log('web app copied to', dst);
