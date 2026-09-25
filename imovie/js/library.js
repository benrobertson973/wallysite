/* iMovie Library: events, media items (import, probe, thumbnails, waveforms), projects persistence */
(function (IM) {
  'use strict';

  // ---------- mediabunny loader (vendored) ----------
  let mbPromise = null;
  IM.loadMediabunny = function () {
    if (window.Mediabunny) return Promise.resolve(window.Mediabunny);
    if (mbPromise) return mbPromise;
    mbPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'vendor/mediabunny.min.js';
      s.onload = () => resolve(window.Mediabunny || null);
      s.onerror = () => { console.warn('mediabunny failed to load'); resolve(null); };
      document.head.appendChild(s);
    });
    return mbPromise;
  };

  // ---------- range helpers (for favorites / rejects) ----------
  function rangeAdd(list, a, b) {
    const out = [];
    let na = a, nb = b;
    for (const [x, y] of list) {
      if (y < na - 1e-6 || x > nb + 1e-6) out.push([x, y]);
      else { na = Math.min(na, x); nb = Math.max(nb, y); }
    }
    out.push([na, nb]);
    out.sort((p, q) => p[0] - q[0]);
    return out;
  }
  function rangeSub(list, a, b) {
    const out = [];
    for (const [x, y] of list) {
      if (y <= a || x >= b) { out.push([x, y]); continue; }
      if (x < a) out.push([x, a]);
      if (y > b) out.push([b, y]);
    }
    return out.filter(([x, y]) => y - x > 0.02);
  }
  IM.rangeAdd = rangeAdd; IM.rangeSub = rangeSub;
  IM.rangeOverlaps = (list, a, b) => list.some(([x, y]) => x < b && y > a);

  const PERSIST_FIELDS = ['id', 'name', 'kind', 'eventId', 'created', 'date', 'size', 'mime', 'duration', 'width', 'height',
    'fps', 'hasAudio', 'favorites', 'rejected', 'builtin', 'hidden', 'error', 'source'];

  class Library extends IM.Emitter {
    constructor() {
      super();
      this.events = [];
      this.media = new Map();
      this.projects = new Map();
      this.settings = {};
      this.thumbQueue = [];
      this.thumbBusy = false;
      this.peakQueue = [];
      this.peakBusy = false;
      this.saveLibrary = IM.debounce(() => this._saveLibrary(), 300);
      this._projSaveTimers = new Map();
    }

    // ---------- loading ----------
    async init() {
      await IM.DB.open();
      const lib = await IM.DB.get('kv', 'library');
      if (lib) {
        this.events = lib.events || [];
        this.settings = lib.settings || {};
      }
      const medias = await IM.DB.all('media');
      for (const { value } of medias) {
        const item = Object.assign({}, value);
        item.favorites = item.favorites || [];
        item.rejected = item.rejected || [];
        this.media.set(item.id, item);
      }
      const projects = await IM.DB.all('projects');
      for (const { value } of projects) {
        if (value && value.id) this.projects.set(value.id, IM.Project.upgrade(value));
      }
      // restore blobs + derived data lazily
      const loads = [];
      for (const item of this.media.values()) {
        if (item.builtin) continue;
        loads.push(this._restore(item));
      }
      await Promise.all(loads);
      if (!this.events.length) this.createEvent(IM.fmtDate(Date.now(), 'event'), true);
    }
    async _restore(item) {
      const blob = await IM.DB.get('blobs', item.id);
      if (!blob) { item.error = 'missing'; item.status = 'error'; return; }
      item.blob = blob;
      item.url = URL.createObjectURL(blob);
      item.status = 'ready';
      if (item.kind === 'image') {
        this._loadImage(item).catch(() => {});
      }
      const th = await IM.DB.get('thumbs', item.id);
      if (th && th.blob) {
        try {
          const bmp = await createImageBitmap(th.blob);
          const c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          c.getContext('2d').drawImage(bmp, 0, 0);
          item.thumbs = { canvas: c, tw: th.tw, th: th.th, cols: th.cols, count: th.count, interval: th.interval, have: new Uint8Array(th.count).fill(1) };
        } catch (e) { /* regenerate */ }
      }
      if (!item.thumbs && item.kind !== 'audio') this.queueThumbs(item);
      const pk = await IM.DB.get('peaks', item.id);
      if (pk && pk.data) item.peaks = { data: new Uint8Array(pk.data), rate: pk.rate };
      else if (item.kind !== 'image' && item.hasAudio !== false) this.queuePeaks(item);
    }
    async _saveLibrary() {
      await IM.DB.put('kv', 'library', { events: this.events, settings: this.settings });
    }
    saveMediaMeta(item) {
      if (item.builtin && !item.persistBuiltin) return;
      const o = {};
      PERSIST_FIELDS.forEach((f) => { if (item[f] !== undefined) o[f] = item[f]; });
      IM.DB.put('media', item.id, o);
    }

    // ---------- events ----------
    createEvent(name, silent) {
      let base = name || 'New Event', n = base, i = 2;
      while (this.events.some((e) => e.name === n)) n = base + ' ' + i++;
      const ev = { id: IM.uid('ev'), name: n, created: Date.now() };
      this.events.push(ev);
      this.saveLibrary();
      if (!silent) this.emit('changed');
      return ev;
    }
    renameEvent(id, name) {
      const ev = this.events.find((e) => e.id === id);
      if (!ev || !name) return;
      ev.name = name;
      this.saveLibrary();
      this.emit('changed');
    }
    async deleteEvent(id) {
      const items = this.mediaInEvent(id);
      for (const it of items) await this.deleteMedia(it.id, true);
      this.events = this.events.filter((e) => e.id !== id);
      if (!this.events.length) this.createEvent(IM.fmtDate(Date.now(), 'event'), true);
      this.saveLibrary();
      this.emit('changed');
    }
    eventById(id) { return this.events.find((e) => e.id === id); }
    mediaInEvent(eventId) {
      const out = [];
      for (const m of this.media.values()) if (m.eventId === eventId && !m.hidden) out.push(m);
      out.sort((a, b) => (a.created - b.created) || (a.date - b.date));
      return out;
    }
    allUserMedia() {
      return Array.from(this.media.values()).filter((m) => !m.hidden && !m.builtin);
    }
    get(id) { return this.media.get(id); }

    // ---------- media import ----------
    async importFiles(files, eventId, opts) {
      opts = opts || {};
      const out = [];
      const list = Array.from(files).filter((f) => IM.mediaTypeOf(f));
      for (const f of list) {
        try {
          const item = await this.addBlob(f, f.name, IM.mediaTypeOf(f), eventId, { date: f.lastModified || Date.now() });
          if (item) out.push(item);
        } catch (e) {
          console.warn('import failed', f.name, e);
          IM.notify('Import Failed', `“${f.name}” could not be imported. The file format may not be supported by this browser.`);
        }
      }
      return out;
    }
    /** Add a Blob as media item. kind: video|audio|image */
    async addBlob(blob, name, kind, eventId, extra) {
      extra = extra || {};
      const item = {
        id: IM.uid('m'), name: IM.baseName(name) || 'Clip', kind, eventId,
        created: Date.now(), date: extra.date || Date.now(), size: blob.size, mime: blob.type,
        favorites: [], rejected: [], status: 'loading', source: extra.source,
      };
      item.blob = blob;
      item.url = URL.createObjectURL(blob);
      await this._probe(item);
      if (item.error) { URL.revokeObjectURL(item.url); throw new Error(item.error); }
      item.status = 'ready';
      this.media.set(item.id, item);
      if (!extra.hidden) {
        IM.DB.put('blobs', item.id, blob);
        this.saveMediaMeta(item);
      } else {
        item.hidden = true;
      }
      if (item.kind !== 'audio') this.queueThumbs(item);
      if (item.kind !== 'image') this.queuePeaks(item);
      this.emit('media-added', item);
      this.emit('changed');
      return item;
    }
    async _probe(item) {
      if (item.kind === 'image') {
        await this._loadImage(item);
        item.duration = 0; // stills
        item.hasAudio = false;
        return;
      }
      const el = document.createElement(item.kind === 'video' ? 'video' : 'audio');
      el.preload = 'metadata';
      el.muted = true;
      el.src = item.url;
      try {
        await IM.once(el, 'loadedmetadata', 15000);
      } catch (e) {
        item.error = 'unsupported';
        return;
      }
      let dur = el.duration;
      if (!isFinite(dur)) {
        // WebM from MediaRecorder: duration Infinity until seeked to end
        try {
          el.currentTime = 1e9;
          await IM.once(el, 'durationchange', 3000);
          dur = el.duration;
          el.currentTime = 0;
        } catch (e) { /* ignore */ }
      }
      if (!isFinite(dur) || dur <= 0) {
        // try mediabunny
        const mb = await IM.loadMediabunny();
        if (mb) {
          try {
            const input = new mb.Input({ source: new mb.BlobSource(item.blob), formats: mb.ALL_FORMATS });
            dur = await input.computeDuration();
          } catch (e) { /* ignore */ }
        }
      }
      if (!isFinite(dur) || dur <= 0) { item.error = 'no duration'; return; }
      item.duration = dur;
      if (item.kind === 'video') {
        item.width = el.videoWidth || 1920;
        item.height = el.videoHeight || 1080;
        if (!el.videoWidth) {
          // may be audio-only in a video container
          item.kind = 'audio';
        }
      }
      item.hasAudio = item.kind === 'audio' ? true : undefined;
      el.removeAttribute('src');
      el.load();
      // detailed probe via mediabunny (audio track presence, frame rate)
      const mb = await IM.loadMediabunny();
      if (mb && item.kind === 'video') {
        try {
          const input = new mb.Input({ source: new mb.BlobSource(item.blob), formats: mb.ALL_FORMATS });
          const at = await input.getPrimaryAudioTrack();
          item.hasAudio = !!at;
          const vt = await input.getPrimaryVideoTrack();
          if (vt) {
            try {
              const stats = await vt.computePacketStats(90);
              if (stats && stats.averagePacketRate) item.fps = Math.round(stats.averagePacketRate * 100) / 100;
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* container unknown: leave undefined */ }
      }
      if (item.hasAudio === undefined) item.hasAudio = true;
    }
    async _loadImage(item) {
      try {
        const bmp = await createImageBitmap(item.blob, { imageOrientation: 'from-image' });
        item.image = bmp;
      } catch (e) {
        // fallback to <img>
        const img = new Image();
        img.src = item.url;
        try { await img.decode(); } catch (err) { item.error = 'unsupported image'; return; }
        item.image = img;
      }
      item.width = item.image.width || item.image.naturalWidth;
      item.height = item.image.height || item.image.naturalHeight;
    }

    // ---------- thumbnails ----------
    queueThumbs(item) {
      if (this.thumbQueue.includes(item)) return;
      this.thumbQueue.push(item);
      this._pumpThumbs();
    }
    async _pumpThumbs() {
      if (this.thumbBusy) return;
      this.thumbBusy = true;
      while (this.thumbQueue.length) {
        const item = this.thumbQueue.shift();
        try {
          if (item.kind === 'image') await this._imageThumbs(item);
          else if (item.kind === 'video') await this._videoThumbs(item);
        } catch (e) { console.warn('thumbs failed', item.name, e); }
      }
      this.thumbBusy = false;
    }
    async _imageThumbs(item) {
      if (!item.image) await this._loadImage(item);
      if (!item.image) return;
      const aspect = item.width / item.height;
      const th = 180, tw = Math.round(th * IM.clamp(aspect, 0.4, 3));
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      c.getContext('2d').drawImage(item.image, 0, 0, tw, th);
      item.thumbs = { canvas: c, tw, th, cols: 1, count: 1, interval: 1e9, have: new Uint8Array([1]) };
      this.emit('thumbs', item);
      this._persistThumbs(item);
    }
    async _videoThumbs(item) {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      v.src = item.url;
      try { await IM.once(v, 'loadeddata', 15000); } catch (e) { return; }
      const aspect = (v.videoWidth / v.videoHeight) || 16 / 9;
      const th = 90, tw = Math.round(th * IM.clamp(aspect, 0.4, 3));
      const interval = Math.max(0.25, item.duration / 200);
      const count = Math.max(1, Math.ceil(item.duration / interval));
      const cols = Math.max(1, Math.floor(4096 / tw));
      const rows = Math.ceil(count / cols);
      const c = document.createElement('canvas');
      c.width = cols * tw; c.height = rows * th;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
      const have = new Uint8Array(count);
      item.thumbs = { canvas: c, tw, th, cols, count, interval, have };
      // coarse to fine ordering
      const order = [];
      const seen = new Uint8Array(count);
      for (let step = 32; step >= 1; step >>= 1) {
        for (let i = 0; i < count; i += step) if (!seen[i]) { seen[i] = 1; order.push(i); }
      }
      let lastEmit = performance.now();
      for (const i of order) {
        if (!this.media.has(item.id) && !item.hidden) return;
        const t = Math.min(item.duration - 0.04, i * interval + Math.min(0.05, interval / 4));
        await IM.seekMedia(v, Math.max(0, t), 4000);
        try { ctx.drawImage(v, (i % cols) * tw, Math.floor(i / cols) * th, tw, th); } catch (e) { /* ignore */ }
        have[i] = 1;
        if (performance.now() - lastEmit > 120) { lastEmit = performance.now(); this.emit('thumbs', item); }
      }
      v.removeAttribute('src'); v.load();
      this.emit('thumbs', item);
      this._persistThumbs(item);
    }
    _persistThumbs(item) {
      if (item.hidden || (item.builtin && !item.persistBuiltin)) return;
      const t = item.thumbs;
      t.canvas.toBlob((blob) => {
        if (blob) IM.DB.put('thumbs', item.id, { blob, tw: t.tw, th: t.th, cols: t.cols, count: t.count, interval: t.interval });
      }, 'image/jpeg', 0.82);
    }
    /** Returns drawing info for the thumbnail nearest to time t, or null. */
    thumbAt(item, t) {
      const T = item && item.thumbs;
      if (!T) return null;
      let i = IM.clamp(Math.floor(t / T.interval), 0, T.count - 1);
      if (!T.have[i]) {
        let found = -1;
        for (let d = 1; d < T.count; d++) {
          if (i - d >= 0 && T.have[i - d]) { found = i - d; break; }
          if (i + d < T.count && T.have[i + d]) { found = i + d; break; }
        }
        if (found < 0) return null;
        i = found;
      }
      return { img: T.canvas, sx: (i % T.cols) * T.tw, sy: Math.floor(i / T.cols) * T.th, sw: T.tw, sh: T.th };
    }

    // ---------- audio peaks ----------
    queuePeaks(item) {
      if (this.peakQueue.includes(item)) return;
      this.peakQueue.push(item);
      this._pumpPeaks();
    }
    async _pumpPeaks() {
      if (this.peakBusy) return;
      this.peakBusy = true;
      while (this.peakQueue.length) {
        const item = this.peakQueue.shift();
        try { await this._genPeaks(item); } catch (e) { console.warn('peaks failed', item.name, e); }
      }
      this.peakBusy = false;
    }
    async _genPeaks(item) {
      if (item.audioBuffer) { this._peaksFromBuffer(item, item.audioBuffer); return; }
      const RATE = 100;
      // Prefer streaming decode via mediabunny for big files
      if (item.size > 150 * 1024 * 1024) {
        const ok = await this._peaksStreaming(item, RATE);
        if (ok) return;
      }
      let ab;
      try {
        const buf = await item.blob.arrayBuffer();
        ab = await decodeAudio(buf);
      } catch (e) {
        const ok = await this._peaksStreaming(item, RATE);
        if (!ok) { item.hasAudio = false; this.saveMediaMeta(item); this.emit('peaks', item); }
        return;
      }
      this._peaksFromBuffer(item, ab);
    }
    _peaksFromBuffer(item, ab) {
      const RATE = 100;
      const n = Math.max(1, Math.ceil(ab.duration * RATE));
      const data = new Uint8Array(n);
      const chans = [];
      for (let c = 0; c < ab.numberOfChannels; c++) chans.push(ab.getChannelData(c));
      const per = ab.sampleRate / RATE;
      let maxAll = 0;
      for (let i = 0; i < n; i++) {
        const s0 = Math.floor(i * per), s1 = Math.min(ab.length, Math.floor((i + 1) * per));
        let m = 0;
        for (const ch of chans) {
          for (let s = s0; s < s1; s += 2) { const v = ch[s] < 0 ? -ch[s] : ch[s]; if (v > m) m = v; }
        }
        const q = Math.min(255, Math.round(m * 255));
        data[i] = q;
        if (q > maxAll) maxAll = q;
      }
      item.peaks = { data, rate: RATE };
      if (item.kind === 'video') item.hasAudio = maxAll > 1;
      this.saveMediaMeta(item);
      if (!item.hidden && !(item.builtin && !item.persistBuiltin)) IM.DB.put('peaks', item.id, { data: data.buffer, rate: RATE });
      this.emit('peaks', item);
    }
    async _peaksStreaming(item, RATE) {
      const mb = await IM.loadMediabunny();
      if (!mb) return false;
      try {
        const input = new mb.Input({ source: new mb.BlobSource(item.blob), formats: mb.ALL_FORMATS });
        const at = await input.getPrimaryAudioTrack();
        if (!at) { item.hasAudio = false; this.saveMediaMeta(item); this.emit('peaks', item); return true; }
        if (!(await at.canDecode())) return false;
        const n = Math.max(1, Math.ceil(item.duration * RATE));
        const data = new Uint8Array(n);
        const sink = new mb.AudioBufferSink(at);
        for await (const { buffer, timestamp } of sink.buffers()) {
          const chans = [];
          for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
          const sr = buffer.sampleRate;
          for (let s = 0; s < buffer.length; s += 4) {
            const idx = Math.floor((timestamp + s / sr) * RATE);
            if (idx < 0 || idx >= n) continue;
            let m = 0;
            for (const ch of chans) { const v = Math.abs(ch[s]); if (v > m) m = v; }
            const q = Math.min(255, Math.round(m * 255));
            if (q > data[idx]) data[idx] = q;
          }
        }
        item.peaks = { data, rate: RATE };
        item.hasAudio = data.some((v) => v > 1);
        this.saveMediaMeta(item);
        IM.DB.put('peaks', item.id, { data: data.buffer, rate: RATE });
        this.emit('peaks', item);
        return true;
      } catch (e) {
        console.warn('streaming peaks failed', e);
        return false;
      }
    }

    // ---------- marking ----------
    markRange(item, a, b, kind) {
      if (!item) return;
      if (kind === 'favorite') {
        item.favorites = rangeAdd(item.favorites, a, b);
        item.rejected = rangeSub(item.rejected, a, b);
      } else if (kind === 'reject') {
        item.rejected = rangeAdd(item.rejected, a, b);
        item.favorites = rangeSub(item.favorites, a, b);
      } else {
        item.rejected = rangeSub(item.rejected, a, b);
        item.favorites = rangeSub(item.favorites, a, b);
      }
      this.saveMediaMeta(item);
      this.emit('changed');
    }

    // ---------- deleting ----------
    async deleteMedia(id, silent) {
      const item = this.media.get(id);
      if (!item) return;
      this.media.delete(id);
      if (item.url) URL.revokeObjectURL(item.url);
      await Promise.all([IM.DB.del('media', id), IM.DB.del('blobs', id), IM.DB.del('thumbs', id), IM.DB.del('peaks', id)]);
      if (!silent) this.emit('changed');
    }
    usageCount(id) {
      let n = 0;
      for (const p of this.projects.values()) {
        IM.Project.forEachItem(p, (it) => { if (it.mediaId === id) n++; });
      }
      return n;
    }
    moveMedia(ids, eventId) {
      for (const id of ids) {
        const m = this.media.get(id);
        if (m && !m.builtin) { m.eventId = eventId; this.saveMediaMeta(m); }
      }
      this.emit('changed');
    }

    // ---------- projects ----------
    addProject(p) {
      this.projects.set(p.id, p);
      this.saveProjectNow(p);
      this.emit('projects-changed');
    }
    saveProject(p) {
      if (!p) return;
      p.modified = Date.now();
      clearTimeout(this._projSaveTimers.get(p.id));
      this._projSaveTimers.set(p.id, setTimeout(() => this.saveProjectNow(p), 400));
    }
    saveProjectNow(p) {
      clearTimeout(this._projSaveTimers.get(p.id));
      const copy = Object.assign({}, p);
      delete copy._layout;
      return IM.DB.put('projects', p.id, JSON.parse(JSON.stringify(copy)));
    }
    async deleteProject(id) {
      this.projects.delete(id);
      await IM.DB.del('projects', id);
      this.emit('projects-changed');
    }
    projectList() {
      return Array.from(this.projects.values()).sort((a, b) => (b.modified || 0) - (a.modified || 0));
    }
    uniqueProjectName(base) {
      const names = new Set(Array.from(this.projects.values()).map((p) => p.name));
      if (!names.has(base)) return base;
      let i = 1;
      while (names.has(base + ' ' + i)) i++;
      return base + ' ' + i;
    }

    // ---------- audio buffers (for export / effects) ----------
    async getAudioBuffer(item) {
      if (item.audioBuffer) return item.audioBuffer;
      if (item._abPromise) return item._abPromise;
      item._abPromise = (async () => {
        if (item.builtin && !item.blob) await IM.ensureBuiltin(item);
        if (item.audioBuffer) return item.audioBuffer;
        const buf = await item.blob.arrayBuffer();
        try {
          const ab = await decodeAudio(buf);
          return ab;
        } catch (e) {
          // streaming fallback
          const mb = await IM.loadMediabunny();
          if (!mb) throw e;
          const input = new mb.Input({ source: new mb.BlobSource(item.blob), formats: mb.ALL_FORMATS });
          const at = await input.getPrimaryAudioTrack();
          if (!at) return null;
          const sink = new mb.AudioBufferSink(at);
          const parts = [];
          let sr = 48000, ch = 2;
          for await (const { buffer, timestamp } of sink.buffers()) { parts.push({ buffer, timestamp }); sr = buffer.sampleRate; ch = Math.max(1, Math.min(2, buffer.numberOfChannels)); }
          const len = Math.ceil(item.duration * sr);
          const out = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: ch, sampleRate: sr });
          for (const { buffer, timestamp } of parts) {
            const off = Math.round(timestamp * sr);
            for (let c = 0; c < ch; c++) {
              const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
              const dst = out.getChannelData(c);
              for (let i = 0; i < src.length && off + i < len; i++) if (off + i >= 0) dst[off + i] = src[i];
            }
          }
          return out;
        }
      })();
      try { return await item._abPromise; } finally { item._abPromise = null; }
    }
  }

  function decodeAudio(arrayBuffer) {
    const ctx = IM.audioCtx();
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }
  IM.decodeAudio = decodeAudio;

  IM.Library = Library;
  IM.lib = new Library();
})(window.IM = window.IM || {});
