// Smoke test for a built iMovie desktop app (CI runs it on Windows after installing the app):
//   cd test && npm install && node smoke.js <path to iMovie.exe (or the Linux / Mac executable)>
// Opens the editor, makes a two-clip movie, splits a clip with Ctrl+B (what the Windows key sends), changes the
// interface size, and shares the movie, checking the file's codecs, length and frame count.
'use strict';
const { _electron } = require('playwright');

const exe = process.argv[2];
if (!exe) { console.error('usage: node smoke.js <iMovie executable>'); process.exit(2); }
const check = (ok, what) => {
  if (!ok) throw new Error('FAILED: ' + what);
  console.log('  ok  ' + what);
};

(async () => {
  const app = await _electron.launch({
    executablePath: exe,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env: Object.assign({}, process.env, { IMOVIE_TEST: '1' }),
    timeout: 120000,
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.setDefaultTimeout(300000);
    await page.waitForFunction(() => window.IM && IM.ready, null, { timeout: 120000 });
    const env = await page.evaluate(() => ({ platform: IM.desktop && IM.desktop.platform, webgl: !!document.createElement('canvas').getContext('webgl2') }));
    check(env.platform === process.platform, `the editor opened in the desktop app (${env.platform})`);
    const gpu = await app.evaluate(({ app: a }) => a.getGPUFeatureStatus());
    console.log('      graphics: ' + JSON.stringify({ webgl2: gpu.webgl2, compositing: gpu.gpu_compositing }));
    check(env.webgl, 'WebGL 2 is available');
    const win = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.focus();
      const k = global.winKeys;
      return { title: w.getTitle(), winKeys: k ? (k.error ? 'error: ' + k.error : k.active() ? 'active' : 'ready') : 'n/a' };
    });
    check(win.title === 'iMovie', 'window title');
    if (process.platform === 'win32') check(!/^error/.test(win.winKeys), `Windows key shortcuts loaded (${win.winKeys})`);

    // a movie from two generated clips
    const clips = await page.evaluate(async () => {
      const mb = await IM.loadMediabunny();
      async function makeVideo(label, hue, seconds) {
        const c = document.createElement('canvas'); c.width = 640; c.height = 360;
        const ctx = c.getContext('2d');
        const output = new mb.Output({ format: new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
        const vs = new mb.CanvasSource(c, { codec: 'vp9', bitrate: 2e6, keyFrameInterval: 1 });
        output.addVideoTrack(vs, { frameRate: 30 });
        const as = new mb.AudioBufferSource({ codec: 'opus', bitrate: 128000 });
        output.addAudioTrack(as);
        await output.start();
        for (let i = 0; i < seconds * 30; i++) {
          ctx.fillStyle = `hsl(${(hue + i * 3) % 360},55%,45%)`; ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = '#fff'; ctx.font = 'bold 100px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label + i, 320, 250);
          await vs.add(i / 30, 1 / 30);
        }
        const ab = new AudioBuffer({ length: seconds * 48000, numberOfChannels: 2, sampleRate: 48000 });
        for (let ch = 0; ch < 2; ch++) { const d = ab.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / 48000); }
        await as.add(ab);
        await output.finalize();
        return new Blob([output.target.buffer], { type: 'video/webm' });
      }
      await IM.newMovie();
      const p = IM.app.project, Pr = IM.Project;
      const ids = [];
      for (const [label, hue, s] of [['A', 200, 3], ['B', 30, 2]]) ids.push((await IM.lib.addBlob(await makeVideo(label, hue, s), label + ' clip', 'video', p.eventId, {})).id);
      IM.edit('b', (q) => Pr.append(q, ids.map((id) => Pr.itemFromMedia(IM.lib.get(id)))));
      IM.clearSelection();
      IM.app.player.seek(1.5);
      return IM.app.project.clips.length;
    });
    check(clips === 2, 'two clips in the timeline');

    const key = (keyCode, modifiers) => app.evaluate(({ BrowserWindow }, [k, m]) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m });
      wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m });
    }, [keyCode, modifiers]);
    await key('B', ['control']);
    await page.waitForTimeout(500);
    check(await page.evaluate(() => IM.app.project.clips.length) === 3, 'Ctrl+B splits the clip at the playhead');
    await key('Z', ['control']);
    await page.waitForTimeout(500);
    check(await page.evaluate(() => IM.app.project.clips.length) === 2, 'Ctrl+Z undoes it');

    // interface size
    const zoom = () => app.evaluate(({ BrowserWindow }) => +BrowserWindow.getAllWindows()[0].webContents.getZoomFactor().toFixed(2));
    const z0 = await zoom();
    await key('=', ['control']);
    await page.waitForTimeout(500);
    const z1 = await zoom();
    await key('-', ['control']);
    await page.waitForTimeout(500);
    const z2 = await zoom();
    check(z1 > z0 && z2 === z0, `Ctrl + and Ctrl − change the interface size (${z0} → ${z1} → ${z2})`);

    // a title typed straight into the viewer
    await page.evaluate(() => { IM.app.player.seek(1); IM.run('tab:titles'); IM.contentUI.addTitleAtPlayhead('standard'); });
    await page.waitForTimeout(800);
    await page.keyboard.type('Hello Windows', { delay: 20 });
    await page.waitForTimeout(300);
    const titleText = await page.evaluate(() => { const e = IM.Project.layout(IM.app.project).connected.find((c) => c.item.type === 'title'); return e && e.item.title.text[0]; });
    check(titleText === 'Hello Windows', `typing into a new title works ("${titleText}")`);
    await page.keyboard.press('Escape');

    // share
    const res = await page.evaluate(async () => {
      const mb = await IM.loadMediabunny();
      const seen = [];
      const r = await IM.Exporter.export(IM.app.project, { resolution: 720, quality: 'medium', onProgress: (f, label) => seen.push([f, label]) });
      const forward = seen.every((x, i) => i === 0 || x[0] >= seen[i - 1][0] - 1e-9);
      const input = new mb.Input({ source: new mb.BlobSource(r.blob), formats: mb.ALL_FORMATS });
      const vt = await input.getPrimaryVideoTrack(), at = await input.getPrimaryAudioTrack();
      let frames = 0;
      const sink = new mb.EncodedPacketSink(vt);
      for await (const pk of sink.packets()) if (pk) frames++;
      return {
        ext: r.ext, verified: r.verified, video: vt && vt.codec, audio: at && at.codec, frames, forward, passes: Array.from(new Set(seen.map((x) => x[1]))).join(' > '),
        duration: await input.computeDuration(), movie: IM.Project.layout(IM.app.project).duration,
      };
    });
    console.log('      shared: ' + JSON.stringify(res));
    check(!!res.video && !!res.audio, `the movie has video (${res.video}) and sound (${res.audio})`);
    check(Math.abs(res.duration - res.movie) < 0.05, `it plays for ${res.duration.toFixed(3)} s, as long as the movie (${res.movie.toFixed(3)} s)`);
    check(res.frames === Math.round(res.movie * 30), `${res.frames} frames at 30 fps`);
    check(res.verified !== false, 'the renderer’s own verification passed');
    check(res.forward, `the progress only moved forward (${res.passes})`);
    const bad = errors.filter((e) => !/willReadFrequently|GPU stall|Autofill/.test(e));
    if (bad.length) console.log('page errors:\n  ' + bad.join('\n  '));
    check(!bad.length, 'no page errors');
    console.log('SMOKE TEST PASSED');
  } finally {
    await app.close().catch(() => {});
  }
})().catch((err) => { console.error(err.message || err); process.exit(1); });
