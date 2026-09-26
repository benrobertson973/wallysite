/* Playback engine: timeline/source playback, skimming, element pools, A/V sync */
(function (IM) {
  'use strict';
  const clamp = IM.clamp;
  let elCounter = 0;

  function setPitch(el, preserve) {
    try {
      el.preservesPitch = preserve;
      el.mozPreservesPitch = preserve;
      el.webkitPreservesPitch = preserve;
    } catch (e) { /* ignore */ }
  }

  // ---------- media element pool ----------
  class MediaPool {
    constructor(kind, max, audioEngine, onFrame) {
      this.kind = kind; this.max = max; this.audio = audioEngine; this.onFrame = onFrame;
      this.recs = []; this.byKey = new Map();
    }
    _create() {
      const el = document.createElement(this.kind);
      el.preload = 'auto';
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el._id = ++elCounter;
      el._stamp = 0;
      el._pendingSeek = null;
      el.addEventListener('seeked', () => {
        el._stamp++;
        el._hadFrame = true;
        if (el._pendingSeek != null) {
          const t = el._pendingSeek;
          el._pendingSeek = null;
          if (Math.abs(el.currentTime - t) > 0.004) { try { el.currentTime = t; } catch (e) { /* */ } }
        }
        this.onFrame && this.onFrame(el);
      });
      el.addEventListener('loadeddata', () => { el._stamp++; el._hadFrame = true; this.onFrame && this.onFrame(el); });
      if (this.kind === 'video' && el.requestVideoFrameCallback) {
        // timestamp of the frame actually on screen (used to look up per-frame stabilization)
        const onVF = (now, meta) => { el._frameTs = meta.mediaTime; el.requestVideoFrameCallback(onVF); };
        el.requestVideoFrameCallback(onVF);
      }
      const rec = { el, mediaId: null, key: null, lastUsed: 0 };
      this.recs.push(rec);
      if (this.audio) this.audio.attach(el);
      return rec;
    }
    acquire(key, m) {
      let rec = this.byKey.get(key);
      if (rec && rec.mediaId === m.id) { rec.lastUsed = performance.now(); return rec.el; }
      if (rec) this.release(key);
      rec = this.recs.find((r) => !r.key && r.mediaId === m.id);
      if (!rec) rec = this.recs.length < this.max ? this._create() : null;
      if (!rec) {
        const free = this.recs.filter((r) => !r.key).sort((a, b) => a.lastUsed - b.lastUsed);
        rec = free[0] || this.recs.slice().sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (rec.key) this.release(rec.key);
      }
      if (rec.mediaId !== m.id) {
        rec.el.pause();
        rec.el.src = m.url || '';
        rec.el._stamp++;
        rec.el._frameTs = null;
        rec.el._hadFrame = false; // (a frame of this file hasn't been decoded yet)
        rec.mediaId = m.id;
        rec.el._pendingSeek = null;
      }
      rec.key = key;
      rec.lastUsed = performance.now();
      this.byKey.set(key, rec);
      return rec.el;
    }
    has(key) { return this.byKey.has(key); }
    get(key) { const r = this.byKey.get(key); return r ? r.el : null; }
    release(key) {
      const rec = this.byKey.get(key);
      if (!rec) return;
      this.byKey.delete(key);
      rec.key = null;
      if (!rec.el.paused) rec.el.pause();
      if (this.audio) this.audio.setGain(rec.el, 0, true);
    }
    releaseExcept(keep) {
      for (const k of Array.from(this.byKey.keys())) if (!keep.has(k)) this.release(k);
    }
    pauseAll() { for (const r of this.recs) if (!r.el.paused) r.el.pause(); }
    forgetMedia(mediaId) {
      for (const r of this.recs) if (r.mediaId === mediaId) { if (r.key) this.release(r.key); r.mediaId = null; r.el.removeAttribute('src'); r.el.load(); }
    }
  }

  /** A video element has a picture to show: decoded now, or its last frame while it seeks to a new position. */
  function frameReady(el) { return !!el.videoWidth && (el.readyState >= 2 || !!el._hadFrame); }

  function seekEl(el, t) {
    if (!isFinite(t)) return;
    if (el.readyState === 0) { el._pendingSeek = t; el.addEventListener('loadedmetadata', () => { if (el._pendingSeek != null) { const x = el._pendingSeek; el._pendingSeek = null; try { el.currentTime = x; } catch (e) { /* */ } } }, { once: true }); return; }
    if (el.seeking) { el._pendingSeek = t; return; }
    if (Math.abs(el.currentTime - t) < 0.004) return;
    try { el.currentTime = t; } catch (e) { /* */ }
  }

  // ======================================================================
  class Player extends IM.Emitter {
    constructor() {
      super();
      this.audio = new IM.AudioEngine();
      const onFrame = () => this.invalidate();
      this.vpool = new MediaPool('video', 12, this.audio, onFrame);
      this.apool = new MediaPool('audio', 12, this.audio, onFrame);
      this.renderer = null;
      this.project = null;
      this.t = 0;
      this.playing = false;
      this.rate = 1;
      this.skimT = null;
      this.source = null;   // {media, t}
      this.sourcePlay = null; // {media, from, to}
      this.preview = null;
      this.loop = false;
      this.range = null;
      this.skimming = true;
      this.audioSkimming = false;
      this._dirty = true;
      this._raf = 0;
      this._pendingSince = 0;
      this.provider = {
        video: (it, srcTime, e, m) => this._videoSource(it, srcTime, m),
        image: (it, m) => (m.image ? { src: m.image, key: 'img:' + m.id, w: m.width, h: m.height, stamp: 1 } : null),
      };
      this._loop = this._loop.bind(this);
      IM.bus.on('stab-ready', () => this.invalidate());
      IM.bus.on('key-ready', () => this.invalidate());
    }
    setRenderer(r) { this.renderer = r; this.invalidate(); }
    setProject(p) {
      this.stop();
      this.project = p;
      this.t = p ? clamp(p.playhead || 0, 0, IM.Project.duration(p)) : 0;
      this.skimT = null;
      this.vpool.releaseExcept(new Set());
      this.apool.releaseExcept(new Set());
      this.invalidate();
      this.emit('time', this.t);
    }
    get duration() { return this.project ? IM.Project.duration(this.project) : 0; }
    /** Time currently displayed in the viewer. */
    get displayTime() { return this.skimT != null && !this.playing ? this.skimT : this.t; }

    invalidate() {
      this._dirty = true;
      if (!this._raf) this._raf = requestAnimationFrame(this._loop);
    }

    // ---------- transport ----------
    seek(t, opts) {
      opts = opts || {};
      const d = this.duration;
      this.t = clamp(this.project && !opts.keepPlaying ? IM.Project.snap(this.project, t) : t, 0, d);
      if (this.playing && !opts.keepPlaying) {
        this._t0 = this.t; this._p0 = performance.now();
        this._resyncAll = true;
      }
      if (this.project) this.project.playhead = this.t;
      this.emit('time', this.t);
      this.invalidate();
    }
    setSkim(t) {
      if (!this.skimming) return;
      const v = t == null ? null : clamp(this.project ? IM.Project.snap(this.project, t) : t, 0, this.duration);
      if (v === this.skimT) return;
      this.skimT = v;
      this.emit('skim', v);
      this.invalidate();
      if (this.audioSkimming && v != null && !this.playing) this._audioSkimBlip(v);
    }
    setSource(media, t) {
      if (!media) { if (this.source && !this.sourcePlay) { this.source = null; this.invalidate(); } return; }
      this.source = { media, t: clamp(t, 0, media.duration || 0) };
      this.invalidate();
    }
    clearSource() { if (this.sourcePlay) return; this.source = null; this.invalidate(); }
    setPreview(pv) {
      // the viewer re-applies its preview after every render: only a real change needs a new frame
      if (JSON.stringify(pv || null) === JSON.stringify(this.preview || null)) return;
      this.preview = pv;
      this.invalidate();
    }

    play(opts) {
      opts = opts || {};
      if (!this.project) return;
      IM.resumeAudio();
      this.audio.init();
      this.stopSource();
      const d = this.duration;
      if (d <= 0) return;
      if (opts.from != null) this.t = clamp(opts.from, 0, d);
      else if (this.skimT != null && opts.fromSkimmer) this.t = this.skimT;
      if (this.t >= d - 0.02 && !opts.range) this.t = 0;
      this.range = opts.range || null;
      if (this.range) this.t = this.range[0];
      this.rate = opts.rate || 1;
      this.playing = true;
      this.skimT = null;
      this._t0 = this.t; this._p0 = performance.now();
      this._resyncAll = true;
      this.emit('play', true);
      this.invalidate();
    }
    pause() {
      if (this.sourcePlay) { this.stopSource(); return; }
      if (!this.playing) return;
      this.playing = false;
      this.rate = 1;
      this.range = null;
      this.vpool.pauseAll(); this.apool.pauseAll();
      for (const r of this.vpool.recs.concat(this.apool.recs)) this.audio.setGain(r.el, 0);
      this._stopVoices();
      if (this.project) { this.project.playhead = this.t; }
      this.emit('play', false);
      this.emit('time', this.t);
      this.invalidate();
    }
    stop() { this.pause(); }
    toggle(opts) { if (this.playing || this.sourcePlay) this.pause(); else this.play(opts); }
    isPlaying() { return this.playing || !!this.sourcePlay; }
    shuttle(dir) {
      if (dir === 0) { this.pause(); return; }
      if (!this.playing) { this.play({ rate: dir, fromSkimmer: true }); return; }
      let r = this.rate;
      if (dir > 0) r = r > 0 ? Math.min(r * 2, 8) : 1;
      else r = r < 0 ? Math.max(r * 2, -8) : -1;
      this._t0 = this.t; this._p0 = performance.now();
      this.rate = r;
      this._resyncAll = true;
      this.emit('rate', r);
    }
    step(frames) {
      this.pause();
      const fps = (this.project && this.project.fps) || 30;
      this.seek(Math.round((this.t + frames / fps) * fps) / fps);
    }

    // ---------- browser (source) playback ----------
    playSource(media, from, to) {
      IM.resumeAudio();
      this.audio.init();
      if (this.playing) this.pause();
      this.stopSource();
      if (!media || media.kind === 'image') return;
      const end = to != null ? to : media.duration;
      let start = from != null ? from : 0;
      if (start >= end - 0.05) start = 0;
      this.sourcePlay = { media, from: start, to: end, t0: start, p0: performance.now() };
      this.source = { media, t: start };
      const pool = media.kind === 'audio' ? this.apool : this.vpool;
      const el = pool.acquire('source', media);
      el.playbackRate = 1;
      setPitch(el, true);
      this.audio.configure(el, null);
      seekEl(el, start);
      this.audio.setGain(el, 1, true);
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      this.emit('play', true);
      this.invalidate();
    }
    stopSource() {
      if (!this.sourcePlay) return;
      const pool = this.sourcePlay.media.kind === 'audio' ? this.apool : this.vpool;
      pool.release('source');
      this.sourcePlay = null;
      this.emit('play', false);
      this.emit('source-stopped');
      this.invalidate();
    }

    // ---------- main loop ----------
    _loop() {
      this._raf = 0;
      const now = performance.now();
      let keep = false;
      if (this.sourcePlay) {
        keep = true;
        const sp = this.sourcePlay;
        const pool = sp.media.kind === 'audio' ? this.apool : this.vpool;
        const el = pool.get('source');
        if (el) {
          const t = el.currentTime;
          this.source = { media: sp.media, t };
          this.emit('source-time', sp.media, t);
          if (t >= sp.to - 0.03 || el.ended) {
            this.stopSource();
            keep = false;
          }
        }
        this._dirty = true;
      } else if (this.playing && this.project) {
        keep = true;
        const d = this.duration;
        let t = this._t0 + ((now - this._p0) / 1000) * this.rate;
        // use the main video element as master clock when playing at normal speed
        if (this.rate === 1 && !this._resyncAll) {
          const mt = this._masterTime();
          if (mt != null && Math.abs(mt - t) < 0.25) { t = mt; this._t0 = mt; this._p0 = now; }
        }
        const end = this.range ? this.range[1] : d;
        const start = this.range ? this.range[0] : 0;
        if (t >= end || t < 0) {
          if (this.loop && this.rate > 0) { t = start; this._t0 = t; this._p0 = now; this._resyncAll = true; }
          else {
            this.t = clamp(t, 0, d);
            if (this.range) this.t = end;
            this.pause();
            this.seek(this.t);
            keep = false;
          }
        }
        if (this.playing) {
          this.t = t;
          if (this.project) this.project.playhead = t;
          this.emit('time', t);
          this._syncTimeline(t, true);
          this._resyncAll = false;
          this._dirty = true;
        }
      } else if (this.project) {
        this._syncTimeline(this.displayTime, false);
      }
      if (this._dirty) {
        this._dirty = false;
        const rendered = this.renderFrame();
        if (!rendered) { keep = true; this._dirty = true; }
      }
      if (this.metersOn) { this.emit('levels', this.audio.levels()); if (this.playing || this.sourcePlay) keep = true; }
      if (keep) this._raf = requestAnimationFrame(this._loop);
    }
    _masterTime() {
      const p = this.project;
      if (!p) return null;
      const e = IM.Project.primaryAt(p, this.t);
      if (!e || e.item.type !== 'video' || e.item.reverse) return null;
      const el = this.vpool.get(e.item.id);
      if (!el || el.paused || el.seeking || el.readyState < 3) return null;
      const sp = e.item.speed || 1;
      return e.start + (el.currentTime - e.item.srcIn) / sp;
    }

    /** Assign/sync media elements for everything active at time t. */
    _syncTimeline(t, playing) {
      const p = this.project;
      if (!p) return;
      const Pr = IM.Project;
      const L = Pr.layout(p);
      const keepV = new Set(), keepA = new Set();
      const fwd = playing && this.rate > 0;
      const rateAbs = Math.abs(this.rate);
      const mutedFast = rateAbs > 2 || this.rate < 0;
      const liveVoices = new Set();
      const handle = (e, visual) => {
        const it = e.item;
        const m = IM.lib.get(it.mediaId);
        if (m && !m.url && m.builtin && IM.ensureBuiltin) { IM.ensureBuiltin(m).then(() => this.invalidate()); return; }
        if (!m || !m.url) return;
        const local = clamp(t - e.start, 0, e.dur);
        const inRange = t >= e.start - 1e-4 && t < e.end - 1e-4;
        if (it.type === 'image') return;
        const isAudioItem = it.type === 'audio';
        const pool = isAudioItem ? this.apool : this.vpool;
        const key = it.id + (it.type === 'freeze' ? '#f' : '');
        const el = pool.acquire(key, m);
        (isAudioItem ? keepA : keepV).add(key);
        const want = Pr.sampleTime(it, local, m);
        const hasSound = !isAudioItem ? (it.type === 'video' && !it.audio.detached && m.hasAudio !== false) : true;
        const sp = it.speed || 1;
        const seekMode = !fwd || it.type === 'freeze' || it.reverse;
        if (seekMode || !inRange) {
          if (playing && inRange && this.rate === 1 && hasSound && it.type !== 'freeze') {
            this._voice(e, local, IM.itemGain(it, local, e.dur, e) * IM.duckFactor(p, L, t, it.id));
            liveVoices.add(it.id);
          }
          if (!el.paused) el.pause();
          // when previewing ahead (preroll), park at start
          seekEl(el, inRange ? want : Pr.sampleTime(it, 0, m));
          this.audio.setGain(el, 0);
          return;
        }
        // forward playback
        const pr = clamp(sp * this.rate, 0.0625, 16);
        if (Math.abs(el.playbackRate - pr) > 1e-3) el.playbackRate = pr;
        setPitch(el, it.preservePitch !== false);
        if (el.paused || this._resyncAll) {
          if (Math.abs(el.currentTime - want) > 0.05 || this._resyncAll) seekEl(el, want);
          if (el.paused) { const pp = el.play(); if (pp && pp.catch) pp.catch(() => {}); }
        } else {
          const drift = el.currentTime - want;
          if (Math.abs(drift) > 0.3 * Math.max(1, pr)) seekEl(el, want);
        }
        // audio
        const g = IM.itemGain(it, local, e.dur, e) * IM.duckFactor(p, L, t, it.id) * (this.muteProject && !it._voiceover ? 0 : 1);
        const needsBuffer = it.reverse || Math.abs(sp - 1) > 1e-4;
        if (hasSound && !mutedFast && needsBuffer) {
          this.audio.setGain(el, 0);
          this._voice(e, local, g);
          liveVoices.add(it.id);
        } else if (hasSound && !mutedFast) {
          this.audio.configure(el, it.audio);
          this.audio.setGain(el, g, this._resyncAll);
        } else this.audio.setGain(el, 0);
      };
      const act = Pr.activeAt(p, t);
      act.prim.forEach((e) => handle(e, true));
      act.conn.forEach((e) => handle(e, e.item.type !== 'audio'));
      act.music.forEach((e) => { if (t < L.duration) handle(e, false); });
      // preroll upcoming items (so the first frame is ready)
      if (playing && this.rate > 0) {
        const horizon = t + 1.5;
        const upcoming = L.clips.concat(L.connected).filter((e) => e.start > t && e.start < horizon);
        for (const e of upcoming) {
          const it = e.item;
          if (it.type !== 'video' && it.type !== 'audio' && it.type !== 'freeze') continue;
          const m = IM.lib.get(it.mediaId);
          if (!m || !m.url) continue;
          const pool = it.type === 'audio' ? this.apool : this.vpool;
          const key = it.id + (it.type === 'freeze' ? '#f' : '');
          const el = pool.acquire(key, m);
          (it.type === 'audio' ? keepA : keepV).add(key);
          if (el.paused) seekEl(el, it.type === 'freeze' ? it.frameTime : Pr.srcTime(it, 0));
        }
      } else if (!playing) {
        // keep neighbouring clips warm while scrubbing
        const e = Pr.primaryAt(p, t);
        if (e) {
          const nb = L.clips[e.index + 1];
          if (nb && nb.item.type === 'video' && nb.start - t < 1.0) {
            const m = IM.lib.get(nb.item.mediaId);
            if (m && m.url) { const k = nb.item.id; const el = this.vpool.acquire(k, m); keepV.add(k); if (el.paused) seekEl(el, IM.Project.srcTime(nb.item, 0)); }
          }
        }
      }
      if (this.sourcePlay) { keepV.add('source'); keepA.add('source'); }
      this.vpool.releaseExcept(keepV);
      this.apool.releaseExcept(keepA);
      if (this._voices) for (const id of Array.from(this._voices.keys())) if (!liveVoices.has(id) || !playing) this._stopVoice(id);
    }

    // ---------- buffer voices (reversed / speed-changed audio, identical to export) ----------
    _voice(e, local, gain) {
      const it = e.item;
      const ctx = this.audio.ctx;
      if (!ctx) return;
      this._voices = this._voices || new Map();
      const key = [it.mediaId, it.srcIn, it.srcOut, it.speed, it.reverse, it.preservePitch !== false, e.durF, IM.chainKey(it.audio)].join('|');
      let v = this._voices.get(it.id);
      if (v && v.key !== key) { this._stopVoice(it.id); v = null; }
      if (!v) {
        if (!e._abPending) {
          e._abPending = true;
          IM.itemAudio(e).then((buf) => { e._buf = buf; this._bufs = this._bufs || new Map(); this._bufs.set(key, buf); this._resyncAll = true; this.invalidate(); }).catch(() => {});
        }
        const buf = this._bufs && this._bufs.get(key);
        if (!buf) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = gain;
        let chain = null;
        if (IM.chainKey(it.audio) !== 'flat|none|0') { chain = IM.buildAudioChain(ctx, it.audio); src.connect(chain.input); chain.output.connect(g); } else src.connect(g);
        g.connect(this.audio.master);
        const off = clamp(local, 0, buf.duration - 0.001);
        src.start(ctx.currentTime + 0.01, off);
        v = { src, g, chain, key, t0: ctx.currentTime + 0.01, off };
        this._voices.set(it.id, v);
        return;
      }
      // drift correction against the playhead
      const pos = v.off + (ctx.currentTime - v.t0);
      if (Math.abs(pos - local) > 0.08 || this._resyncAll) { this._stopVoice(it.id); this._voice(e, local, gain); return; }
      v.g.gain.setTargetAtTime(gain, ctx.currentTime, 0.012);
    }
    _stopVoice(id) {
      const v = this._voices && this._voices.get(id);
      if (!v) return;
      try { v.src.stop(); } catch (err) { /* */ }
      try { v.g.disconnect(); } catch (err) { /* */ }
      if (v.chain) v.chain.dispose();
      this._voices.delete(id);
    }
    _stopVoices() { if (this._voices) for (const id of Array.from(this._voices.keys())) this._stopVoice(id); }

    _videoSource(it, srcTime, m) {
      const key = it.id + (it.type === 'freeze' ? '#f' : '');
      const el = this.vpool.acquire(key, m);
      const playingLive = this.playing && this.rate > 0 && !el.paused && it.type !== 'freeze' && !it.reverse;
      if (!playingLive) seekEl(el, srcTime);
      if (!frameReady(el)) return null;
      const ts = el._frameTs != null && Math.abs(el._frameTs - el.currentTime) < 0.25 ? el._frameTs : el.currentTime;
      return { src: el, key: 'v' + el._id, w: el.videoWidth, h: el.videoHeight, stamp: playingLive ? null : el._stamp + ':' + el.currentTime.toFixed(4), ts };
    }

    _sourceSpec() {
      const s = this.source;
      const m = s.media;
      const base = { kind: 'pending' };
      if (m.kind === 'image' && m.image) {
        Object.assign(base, { kind: 'media', src: { src: m.image, key: 'img:' + m.id, w: m.width, h: m.height, stamp: 1 }, rect: IM.Project.fitRect(m, 0), rot: 0, flip: false, video: IM.Project.defaultVideo(), filter: 'none', time: 0 });
      } else if (m.kind === 'video') {
        const key = this.sourcePlay && this.sourcePlay.media === m ? 'source' : 'skim';
        const el = this.vpool.acquire(key, m);
        if (key === 'skim') seekEl(el, s.t);
        if (frameReady(el)) {
          Object.assign(base, { kind: 'media', src: { src: el, key: 'v' + el._id, w: el.videoWidth, h: el.videoHeight, stamp: key === 'source' ? null : el._stamp + ':' + el.currentTime.toFixed(4) }, rect: IM.Project.fitRect(m, 0), rot: 0, flip: false, video: IM.Project.defaultVideo(), filter: 'none', time: s.t });
        }
      } else base.kind = 'black';
      return { base, overlays: [], titles: [], projectFilter: 'none', time: s.t };
    }

    /** Render the viewer. Returns false if a needed frame wasn't ready (keeps previous image). */
    renderFrame() {
      const r = this.renderer;
      if (!r) return true;
      let spec;
      const pv = this.preview;
      if (this.source && (!pv || pv.kind === 'source')) {
        spec = this._sourceSpec();
        this.vpool.releaseExcept(new Set(['skim', 'source', ...this._timelineKeys()]));
      } else if (this.project) {
        const t = this.displayTime;
        const opts = {};
        if (pv && pv.kind === 'filter') opts.filterOverride = pv;
        // When paused, use the exact decoded frames (identical to the export) once they're ready.
        let provider = this.provider;
        if (!this.playing && (!pv || pv.kind !== 'cropEdit')) {
          const key = this._preciseKey(t);
          if (this._precise && this._precise.key === key) provider = this._precise.prov;
          else if (!this.playing) this._schedulePrecise(t, key);
        }
        spec = IM.Compose.frame(this.project, t, provider, opts);
        if (provider !== this.provider && hasPending(spec)) spec = IM.Compose.frame(this.project, t, this.provider, opts);
        if (pv) this._applyPreview(spec, t, pv);
      } else {
        spec = { base: null, overlays: [], titles: [] };
      }
      // a picture that isn't decoded yet: keep showing the previous one for a while rather than black
      const pending = hasPending(spec);
      if (pending) {
        if (!this._pendingSince) this._pendingSince = performance.now();
        if (performance.now() - this._pendingSince < 1200) return false;
      } else this._pendingSince = 0;
      try { r.render(spec); } catch (e) { console.error(e); }
      this.emit('rendered');
      return true;
    }
    _preciseKey(t) {
      const p = this.project;
      return p ? p.id + ':' + p.version + ':' + IM.Project.frameAt(p, t) : '';
    }
    _schedulePrecise(t, key) {
      if (this._preciseWant === key) return;
      this._preciseWant = key;
      clearTimeout(this._preciseTimer);
      this._preciseTimer = setTimeout(() => this._fetchPrecise(t, key), 160);
    }
    async _fetchPrecise(t, key) {
      const p = this.project;
      if (!p || this.playing || this._preciseKey(this.displayTime) !== key || !IM.RenderEngine) return;
      const prov = new IM.ExactProvider();
      try {
        const act = IM.Project.activeAt(p, t);
        const ents = act.prim.concat(act.conn).filter((e) => e.item.type === 'video' || e.item.type === 'freeze');
        for (const e of ents) {
          const m = IM.lib.get(e.item.mediaId);
          if (!m || !m.blob) continue;
          const srv = IM.RenderEngine.server(m);
          await srv.open();
          const f = await srv.frameAt(IM.Project.sampleTime(e.item, t - e.start, m));
          prov.set(e.item.id, f);
          f.keep = true;
        }
      } catch (err) { prov.clear(false); return; }
      if (this._preciseKey(this.displayTime) !== key || this.playing) { prov.clear(false); return; }
      if (this._precise) this._precise.prov.clear(false);
      this._precise = { key, prov };
      this._preciseWant = null;
      this.invalidate();
    }
    _timelineKeys() { return Array.from(this.vpool.byKey.keys()).filter((k) => k !== 'skim' && k !== 'source'); }
    _applyPreview(spec, t, pv) {
      if (pv.kind === 'title') {
        const it = IM.Project.makeTitle(pv.style);
        spec.titles.push({ title: it.title, local: pv.local, dur: IM.Project.dur(it), opacity: 1 });
      } else if (pv.kind === 'titleStatic') {
        for (const tt of spec.titles) if (tt.id === pv.id) tt.local = pv.local;
        if (spec.base && spec.base.kind === 'titleclip' && spec.base.id === pv.id) spec.base.local = pv.local;
      } else if (pv.kind === 'cropEdit') {
        // show the whole picture for crop editing
        const fix = (L) => {
          if (L && L.id === pv.id && L.kind === 'media') {
            const m = IM.lib.get(pv.mediaId);
            L.rect = IM.Project.fitRect(m, L.video.rotate || 0);
            L.filter = 'none';
          }
        };
        if (spec.base && spec.base.kind === 'transition') { fix(spec.base.a); fix(spec.base.b); } else fix(spec.base);
        spec.overlays.forEach((o) => { if (o.id === pv.id) { fix(o.layer); o.mode = 'cutaway'; o.opacity = 1; } });
        spec.titles = [];
      } else if (pv.kind === 'hideTitle') {
        spec.titles = spec.titles.filter((x) => x.id !== pv.id);
      }
    }

    _audioSkimBlip(t) {
      // short audio snippet while skimming the timeline
      const p = this.project;
      if (!p) return;
      const e = IM.Project.primaryAt(p, t);
      if (!e || e.item.type !== 'video') return;
      const m = IM.lib.get(e.item.mediaId);
      if (!m || m.hasAudio === false) return;
      this.audio.init();
      const el = this.vpool.acquire(e.item.id, m);
      this.audio.configure(el, e.item.audio);
      this.audio.setGain(el, 0.8 * IM.itemGain(e.item, t - e.start, e.dur, e), true);
      const p2 = el.play(); if (p2 && p2.catch) p2.catch(() => {});
      clearTimeout(this._blipTimer);
      this._blipTimer = setTimeout(() => { if (!this.playing) { el.pause(); this.audio.setGain(el, 0); } }, 90);
    }
  }
  function hasPending(spec) {
    const b = spec.base;
    if (!b) return false;
    if (b.kind === 'pending') return true;
    if (b.kind === 'transition') return (b.a && b.a.kind === 'pending') || (b.b && b.b.kind === 'pending');
    return spec.overlays.some((o) => o.layer && o.layer.kind === 'pending');
  }
  IM.Player = Player;
})(window.IM = window.IM || {});
