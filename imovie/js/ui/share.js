/* Share: popover menu, File / Email / YouTube & Facebook / Image sheets, progress, notifications */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;

  const RES_LABEL = { 540: '540p', 720: '720p', 1080: '1080p', 2160: '4K' };
  const QUALITY = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'best', label: 'Best' }];
  const BPP = { low: 0.045, medium: 0.08, high: 0.14, best: 0.26 };
  const DIMS = { 540: [960, 540], 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] };

  function estimateSize(res, quality, dur, fps, audioOnly) {
    const [W, H] = DIMS[res];
    const v = audioOnly ? 0 : W * H * fps * BPP[quality];
    return (v + 192000) * dur / 8;
  }
  function thumbCanvas(p) {
    const c = h('canvas', { width: 380, height: 214 });
    try {
      const t = Pr.posterFrameTime(p);
      IM.renderThumb(IM.Compose.frame(p, t, IM.stillProvider, { noStabRequest: true }), c);
    } catch (e) { /* ignore */ }
    return c;
  }
  const PREF_KEY = { file: 'shareFile', email: 'shareEmail', youtube: 'shareYouTube' };
  /** 'About 3 minutes left' (or a short form for the toolbar: '3 min left'). */
  function etaText(secs, short) {
    if (secs == null || !isFinite(secs)) return '';
    if (secs < 50) return short ? '<1 min left' : 'Less than a minute left';
    const min = Math.max(1, Math.round(secs / 60));
    if (short) return min < 90 ? min + ' min left' : Math.floor(min / 60) + ' hr ' + (min % 60) + ' min left';
    if (min >= 90) return `About ${Math.floor(min / 60)} hr ${min % 60} min left`;
    return 'About ' + min + (min === 1 ? ' minute left' : ' minutes left');
  }
  function safeName(n) { return String(n || 'My Movie').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'My Movie'; }

  const Share = {
    job: null,
    menu(anchor) {
      if (!app.project) return;
      const has = app.project.clips.length > 0;
      const opt = (cls, icon, label, kind) => {
        const b = h('button.share-opt.' + cls, IM.icon(icon, 26), label);
        if (!has) b.disabled = true;
        b.addEventListener('click', () => { IM.closePopovers(); this.open(kind); });
        return b;
      };
      IM.popover(anchor, h('div.share-menu',
        opt('email', 'email', 'Email', 'email'),
        opt('yt', 'globe', 'YouTube & Facebook', 'youtube'),
        opt('image', 'photo', 'Image', 'image'),
        opt('file', 'movie-file', 'File', 'file')), { side: 'bottom', align: 'right' });
    },
    open(kind) {
      const p = app.project;
      if (!p || !p.clips.length) return;
      if (this.job) { IM.alert({ title: 'A share is already in progress', message: 'Wait for the current share to finish, or cancel it first.' }); return; }
      if (kind === 'image') { this.shareImage(); return; }
      const L = Pr.layout(p);
      // each kind of share remembers its own settings (an Email share mustn't turn the next File share into 540p)
      const prefKey = PREF_KEY[kind] || 'shareFile';
      const defaults = kind === 'email' ? { resolution: 540, quality: 'medium' } : { resolution: 1080, quality: 'high' };
      const prefs = Object.assign({ format: 'av', compress: 'better' }, defaults, IM.prefs[prefKey] || {});
      const title = h('input.text-field', { type: 'text', value: p.name });
      const desc = h('input.text-field', { type: 'text', placeholder: 'Description' });
      const tags = h('input.text-field', { type: 'text', placeholder: 'Tags' });
      [title, desc, tags].forEach((f) => f.addEventListener('keydown', (e) => e.stopPropagation()));
      const info = h('div.share-info');
      const state = Object.assign({}, prefs);
      const upd = () => {
        const [W, H] = DIMS[state.resolution];
        const sz = estimateSize(state.resolution, state.quality, L.duration, L.fps, state.format === 'audio');
        info.textContent = (state.format === 'audio' ? 'Audio only' : `${W} × ${H}, ${L.fps} fps`) + ', ' + IM.fmtTime(L.duration) + ', ~' + IM.fmtBytes(sz);
      };
      const fmt = IM.popupButton([{ value: 'av', label: 'Video and Audio' }, { value: 'audio', label: 'Audio Only' }], state.format, (v) => { state.format = v; upd(); });
      const resOpts = (kind === 'email' ? [540, 720] : [540, 720, 1080, 2160]).map((r) => ({ value: r, label: RES_LABEL[r] + (r >= 720 ? ' ' + Math.round(L.fps) : '') }));
      const res = IM.popupButton(resOpts, state.resolution, (v) => { state.resolution = v; upd(); });
      const qual = IM.popupButton(QUALITY, state.quality, (v) => { state.quality = v; upd(); });
      const comp = IM.popupButton([{ value: 'faster', label: 'Faster' }, { value: 'better', label: 'Better Quality' }], state.compress, (v) => { state.compress = v; });
      upd();
      const heading = kind === 'email' ? 'Email' : kind === 'youtube' ? 'YouTube & Facebook' : 'File';
      let sheet;
      const next = h('button.btn.primary', {
        on: {
          click: async () => {
            IM.prefs[prefKey] = { resolution: state.resolution, quality: state.quality, format: state.format, compress: state.compress };
            IM.savePrefs();
            sheet.close();
            await this.start(kind, Object.assign({}, state, { title: title.value.trim() || p.name }));
          },
        },
      }, kind === 'email' ? 'Share' : 'Next…');
      const form = h('div.share-form',
        h('label', 'Title:'), title,
        h('label', 'Description:'), desc,
        h('label', 'Tags:'), tags,
        kind === 'file' ? h('label', 'Format:') : null, kind === 'file' ? fmt : null,
        h('label', 'Resolution:'), res,
        h('label', 'Quality:'), qual,
        kind === 'file' ? h('label', 'Compress:') : null, kind === 'file' ? comp : null,
        info);
      const body = h('div.share-sheet',
        h('div.share-body',
          h('div.share-thumb', thumbCanvas(p), h('div.sname', p.name), h('div.smeta', IM.fmtTime(L.duration)), h('div.smeta', heading)),
          form),
        h('div.sheet-footer', h('button.btn', { on: { click: () => sheet.close() } }, 'Cancel'), next));
      sheet = IM.sheet(body, { width: 600 });
    },
    async start(kind, o) {
      const p = app.project;
      let handle = null;
      const ext = o.format === 'audio' ? 'm4a' : 'mp4';
      const suggested = safeName(o.title) + '.' + ext;
      let name = suggested;
      if (kind === 'file') {
        if (window.showSaveFilePicker) {
          try {
            handle = await window.showSaveFilePicker({
              suggestedName: suggested,
              types: o.format === 'audio'
                ? [{ description: 'Audio', accept: { 'audio/mp4': ['.m4a'] } }]
                : [{ description: 'Movie', accept: { 'video/mp4': ['.mp4', '.mov'] } }, { description: 'WebM Movie', accept: { 'video/webm': ['.webm'] } }],
            });
            name = handle.name;
          } catch (e) { if (e && e.name === 'AbortError') return; handle = null; }
        } else {
          const n = await IM.prompt({ title: 'Save As', message: 'The movie will be saved to your Downloads folder.', value: suggested, ok: 'Save' });
          if (!n) return;
          name = n;
        }
      }
      // exporting to a picked file handle requires the container to match what the encoder can produce
      this.job = { name, progress: 0, label: 'Preparing…', kind, started: performance.now(), eta: null };
      IM.bus.emit('export-progress', 0.001, this.job);
      try {
        const res = await IM.Exporter.export(p, {
          resolution: o.resolution, quality: o.quality, audioOnly: o.format === 'audio',
          fileHandle: handle && /\.(mp4|mov)$/i.test(name) && o.format !== 'audio' ? handle : null,
          onProgress: (f, label) => {
            if (!this.job) return;
            this.job.progress = f; this.job.label = label;
            this.job.eta = this.estimate(f, label);
            IM.bus.emit('export-progress', Math.max(0.001, f), this.job);
            this.updateProgressPop();
          },
        });
        const secs = (performance.now() - this.job.started) / 1000;
        this.job = null;
        IM.bus.emit('export-progress', null);
        let outName = name;
        if (!/\.[a-z0-9]+$/i.test(outName)) outName += '.' + res.ext;
        if (res.ext && !outName.toLowerCase().endsWith('.' + res.ext)) outName = outName.replace(/\.[a-z0-9]+$/i, '') + '.' + res.ext;
        if (handle && !res.usedHandle) {
          if (handle.name.toLowerCase().endsWith('.' + res.ext)) { const w = await handle.createWritable(); await w.write(res.blob); await w.close(); }
          else { try { await handle.remove(); } catch (e) { /* ignore */ } IM.download(res.blob, outName); }
        } else if (!handle) {
          if (kind === 'email' && navigator.canShare && navigator.canShare({ files: [new File([res.blob], outName, { type: res.mime })] })) {
            try { await navigator.share({ files: [new File([res.blob], outName, { type: res.mime })], title: o.title }); } catch (e) { IM.download(res.blob, outName); }
          } else IM.download(res.blob, outName);
        }
        const st = res.stats || {};
        let detail = `“${outName}” was shared in ${secs < 60 ? secs.toFixed(1) + ' s' : IM.fmtTime(secs)}.`;
        if (st.frames && st.reused) detail += ` ${Math.round(st.reused / st.frames * 100)}% came from background rendering.`;
        if (res.verified) detail += ' Verified frame-accurate.';
        this.lastBlob = res.blob; this.lastName = outName;
        IM.notify('Share Successful', detail, {
          duration: 8000,
          action: kind === 'youtube'
            ? { label: 'Upload', run: () => window.open('https://www.youtube.com/upload', '_blank', 'noopener') }
            : { label: 'Show', run: () => { const url = URL.createObjectURL(res.blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } },
        });
      } catch (e) {
        this.job = null;
        IM.bus.emit('export-progress', null);
        // remove the empty file the save panel created (an existing file keeps its previous contents)
        if (handle) { try { if ((await handle.getFile()).size === 0 && handle.remove) await handle.remove(); } catch (err) { /* */ } }
        if (e && e.name === 'AbortRender') { IM.notify('Share Cancelled', `“${name}” wasn’t shared.`); return; }
        console.error(e);
        IM.alert({ title: 'Share Failed', message: (e && e.message) || 'An unknown error occurred while rendering the movie.' });
      }
    },
    progressPopover(anchor) {
      if (!this.job) return;
      this.bar = h('div.prog-bar', h('i'));
      this.pLabel = h('div', { style: { fontSize: '11px', color: '#aaa' } });
      const content = h('div', { style: { width: '300px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('div', { style: { flex: 1, fontWeight: 600 } }, `Sharing “${this.job.name}”`),
          h('button.btn.small', { on: { click: () => { IM.Exporter.cancel(); IM.closePopovers(); } } }, 'Cancel')),
        this.bar, this.pLabel);
      IM.popover(anchor, content, { side: 'bottom', align: 'right' });
      this.updateProgressPop();
    },
    updateProgressPop() {
      if (!this.bar || !this.job || !document.body.contains(this.bar)) return;
      this.bar.firstChild.style.width = Math.round(this.job.progress * 100) + '%';
      const eta = etaText(this.job.eta);
      this.pLabel.textContent = this.job.label + ' ' + Math.round(this.job.progress * 100) + '%' + (eta ? ' · ' + eta : '');
    },
    /**
     * Seconds left, from how fast the bar has moved since this pass began (a second pass — fixing sections, or the
     * software encoder — starts its own clock). Null until there's enough to go on.
     */
    estimate(f, label) {
      const j = this.job, now = performance.now();
      const pass = /again|Fixing|software/.test(label) ? label : 'first';
      if (!j.clock || j.clock.pass !== pass || f < j.clock.last - 1e-6) j.clock = { pass, t0: now, f0: f, last: f, eta: null };
      const c = j.clock;
      c.last = f;
      const done = f - c.f0, secs = (now - c.t0) / 1000;
      if (done < 0.02 || secs < 3) return c.eta;
      const left = secs * (1 - f) / done;
      // smooth the jumps (sections rendered in the background finish instantly)
      c.eta = c.eta == null ? left : c.eta * 0.75 + left * 0.25;
      return c.eta;
    },
    etaText,
    async shareImage() {
      const p = app.project;
      const t = app.player.t;
      try {
        const blob = await IM.Exporter.exportImage(p, t, { resolution: 1080, type: 'image/jpeg' });
        const name = safeName(p.name) + ' ' + IM.fmtTime(t).replace(/:/g, '.') + '.jpg';
        if (window.showSaveFilePicker) {
          try {
            const hdl = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg'] } }] });
            const w = await hdl.createWritable(); await w.write(blob); await w.close();
          } catch (e) { if (e && e.name === 'AbortError') return; IM.download(blob, name); }
        } else IM.download(blob, name);
        IM.notify('Share Successful', `“${name}” was saved.`);
      } catch (e) {
        IM.alert({ title: 'Share Failed', message: e.message || String(e) });
      }
    },
  };
  IM.share = Share;
})(window.IM = window.IM || {});
