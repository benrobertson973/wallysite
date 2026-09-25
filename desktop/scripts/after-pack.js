// electron-builder afterPack: keep only this platform's koffi binary, and on Windows put the iMovie icon and
// version info on iMovie.exe (done here with resedit, so building on Linux needs no Wine).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(ctx) {
  const plat = ctx.electronPlatformName; // 'win32' | 'darwin' | 'linux'
  const arch = { 1: 'x64', 3: 'arm64', 0: 'ia32' }[ctx.arch] || 'x64';
  const res = plat === 'darwin'
    ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(ctx.appOutDir, 'resources');
  const koffiBuild = path.join(res, 'app.asar.unpacked', 'node_modules', 'koffi', 'build', 'koffi');
  if (fs.existsSync(koffiBuild)) {
    const keep = `${plat}_${arch}`;
    for (const d of fs.readdirSync(koffiBuild)) if (d !== keep) fs.rmSync(path.join(koffiBuild, d), { recursive: true, force: true });
  }
  if (plat !== 'win32') return;
  const ResEdit = require('resedit');
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const exeFile = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res2 = ResEdit.NtExecutableResource.from(exeFile);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  // the main icon group of electron.exe is resource ID 1
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res2.entries, 1, 1033, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res2.entries)[0];
  const version = ctx.packager.appInfo.version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(version[0], version[1], version[2], 0, 1033);
  vi.setProductVersion(version[0], version[1], version[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'iMovie', ProductName: 'iMovie', InternalName: 'iMovie', OriginalFilename: 'iMovie.exe',
    CompanyName: 'iMovie for the web', LegalCopyright: '',
  });
  vi.outputToResourceEntries(res2.entries);
  res2.outputResource(exeFile);
  fs.writeFileSync(exe, Buffer.from(exeFile.generate()));
  console.log('  • set icon and version info on', path.basename(exe));
};
