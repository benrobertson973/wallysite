/* ==========================================================================
   Render engine — frame-exact export, background pre-rendering, verification
   --------------------------------------------------------------------------
   * The export renders every output frame through the same Compose/Renderer
     path as the viewer, at exact integer-frame times.
   * Source frames come from WebCodecs (via mediabunny) — never from seeking
     <video> elements — so each output frame uses exactly the intended source
     frame.  A verified <video> fallback exists for files WebCodecs can't decode.
   * Missing frames are errors, never silent black frames.
   * The movie is split into shift-invariant, content-hashed segments.  Idle
     time is used to pre-render segments; export reuses cached encoded packets.
   * After export the file is decoded again and sampled frames are compared
     against fresh renders (PSNR).  Failing segments are re-rendered once.
   ========================================================================== */
(function (IM) {
  'use strict';
  const Pr = IM.Project;
  const clamp = IM.clamp;

  // ------------------------------------------------------------------ hashing
  function fnv(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193);
      h2 ^= c; h2 = Math.imul(h2, 0x5bd1e995); h2 ^= h2 >>> 13;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + str.length.toString(36);
  }
  IM.fnv = fnv;

  class RenderError extends Error { constructor(msg, detail) { super(msg); this.detail = detail; this.name = 'RenderError'; } }
  class AbortRender extends Error { constructor() { super('aborted'); this.name = 'AbortRender'; } }
  IM.RenderError = RenderError;

  const sampleTime = (it, local, m) => Pr.sampleTime(it, local, m);

  // ------------------------------------------------------------------ FrameServer
  /** Exact frame access for one media file (WebCodecs via mediabunny, <video> fallback). */
  class FrameServer {
    constructor(m) { this.m = m; this.mode = null; this.opened = null; }
    open() {
      if (this.opened) return this.opened;
      this.opened = (async () => {
        const m = this.m;
        if (!m.blob && m.builtin) await IM.ensureBuiltin(m);
        const mb = await IM.loadMediabunny();
        if (mb && typeof VideoDecoder !== 'undefined') {
          try {
            this.input = new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS });
            this.track = await this.input.getPrimaryVideoTrack();
            if (this.track && (await this.track.canDecode())) {
              this.sink = new mb.VideoSampleSink(this.track);
              this.first = await this.track.getFirstTimestamp().catch(() => 0);
              this.mode = 'webcodecs';
              return;
            }
          } catch (e) { console.warn('WebCodecs frame access unavailable for', m.name, e); }
        }
        this.mode = 'element';
        this.el = document.createElement('video');
        this.el.muted = true; this.el.preload = 'auto'; this.el.playsInline = true;
        this.el.src = m.url;
        await IM.once(this.el, 'loadeddata', 20000);
        if (this.el.readyState < 2) throw new RenderError(`“${m.name}” can’t be read by this browser.`);
      })();
      return this.opened;
    }
    /** Sequential reader for a list of sample times (one sample per time, in order). */
    reader(times) {
      if (this.mode === 'webcodecs') return new SinkReader(this, times);
      return new ElementReader(this, times);
    }
    /** Single frame at time t. Returns {frame: VideoFrame, rot, w, h}. */
    async frameAt(t) {
      if (this.mode === 'webcodecs') {
        let s = await this.sink.getSample(t);
        if (!s) s = await this.sink.getSample(this.first || 0);
        if (!s) throw new RenderError(`Couldn’t read a frame from “${this.m.name}” at ${t.toFixed(3)}s.`);
        return sampleToFrame(s);
      }
      return elementFrame(this, t);
    }
    close() {
      try { if (this.input && this.input.dispose) this.input.dispose(); } catch (e) { /* */ }
      if (this.el) { this.el.removeAttribute('src'); this.el.load(); }
    }
  }
  function sampleToFrame(s) {
    const frame = s.toVideoFrame();
    const rot = s.rotation || 0;
    const out = { frame, rot, w: frame.displayWidth, h: frame.displayHeight, ts: s.timestamp };
    s.close();
    return out;
  }
  // one seek at a time on a server's fallback <video> element
  function elementFrame(server, t) {
    const run = (server._elQueue || Promise.resolve()).then(() => elementFrameNow(server, t));
    server._elQueue = run.catch(() => {});
    return run;
  }
  async function elementFrameNow(server, t) {
    const el = server.el;
    await IM.seekMedia(el, t, 8000);
    if ('requestVideoFrameCallback' in el) {
      await new Promise((r) => { let done = false; el.requestVideoFrameCallback(() => { done = true; r(); }); setTimeout(() => { if (!done) r(); }, 120); });
    }
    if (el.readyState < 2) throw new RenderError(`Couldn’t read a frame from “${server.m.name}” at ${t.toFixed(3)}s.`);
    let frame;
    try { frame = new VideoFrame(el, { timestamp: Math.round(t * 1e6) }); } catch (e) {
      const c = document.createElement('canvas');
      c.width = el.videoWidth; c.height = el.videoHeight;
      c.getContext('2d').drawImage(el, 0, 0);
      return { frame: null, canvas: c, rot: 0, w: c.width, h: c.height, ts: t };
    }
    return { frame, rot: 0, w: frame.displayWidth, h: frame.displayHeight, ts: t };
  }
  class SinkReader {
    constructor(server, times) {
      this.server = server; this.times = times; this.i = 0;
      this.gen = server.sink.samplesAtTimestamps(times);
    }
    async next() {
      const t = this.times[this.i++];
      const r = await this.gen.next();
      let s = r.done ? null : r.value;
      if (!s) {
        // before the first frame / decode gap: fall back to a direct lookup
        s = await this.server.sink.getSample(t);
        if (!s) s = await this.server.sink.getSample(this.server.first || 0);
      }
      if (!s) throw new RenderError(`Couldn’t read a frame from “${this.server.m.name}” at ${t.toFixed(3)}s.`);
      return sampleToFrame(s);
    }
    close() { try { this.gen.return(); } catch (e) { /* */ } }
  }
  class ElementReader {
    constructor(server, times) { this.server = server; this.times = times; this.i = 0; }
    next() { return elementFrame(this.server, this.times[this.i++]); }
    close() { /* */ }
  }

  // ------------------------------------------------------------------ render lock
  const RenderLock = {
    busy: false, waiters: [], fgWaiting: 0,
    async acquire(fg) {
      if (fg) this.fgWaiting++;
      try {
        while (this.busy) await new Promise((r) => this.waiters.push(r));
        this.busy = true;
      } finally { if (fg) this.fgWaiting--; }
    },
    release() {
      this.busy = false;
      const next = this.waiters.shift();
      if (next) next();
    },
  };

  // ------------------------------------------------------------------ exact provider
  /** Frame provider for Compose that serves frames fetched ahead of rendering. */
  // Every fetched frame gets a globally unique stamp so a GPU texture is never reused for a different frame,
  // even across providers/segments/renderers that share texture keys.
  let frameStamp = 0;
  class ExactProvider {
    constructor() { this.frames = new Map(); }
    set(key, f) {
      const old = this.frames.get(key);
      if (old && old !== f && old.frame && !old.keep) old.frame.close();
      if (!f.stamp) f.stamp = 'x' + (++frameStamp);
      this.frames.set(key, f);
    }
    video(it) {
      const f = this.frames.get(it.id);
      if (!f) return null;
      return { src: f.frame || f.canvas, key: 'x:' + it.id, w: f.w, h: f.h, stamp: f.stamp, metaRot: f.rot || 0, ts: f.ts };
    }
    image(it, m) { return m.image ? { src: m.image, key: 'img:' + m.id, w: m.width, h: m.height, stamp: 1 } : null; }
    clear(keepFreeze) {
      for (const [k, f] of this.frames) {
        if (keepFreeze && f.keep) continue;
        if (f.frame) { try { f.frame.close(); } catch (e) { /* */ } }
        this.frames.delete(k);
      }
    }
  }
  IM.ExactProvider = ExactProvider;

  // ------------------------------------------------------------------ segmentation
  const SEG_MAX_SEC = 4;
  /** Visual items that affect frames. */
  function visualEntries(L) {
    return L.clips.concat(L.connected.filter((e) => e.item.type !== 'audio'));
  }
  function itemSig(it, m) {
    const o = {
      t: it.type, mid: it.mediaId || null, bg: it.bgId || null,
      a: it.srcIn, b: it.srcOut, sp: it.speed || 1, rv: !!it.reverse, ft: it.type === 'freeze' ? it.frameTime : null,
      v: it.video, ov: it.overlay || null, ti: it.title || null, bgc: it.bg || null,
    };
    if (IM.stabilizer && IM.stabilizer.needs(it.video)) o.stv = IM.stabilizer.VERSION;
    if (it.overlay && it.overlay.mode === 'greenscreen') o.kv = KEY_VERSION;
    if (m) o.mf = [m.size, m.duration, m.width, m.height, m.fps, m.created];
    return o;
  }
  /**
   * Split the movie into segments whose content is constant in structure, with shift-invariant hashes.
   * Returns [{sF, eF, key, sig}] (frame ranges).
   */
  function segmentsFor(p, fmt) {
    const L = Pr.layout(p);
    const fps = L.fps;
    const total = L.durationF;
    if (!total) return [];
    const cuts = new Set([0, total]);
    const vis = visualEntries(L);
    for (const e of vis) { if (e.startF > 0 && e.startF < total) cuts.add(e.startF); if (e.endF > 0 && e.endF < total) cuts.add(e.endF); }
    for (const e of L.clips) if (e.trOutF) { const b = e.endF - e.trOutF; if (b > 0 && b < total) cuts.add(b); }
    // fade in from black / out to black depend on the distance to the movie's start / end
    const st = p.settings || {};
    const fadeN = Math.max(1, Math.round(Pr.FADE_SEC * fps));
    if (st.fadeIn && fadeN < total) cuts.add(fadeN);
    if (st.fadeOut && total - fadeN > 0) cuts.add(total - fadeN);
    const sorted = Array.from(cuts).sort((a, b) => a - b);
    const maxLen = Math.max(1, Math.round(SEG_MAX_SEC * fps));
    const segs = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      for (let s = a; s < b; s += maxLen) segs.push({ sF: s, eF: Math.min(b, s + maxLen) });
    }
    const pf = p.settings.filter || 'none';
    for (const seg of segs) {
      const act = vis.filter((e) => e.startF < seg.eF && e.endF > seg.sF);
      const layers = act.map((e) => {
        const m = e.item.mediaId ? IM.lib.get(e.item.mediaId) : null;
        const o = { w: e.where, lane: e.lane || 0, off: seg.sF - e.startF, d: e.durF, it: itemSig(e.item, m) };
        if (e.where === 'primary') { o.trIn = e.trInF; o.trOut = e.trOutF; o.trType = e.item.transition ? e.item.transition.type : null; }
        return o;
      });
      // transition type of the incoming side matters for the previous clip
      for (const e of act) if (e.where === 'primary' && e.index > 0) {
        const prev = L.clips[e.index - 1];
        const o = layers.find((x) => x.w === 'primary' && x.off === seg.sF - e.startF);
        if (o && prev.item.transition) o.inType = prev.item.transition.type;
      }
      const fade = {};
      if (st.fadeIn && seg.sF < fadeN) fade.fi = seg.sF;
      if (st.fadeOut && seg.eF > total - fadeN) fade.fo = total - seg.sF;
      const sig = JSON.stringify({ n: seg.eF - seg.sF, fps, fmt: fmt.key, pf, layers, fade });
      seg.sig = sig;
      seg.key = fmt.key + '|' + fnv(sig);
    }
    return segs;
  }

  // ------------------------------------------------------------------ render cache (IndexedDB)
  const Cache = {
    index: new Map(),
    loaded: false,
    maxBytes: 2 * 1024 * 1024 * 1024,
    async load() {
      if (this.loaded) return;
      this.loaded = true;
      const all = await IM.DB.all('render');
      for (const { key, value } of all) if (value) this.index.set(key, { size: value.size || 0, used: value.used || 0 });
    },
    has(key) { return this.index.has(key); },
    async get(key) {
      if (!this.index.has(key)) return null;
      const v = await IM.DB.get('render', key);
      if (!v) { this.index.delete(key); return null; }
      const buf = new Uint8Array(await v.data.arrayBuffer());
      const packets = v.packets.map((pk) => ({ type: pk.type, ts: pk.ts, dur: pk.dur, data: buf.subarray(pk.off, pk.off + pk.len) }));
      v.used = Date.now();
      this.index.set(key, { size: v.size, used: v.used });
      IM.DB.put('render', key, Object.assign({}, v));
      return { packets, config: restoreConfig(v.config), frames: v.frames };
    },
    async put(key, seg) {
      let off = 0;
      const parts = [], meta = [];
      for (const pk of seg.packets) { parts.push(pk.data); meta.push({ type: pk.type, ts: pk.ts, dur: pk.dur, off, len: pk.data.byteLength }); off += pk.data.byteLength; }
      const rec = { packets: meta, data: new Blob(parts), config: storeConfig(seg.config), frames: seg.frames, size: off, used: Date.now() };
      this.index.set(key, { size: off, used: rec.used });
      await IM.DB.put('render', key, rec);
      this.evict();
    },
    async remove(key) { this.index.delete(key); await IM.DB.del('render', key); },
    totalBytes() { let s = 0; for (const v of this.index.values()) s += v.size; return s; },
    async evict() {
      let total = this.totalBytes();
      if (total <= this.maxBytes) return;
      const arr = Array.from(this.index.entries()).sort((a, b) => a[1].used - b[1].used);
      for (const [k, v] of arr) { if (total <= this.maxBytes * 0.8) break; await this.remove(k); total -= v.size; }
    },
    async clear() { for (const k of Array.from(this.index.keys())) await this.remove(k); },
  };
  function storeConfig(c) {
    if (!c) return null;
    const o = Object.assign({}, c);
    if (c.description) o.description = c.description instanceof ArrayBuffer ? c.description.slice(0) : new Uint8Array(c.description.buffer || c.description).slice().buffer;
    return o;
  }
  function restoreConfig(c) { return c ? Object.assign({}, c) : null; }
  function configBytes(c) {
    if (!c || !c.description) return '';
    const u = c.description instanceof ArrayBuffer ? new Uint8Array(c.description) : new Uint8Array(c.description.buffer || c.description, c.description.byteOffset || 0, c.description.byteLength);
    return Array.from(u).join(',');
  }
  function configsCompatible(a, b) {
    if (!a || !b) return false;
    if ((a.codec || '') !== (b.codec || '')) return false;
    if ((a.codedWidth || 0) !== (b.codedWidth || 0) || (a.codedHeight || 0) !== (b.codedHeight || 0)) return false;
    return configBytes(a) === configBytes(b);
  }
  IM.RenderCache = Cache;

  // ------------------------------------------------------------------ formats & encoders
  const QUALITY_BPP = { low: 0.045, medium: 0.08, high: 0.14, best: 0.26 };
  const RES = { 540: [960, 540], 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] };
  async function pickVideoCodec(W, H, fps, bitrate, prefer) {
    if (typeof VideoEncoder === 'undefined') return null;
    const cands = [];
    const level = W * H > 1920 * 1088 ? '33' : W * H > 1280 * 720 ? '28' : '1f';
    if (prefer !== 'webm') {
      cands.push({ codec: 'avc', str: 'avc1.6400' + level, container: 'mp4' });
      cands.push({ codec: 'avc', str: 'avc1.4d00' + level, container: 'mp4' });
      cands.push({ codec: 'avc', str: 'avc1.4200' + level, container: 'mp4' });
      cands.push({ codec: 'hevc', str: 'hvc1.1.6.L123.B0', container: 'mp4' });
    }
    cands.push({ codec: 'vp9', str: 'vp09.00.' + (W * H > 1920 * 1088 ? '51' : '41') + '.08', container: 'webm' });
    cands.push({ codec: 'av1', str: 'av01.0.' + (W * H > 1920 * 1088 ? '12' : '08') + 'M.08', container: 'webm' });
    cands.push({ codec: 'vp8', str: 'vp8', container: 'webm' });
    for (const c of cands) {
      const cfg = encoderConfig(c, W, H, fps, bitrate);
      try {
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s && s.supported) return Object.assign({}, c, { config: s.config || cfg });
      } catch (e) { /* try next */ }
    }
    return null;
  }
  function encoderConfig(c, W, H, fps, bitrate) {
    const cfg = { codec: c.str, width: W, height: H, bitrate: Math.round(bitrate), framerate: fps, latencyMode: 'quality', bitrateMode: 'variable' };
    if (c.codec === 'avc') cfg.avc = { format: 'avc' };
    if (c.codec === 'hevc') cfg.hevc = { format: 'hevc' };
    return cfg;
  }
  async function pickAudioCodec(container) {
    const mb = await IM.loadMediabunny();
    const list = container === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'];
    for (const c of list) {
      try { if (await mb.canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 })) return c; } catch (e) { /* next */ }
    }
    return null;
  }
  /** Resolve export settings into a concrete format. */
  async function resolveFormat(p, o) {
    o = o || {};
    const fps = Pr.fps(p);
    const [W, H] = RES[o.resolution || 1080] || RES[1080];
    const bpp = QUALITY_BPP[o.quality || 'high'] || QUALITY_BPP.high;
    const bitrate = o.bitrate || Math.max(500000, W * H * fps * bpp);
    const vc = await pickVideoCodec(W, H, fps, bitrate, o.container);
    if (!vc) return null;
    const key = [vc.config.codec, W + 'x' + H, fps, Math.round(bitrate / 1000)].join(':');
    return { W, H, fps, bitrate, codec: vc.codec, codecStr: vc.config.codec, container: vc.container, encoderConfig: vc.config, key, resolution: o.resolution || 1080, quality: o.quality || 'high' };
  }

  /** A VideoEncoder session that collects packets; supports forced keyframes per segment. */
  class EncoderSession {
    constructor(fmt) {
      this.fmt = fmt;
      this.packets = [];
      this.config = null;
      this.error = null;
      this.enc = new VideoEncoder({
        output: (chunk, meta) => {
          if (meta && meta.decoderConfig) this.config = Object.assign({}, meta.decoderConfig, { codedWidth: meta.decoderConfig.codedWidth || fmt.W, codedHeight: meta.decoderConfig.codedHeight || fmt.H });
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          this.packets.push({ type: chunk.type, ts: chunk.timestamp, dur: chunk.duration || Math.round(1e6 / fmt.fps), data });
        },
        error: (e) => { this.error = e; },
      });
      this.enc.configure(fmt.encoderConfig);
    }
    async encode(frame, key) {
      if (this.error) throw new RenderError('The video encoder failed: ' + this.error.message);
      this.enc.encode(frame, { keyFrame: !!key });
      while (this.enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 0));
    }
    async flush() {
      await this.enc.flush();
      if (this.error) throw new RenderError('The video encoder failed: ' + this.error.message);
      const out = this.packets;
      this.packets = [];
      return out;
    }
    close() { try { this.enc.close(); } catch (e) { /* */ } }
  }

  // ------------------------------------------------------------------ the engine
  const Engine = {
    servers: new Map(),
    renderer: null,
    busy: null, // 'export' | 'background' | null

    server(m) {
      let s = this.servers.get(m.id);
      if (!s) { s = new FrameServer(m); this.servers.set(m.id, s); }
      return s;
    },
    dropServer(mediaId) { const s = this.servers.get(mediaId); if (s) { s.close(); this.servers.delete(mediaId); } },
    getRenderer(W, H) {
      if (!this.renderer) {
        const c = document.createElement('canvas');
        this.renderer = new IM.Renderer(c, { width: W, height: H, preserve: true });
      }
      this.renderer.setSize(W, H);
      return this.renderer;
    },
    /** Make sure everything a render depends on is loaded. */
    async prepare(p) {
      const L = Pr.layout(p);
      const needs = new Set();
      Pr.forEachItem(p, (it) => { if (it.mediaId) needs.add(it.mediaId); });
      for (const id of needs) {
        const m = IM.lib.get(id);
        if (!m) throw new RenderError('A clip in this project refers to media that is no longer in the library.');
        if (m.builtin && !m.blob) await IM.ensureBuiltin(m);
        if (m.kind === 'image' && !m.image) await IM.lib._loadImage(m);
        if (m.kind === 'image' && !m.image) throw new RenderError(`The photo “${m.name}” can’t be loaded.`);
      }
      // fonts used by titles
      if (document.fonts) {
        const fams = new Set();
        visualEntries(L).forEach((e) => { if (e.item.type === 'title') fams.add(e.item.title.font); });
        await Promise.all(Array.from(fams).map((f) => document.fonts.load('48px ' + IM.fontStack(f)).catch(() => {})));
        await document.fonts.ready;
      }
      for (const e of visualEntries(L)) {
        if (e.item.type !== 'video' && e.item.type !== 'freeze') continue;
        await this.server(IM.lib.get(e.item.mediaId)).open();
      }
      // green/blue screen key colours
      for (const e of visualEntries(L)) {
        const it = e.item;
        if (it.overlay && it.overlay.mode === 'greenscreen' && e.where === 'connected') await Keyer.ensure(it);
      }
      // stabilization analysis (stored per media; computed now if missing)
      for (const e of visualEntries(L)) {
        const it = e.item;
        if ((it.type !== 'video' && it.type !== 'freeze') || !IM.stabilizer || !IM.stabilizer.needs(it.video)) continue;
        try { await IM.stabilizer.ensure(it); } catch (err) {
          throw new RenderError(`Stabilization couldn’t be analyzed for “${(IM.lib.get(it.mediaId) || {}).name || 'a clip'}”.`, err);
        }
      }
    },
    /**
     * Render frames [sF, eF) of project p. For each frame calls onFrame(f, canvas) after drawing.
     * opts.shouldAbort() can cancel between frames. Renders never overlap (they share one renderer):
     * opts.background renders yield to any foreground render that is waiting.
     */
    async renderRange(p, sF, eF, W, H, onFrame, opts) {
      opts = opts || {};
      await RenderLock.acquire(!opts.background);
      try {
        return await this._renderRange(p, sF, eF, W, H, onFrame, opts);
      } finally { RenderLock.release(); }
    },
    async _renderRange(p, sF, eF, W, H, onFrame, opts) {
      const L = Pr.layout(p);
      const fps = L.fps;
      const r = this.getRenderer(W, H);
      const provider = new ExactProvider();
      const readers = [];
      for (const e of visualEntries(L)) {
        const it = e.item;
        if (it.type !== 'video' && it.type !== 'freeze') continue;
        const a = Math.max(sF, e.startF), b = Math.min(eF, e.endF);
        if (a >= b) continue;
        const m = IM.lib.get(it.mediaId);
        const srv = this.server(m);
        await srv.open();
        readers.push({ e, a, b, srv, m, freeze: it.type === 'freeze', reader: null, frame: null });
      }
      const closeReader = (rd) => {
        if (rd.reader) { rd.reader.close(); rd.reader = null; }
        if (rd.frame) { if (rd.frame.frame) { try { rd.frame.frame.close(); } catch (e) { /* */ } } rd.frame = null; }
      };
      try {
        for (let f = sF; f < eF; f++) {
          if (opts.shouldAbort && opts.shouldAbort()) throw new AbortRender();
          for (const rd of readers) {
            if (f < rd.a || f >= rd.b) continue;
            if (rd.freeze) {
              if (!rd.frame) { rd.frame = await rd.srv.frameAt(sampleTime(rd.e.item, 0, rd.m)); rd.frame.keep = true; }
              provider.set(rd.e.item.id, rd.frame);
            } else {
              if (!rd.reader) {
                // lazily open a sequential reader covering this item's frames in the range
                const times = [];
                for (let ff = rd.a; ff < rd.b; ff++) times.push(sampleTime(rd.e.item, (ff - rd.e.startF) / fps, rd.m));
                rd.reader = rd.srv.reader(times);
              }
              provider.set(rd.e.item.id, await rd.reader.next());
            }
          }
          const spec = IM.Compose.frame(p, f / fps, provider, { strict: true });
          assertComplete(spec, f, fps);
          r.render(spec);
          await onFrame(f, r.canvas);
          provider.clear(true);
          for (const rd of readers) if (f === rd.b - 1) closeReader(rd);
        }
      } finally {
        provider.clear(false);
        for (const rd of readers) closeReader(rd);
      }
    },
    /** Render one segment to encoded packets using an encoder session. */
    async encodeSegment(p, seg, fmt, session, opts) {
      const fps = fmt.fps;
      await this.renderRange(p, seg.sF, seg.eF, fmt.W, fmt.H, async (f, canvas) => {
        if (canvas.width !== fmt.W || canvas.height !== fmt.H) throw new RenderError('A frame was rendered at the wrong size.', { frame: f });
        const frame = new VideoFrame(canvas, { timestamp: Math.round(f / fps * 1e6), duration: Math.round(1e6 / fps) });
        try { await session.encode(frame, f === seg.sF); } finally { frame.close(); }
      }, opts);
      const packets = await session.flush();
      const base = Math.round(seg.sF / fps * 1e6);
      for (const pk of packets) pk.ts -= base;
      if (!packets.length || packets[0].type !== 'key') throw new RenderError('The encoder produced an invalid segment.');
      return { packets, config: session.config, frames: seg.eF - seg.sF };
    },
    /** Encode one black frame to learn the decoder configuration this encoder produces. */
    async probeConfig(fmt) {
      const s = new EncoderSession(fmt);
      const c = document.createElement('canvas');
      c.width = fmt.W; c.height = fmt.H;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
      const vf = new VideoFrame(c, { timestamp: 0, duration: Math.round(1e6 / fmt.fps) });
      await s.encode(vf, true); vf.close();
      await s.flush();
      s.close();
      return s.config;
    },
  };
  function assertComplete(spec, f, fps) {
    const bad = (l) => l && (l.kind === 'pending' || l.kind === 'missing');
    const b = spec.base;
    const fail = bad(b) || (b && b.kind === 'transition' && (bad(b.a) || bad(b.b))) || spec.overlays.some((o) => bad(o.layer));
    if (fail) throw new RenderError(`A frame couldn’t be prepared at ${IM.fmtTime(f / fps, true)}.`, { frame: f });
  }
  IM.RenderEngine = Engine;

  // ------------------------------------------------------------------ green/blue screen key colour
  // Detected once per clip from decoded source frames (independent of output size and of timing), so the
  // viewer and every export key with exactly the same colour.
  const KEY_VERSION = 1;
  const keyColors = new Map();  // clip range key -> [r, g, b]
  const keyJobs = new Map();
  const keyRange = (it) => (it.type === 'freeze' ? [it.frameTime, it.frameTime] : [it.srcIn || 0, Math.max(it.srcIn || 0, it.srcOut || 0)]);
  const keyId = (it) => it.mediaId + '|' + keyRange(it).join('|');
  async function detectKeyColor(it) {
    const m = IM.lib.get(it.mediaId);
    if (!m) throw new RenderError('A clip in this project refers to media that is no longer in the library.');
    const W = 64, H = 36;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const gs = [0, 0, 0, 0], bs = [0, 0, 0, 0];
    const tally = () => {
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (g > r * 1.15 && g > b * 1.15) { gs[0] += r; gs[1] += g; gs[2] += b; gs[3]++; }
        else if (b > r * 1.15 && b > g * 1.05) { bs[0] += r; bs[1] += g; bs[2] += b; bs[3]++; }
      }
    };
    if (m.kind === 'image') {
      if (!m.image) await IM.lib._loadImage(m);
      if (!m.image) throw new RenderError(`The photo “${m.name}” can’t be loaded.`);
      ctx.drawImage(m.image, 0, 0, W, H);
      tally();
    } else {
      const srv = Engine.server(m);
      await srv.open();
      const [a, b] = keyRange(it);
      for (let i = 0; i < 5; i++) {
        const f = await srv.frameAt(clamp(a + ((b - a) * (i + 0.5)) / 5 + 0.0015, 0, Math.max(0, (m.duration || 0) - 1e-3)));
        try { ctx.clearRect(0, 0, W, H); ctx.drawImage(f.frame || f.canvas, 0, 0, W, H); } finally { if (f.frame) f.frame.close(); }
        tally();
      }
    }
    if (gs[3] >= bs[3] && gs[3] > 0) return [gs[0] / gs[3] / 255, gs[1] / gs[3] / 255, gs[2] / gs[3] / 255];
    if (bs[3] > 0) return [bs[0] / bs[3] / 255, bs[1] / bs[3] / 255, bs[2] / bs[3] / 255];
    return [0.1, 0.8, 0.2];
  }
  const Keyer = {
    VERSION: KEY_VERSION,
    /** Key colour for a green/blue screen clip, or null while it's being detected. */
    color(it, noRequest) {
      const k = it.overlay && it.overlay.key;
      if (k && k.color) return IM.hexToRgb(k.color);
      const id = keyId(it);
      if (keyColors.has(id)) return keyColors.get(id);
      if (!noRequest) this.ensure(it).then(() => IM.bus.emit('key-ready'), (e) => console.warn('Key colour detection failed', e));
      return null;
    },
    ensure(it) {
      const k = it.overlay && it.overlay.key;
      if (k && k.color) return Promise.resolve();
      const id = keyId(it);
      if (keyColors.has(id)) return Promise.resolve();
      if (!keyJobs.has(id)) {
        const job = detectKeyColor(it).then((rgb) => { keyColors.set(id, rgb); });
        keyJobs.set(id, job);
        job.then(() => keyJobs.delete(id), () => keyJobs.delete(id));
      }
      return keyJobs.get(id);
    },
  };
  IM.keyer = Keyer;

  // ------------------------------------------------------------------ audio: decoding on one 48 kHz grid, time-stretch, per-item buffers
  const audioCache = new Map(); // key -> AudioBuffer (timeline-time, before gain/effects)
  let audioCacheBytes = 0;
  const AUDIO_CACHE_MAX = 400 * 1024 * 1024;
  const AUDIO_SR = 48000;

  /** Left/right pair of decoded channels; 5.1 and quad fold down with the Web Audio speaker mix. */
  function stereoOf(chs) {
    if (chs.length >= 6 || chs.length === 4) {
      const l = chs[0], r = chs[1], n = l.length, L = new Float32Array(n), R = new Float32Array(n);
      if (chs.length >= 6) { // L R C LFE SL SR
        const c = chs[2], sl = chs[4], sr = chs[5], k = Math.SQRT1_2;
        for (let i = 0; i < n; i++) { L[i] = l[i] + k * (c[i] + sl[i]); R[i] = r[i] + k * (c[i] + sr[i]); }
      } else { // L R SL SR
        const sl = chs[2], sr = chs[3];
        for (let i = 0; i < n; i++) { L[i] = 0.5 * (l[i] + sl[i]); R[i] = 0.5 * (r[i] + sr[i]); }
      }
      return [L, R];
    }
    return [chs[0], chs[1] || chs[0]];
  }
  const channelsOf = (buf) => stereoOf(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)));

  // Short media are decoded whole (by the browser, straight to 48 kHz) and kept in a small LRU; long media are
  // streamed while mixing, so memory stays bounded however long the movie is.
  // A decoded source is {ch: [left, right], sr, base}: ch[c][k] is the file's sample base + k (at time (base + k) / sr).
  const WHOLE_MAX_SEC = 9 * 60, WHOLE_MAX_BYTES = 150 * 1024 * 1024;
  const WHOLE_CACHE_MAX = 600 * 1024 * 1024;
  const wholeCache = new Map(); // media id -> source
  const wholeJobs = new Map();
  const wholeFailed = new Set(), noSound = new Set(); // media ids (+ size) the browser couldn't decode whole / without sound
  const fileKey = (m) => m.id + ':' + (m.size || 0);
  let wholeBytes = 0;
  async function wholeAudio(m) {
    if (m.builtin) {
      if (!m.audioBuffer) await IM.ensureBuiltin(m);
      const b = m.audioBuffer;
      return b ? { ch: channelsOf(b), sr: b.sampleRate, base: 0 } : null;
    }
    const hit = wholeCache.get(m.id);
    if (hit) { wholeCache.delete(m.id); wholeCache.set(m.id, hit); return hit; }
    if (wholeJobs.has(m.id)) return wholeJobs.get(m.id);
    const job = (async () => {
      if (!m.blob) return null;
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const buf = await new OAC(1, 1, AUDIO_SR).decodeAudioData(await m.blob.arrayBuffer());
      const s = { ch: channelsOf(buf), sr: buf.sampleRate, base: 0 };
      s.bytes = s.ch[0].length * (s.ch[1] === s.ch[0] ? 4 : 8);
      wholeCache.set(m.id, s);
      wholeBytes += s.bytes;
      while (wholeBytes > WHOLE_CACHE_MAX && wholeCache.size > 1) {
        const k = wholeCache.keys().next().value;
        wholeBytes -= wholeCache.get(k).bytes;
        wholeCache.delete(k);
      }
      return s;
    })();
    wholeJobs.set(m.id, job);
    try { return await job; } finally { wholeJobs.delete(m.id); }
  }
  // Long media: one continuous decode per clip, starting a little before its in point and read forward window by
  // window. Every piece of a clip then comes from the same decoder run, so pieces join sample-exactly even for
  // codecs whose decoders need to settle after a seek (Opus, HE-AAC).
  const STREAM_PAD = 0.25;
  const streams = new Map(); // `${media id}|${t0}` -> RangeStream (LRU)
  class RangeStream {
    constructor(m, t0) { this.m = m; this.t0 = t0; this.from = Math.max(0, t0 - STREAM_PAD); this.chunks = []; this.sr = 0; this.done = false; this.dropped = -Infinity; this.queue = Promise.resolve(); }
    /** null: the file has no sound; undefined: this browser can't decode it. */
    async open() {
      const mb = await IM.loadMediabunny();
      if (!mb || !this.m.blob) return undefined;
      this.input = new mb.Input({ source: new mb.BlobSource(this.m.blob), formats: mb.ALL_FORMATS });
      const at = await this.input.getPrimaryAudioTrack();
      if (!at) return null;
      if (!(await at.canDecode())) return undefined;
      this.iter = new mb.AudioBufferSink(at).buffers(this.from)[Symbol.asyncIterator]();
      return this;
    }
    close() {
      try { if (this.iter && this.iter.return) this.iter.return().catch(() => {}); } catch (e) { /* */ }
      try { if (this.input && this.input.dispose) this.input.dispose(); } catch (e) { /* */ }
      this.chunks = [];
    }
    end() { const c = this.chunks[this.chunks.length - 1]; return c ? (c.base + c.len) / this.sr : -Infinity; }
    /** Can a read of clip samples from i0 on be served (reads only move forward)? */
    covers(i0) { return !this.sr || Math.floor((this.t0 + i0 / AUDIO_SR - 0.01) * this.sr) >= this.dropped; }
    read(i0, n) {
      const job = this.queue.then(() => this._read(i0, n));
      this.queue = job.catch(() => {});
      return job;
    }
    async _read(i0, n) {
      const a = this.t0 + i0 / AUDIO_SR, b = this.t0 + (i0 + n) / AUDIO_SR;
      while (!this.done && this.end() < b + 0.01) {
        const r = await this.iter.next();
        if (r.done) { this.done = true; break; }
        const { buffer, timestamp } = r.value;
        if (!this.sr) this.sr = buffer.sampleRate;
        const [l, rr] = channelsOf(buffer);
        this.chunks.push({ base: Math.round(timestamp * this.sr), len: buffer.length, l, r: rr });
      }
      const sr = this.sr || AUDIO_SR;
      const lo = Math.floor((a - 0.01) * sr), hi = Math.ceil((b + 0.01) * sr);
      const len = Math.max(1, hi - lo), ch = [new Float32Array(len), new Float32Array(len)];
      for (const c of this.chunks) {
        const s0 = Math.max(lo, c.base), s1 = Math.min(hi, c.base + c.len);
        if (s1 > s0) { ch[0].set(c.l.subarray(s0 - c.base, s1 - c.base), s0 - lo); ch[1].set(c.r.subarray(s0 - c.base, s1 - c.base), s0 - lo); }
      }
      // keep a little history; later reads start at or after this one's start
      const keep = lo - Math.round(sr);
      while (this.chunks.length > 1 && this.chunks[0].base + this.chunks[0].len < keep) { const c = this.chunks.shift(); this.dropped = c.base + c.len; }
      return resampleTo({ ch, sr, base: lo }, this.t0, i0, n);
    }
  }
  async function streamFor(m, t0, i0) {
    const key = m.id + '|' + t0;
    let st = streams.get(key);
    if (st && !st.covers(i0)) { st.close(); streams.delete(key); st = null; }
    if (st) { streams.delete(key); streams.set(key, st); return st; }
    st = new RangeStream(m, t0);
    let ok;
    try { ok = await st.open(); } catch (e) { console.warn('audio stream failed', m.name, e); ok = undefined; }
    if (!ok) { st.close(); return ok; }
    streams.set(key, st);
    while (streams.size > 12) { const k = streams.keys().next().value; streams.get(k).close(); streams.delete(k); }
    return st;
  }
  function closeStreams() { for (const st of streams.values()) st.close(); streams.clear(); }
  const isShort = (m) => !!m.builtin || (m.duration > 0 ? m.duration <= WHOLE_MAX_SEC && m.size < WHOLE_MAX_BYTES : m.size < 40 * 1024 * 1024);

  // Windowed-sinc interpolation (Kaiser, 48 taps at the lower of the two rates) for sources that aren't 48 kHz.
  const SINC_HW = 24, SINC_PHASES = 2048;
  const sincTables = new Map();
  function bessel0(x) {
    let s = 1, t = 1;
    for (let k = 1; k < 40; k++) { const q = x / (2 * k); t *= q * q; s += t; if (t < 1e-12 * s) break; }
    return s;
  }
  function sincTable(sr) {
    let t = sincTables.get(sr);
    if (t) return t;
    const down = Math.min(1, AUDIO_SR / sr);   // < 1 when the source rate is higher: cut at 24 kHz instead
    const fc = 0.955 * down;                   // cutoff as a fraction of the source's Nyquist frequency
    const hw = Math.ceil(SINC_HW / down), taps = 2 * hw, beta = 7.5, ib = bessel0(beta);
    const w = new Float32Array((SINC_PHASES + 1) * taps);
    for (let p = 0; p <= SINC_PHASES; p++) {
      const frac = p / SINC_PHASES, row = p * taps;
      let sum = 0;
      for (let k = 0; k < taps; k++) {
        const x = k - hw + 1 - frac, u = x / hw;
        if (u <= -1 || u >= 1) continue;
        const v = (x === 0 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x)) * bessel0(beta * Math.sqrt(1 - u * u)) / ib;
        w[row + k] = v; sum += v;
      }
      for (let k = 0; k < taps; k++) w[row + k] /= sum; // unity gain at DC for every phase
    }
    t = { w, taps, hw };
    sincTables.set(sr, t);
    return t;
  }
  /** n samples at 48 kHz from source s; sample i is at source time t0 + (i0 + i) / 48000 (exact integer phase). */
  function resampleTo(s, t0, i0, n) {
    const out = [new Float32Array(n), new Float32Array(n)];
    const l = s.ch[0], r = s.ch[1], len = l.length, sr = s.sr;
    if (sr === AUDIO_SR) {
      const off = Math.round(t0 * sr) + i0 - s.base;
      const lo = Math.max(0, -off), hi = Math.min(n, len - off);
      if (hi > lo) { out[0].set(l.subarray(off + lo, off + hi), lo); out[1].set(r.subarray(off + lo, off + hi), lo); }
      return out;
    }
    const { w, taps, hw } = sincTable(sr);
    const x0 = t0 * sr, X0 = Math.floor(x0), f0 = x0 - X0;
    const L = out[0], R = out[1];
    for (let i = 0; i < n; i++) {
      // position X0 + f0 + (i0 + i)·sr/48000 split into integer and fraction without rounding drift
      const num = (i0 + i) * sr, q = Math.floor(num / AUDIO_SR);
      let fr = f0 + (num - q * AUDIO_SR) / AUDIO_SR, j = X0 + q;
      if (fr >= 1) { fr -= 1; j++; }
      const row = Math.round(fr * SINC_PHASES) * taps, k0 = j - hw + 1 - s.base;
      let a = 0, b = 0;
      if (k0 >= 0 && k0 + taps <= len) {
        for (let k = 0; k < taps; k++) { const wk = w[row + k]; a += wk * l[k0 + k]; b += wk * r[k0 + k]; }
      } else {
        for (let k = 0; k < taps; k++) { const x = k0 + k; if (x < 0 || x >= len) continue; const wk = w[row + k]; a += wk * l[x]; b += wk * r[x]; }
      }
      L[i] = a; R[i] = b;
    }
    return out;
  }
  /**
   * n stereo samples at 48 kHz of media m; sample i is at source time t0 + (i0 + i) / 48000. Every request for
   * one clip passes the clip's in point as t0, so pieces fetched separately join sample-exactly.
   */
  async function decodeSamples(m, t0, i0, n) {
    n = Math.max(1, n);
    const key = fileKey(m);
    if (noSound.has(key)) return null;
    const whole = async () => {
      if (wholeFailed.has(key)) return undefined;
      try { const s = await wholeAudio(m); return s ? resampleTo(s, t0, i0, n) : null; } catch (e) { wholeFailed.add(key); return undefined; }
    };
    const short = isShort(m);
    if (short) { const r = await whole(); if (r !== undefined) return r; } // (else the streaming decoder may still read it)
    const st = await streamFor(m, t0, i0);
    if (st === null) { noSound.add(key); return null; } // the file has no sound
    if (st) {
      try { return await st.read(i0, n); } catch (e) { console.warn('audio stream read failed', m.name, e); }
    }
    if (!short) { const r = await whole(); if (r !== undefined) return r; }
    throw new RenderError(`The sound of “${m.name || 'a clip'}” can’t be decoded by this browser.`);
  }
  IM.decodeSamples = decodeSamples;
  /** 1× clip audio: clip-local samples [i0, i0 + n), silent past the clip's out point. */
  async function plainSamples(it, m, i0, n) {
    const out = [new Float32Array(n), new Float32Array(n)];
    const k = Math.min(n, Math.round((it.srcOut - it.srcIn) * AUDIO_SR) - i0);
    if (k > 0) {
      const ch = await decodeSamples(m, it.srcIn, i0, k);
      if (!ch) return null;
      out[0].set(ch[0]); out[1].set(ch[1]);
    }
    return out;
  }
  /** Pitch-preserving time stretch (WSOLA). rate > 1 = faster/shorter. */
  /**
   * Pitch-preserving time stretch (WSOLA). chans hold the source with `pre` samples of context before the
   * clip's first sample. Grain k is centred on output sample k*Hs and taken around source sample
   * pre + k*Hs*rate, so output time t always plays source time t*rate (within the similarity search).
   */
  function wsola(chans, rate, outLen, pre) {
    pre = pre || 0;
    const sr = AUDIO_SR;
    const inLen = chans[0].length;
    const N = 1920, Hs = N / 2, half = N / 2;
    // Similarity search window. Among the positions that match the previous grain's continuation well
    // (within 8% of the best), the one closest to the exact position wins — good phase alignment for low
    // notes without drifting away from the exact timing.
    const tol = Math.round(sr * 0.012);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    // output is accumulated with `half` samples of lead-in so grain 0 can be centred on sample 0
    const out = chans.map(() => new Float32Array(outLen + N + half));
    const norm = new Float32Array(outLen + N + half);
    const mono = new Float32Array(inLen);
    for (let i = 0; i < inLen; i++) mono[i] = (chans[0][i] + (chans[1] ? chans[1][i] : chans[0][i])) * 0.5;
    let prev = 0;
    const L = Hs;
    const nat0 = (pv) => pv + Hs;
    for (let k = 0; k * Hs - half < outLen; k++) {
      const op = k * Hs;  // index in the lead-in buffer (= output sample k*Hs - half)
      const nominal = Math.round(pre + k * Hs * rate - half);
      let best = nominal;
      if (k > 0 && nat0(prev) >= 0 && nat0(prev) + L < inLen) {
        const nat = prev + Hs;
        // normalised correlation with the natural continuation
        const score = (q, step) => {
          let c = 0, e = 1e-9;
          for (let j = 0; j < L; j += step) { const a = mono[q + j]; c += a * mono[nat + j]; e += a * a; }
          return c / Math.sqrt(e);
        };
        const cand = [];
        let maxS = -Infinity;
        for (let d = -tol; d <= tol; d += 4) {
          const q = nominal + d;
          if (q < 0 || q + L >= inLen) continue;
          const c = score(q, 8);
          cand.push([d, c]);
          if (c > maxS) maxS = c;
        }
        if (cand.length) {
          const thr = maxS - 0.08 * Math.abs(maxS);
          let pick = null;
          for (const [d, c] of cand) if (c >= thr && (!pick || Math.abs(d) < Math.abs(pick[0]))) pick = [d, c];
          // climb to the local peak
          let q = nominal + pick[0], cur = score(q, 2);
          for (let guard = 0; guard < 64; guard++) {
            const up = q + 1 + L < inLen ? score(q + 1, 2) : -Infinity, dn = q - 1 >= 0 ? score(q - 1, 2) : -Infinity;
            if (up > cur && up >= dn) { q++; cur = up; } else if (dn > cur) { q--; cur = dn; } else break;
          }
          best = q;
        }
      }
      for (let c = 0; c < chans.length; c++) {
        const s = chans[c], o = out[c];
        for (let j = 0; j < N; j++) { const idx = best + j; if (idx >= 0 && idx < inLen) o[op + j] += s[idx] * win[j]; }
      }
      for (let j = 0; j < N; j++) norm[op + j] += win[j];
      prev = best;
    }
    return out.map((o) => { const r = new Float32Array(outLen); for (let i = 0; i < outLen; i++) { const n = norm[i + half]; r[i] = n > 1e-3 ? o[i + half] / n : 0; } return r; });
  }
  IM.wsola = wsola;

  /**
   * Audio for a timeline entry in timeline time (length = entry duration), applying speed/reverse.
   * Volume, fades, ducking and effects are applied later by the mixer / live graph.
   */
  async function itemAudio(e) {
    const it = e.item;
    const m = IM.lib.get(it.mediaId);
    if (!m || m.hasAudio === false) return null;
    const sp = it.speed || 1;
    const key = [m.id, it.srcIn.toFixed(5), it.srcOut.toFixed(5), sp, !!it.reverse, it.preservePitch !== false, e.durF, e.dur.toFixed(5)].join('|');
    if (audioCache.has(key)) { const b = audioCache.get(key); audioCache.delete(key); audioCache.set(key, b); return b; }
    const outLen = Math.max(1, Math.round(e.dur * AUDIO_SR));
    let ch;
    if (Math.abs(sp - 1) < 1e-4) {
      ch = await plainSamples(it, m, 0, outLen);
    } else if (it.preservePitch !== false) {
      // time stretching needs a little real audio around the clip (grains are centred on the clip's edges)
      const pre = Math.round(0.08 * AUDIO_SR);
      ch = await decodeSamples(m, it.srcIn, -pre, Math.ceil(e.dur * sp * AUDIO_SR) + 2 * pre);
      if (ch) ch = wsola(ch, sp, outLen, pre);
    } else {
      // varispeed: resample (pitch changes with speed)
      const src = await plainSamples(it, m, 0, Math.ceil(e.dur * sp * AUDIO_SR) + 2);
      if (src) {
        ch = src.map((c) => {
          const r = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) { const x = i * sp, j = Math.floor(x), fr = x - j; const v0 = c[j] || 0, v1 = c[j + 1] || 0; r[i] = v0 + (v1 - v0) * fr; }
          return r;
        });
      }
    }
    if (!ch) return null;
    if (it.reverse) ch.forEach((c) => c.reverse());
    const buf = new AudioBuffer({ length: outLen, numberOfChannels: 2, sampleRate: AUDIO_SR });
    buf.copyToChannel(ch[0], 0); buf.copyToChannel(ch[1] || ch[0], 1);
    audioCache.set(key, buf);
    audioCacheBytes += outLen * 8;
    while (audioCacheBytes > AUDIO_CACHE_MAX && audioCache.size > 1) {
      const k0 = audioCache.keys().next().value;
      audioCacheBytes -= audioCache.get(k0).length * 8;
      audioCache.delete(k0);
    }
    return buf;
  }
  IM.itemAudio = itemAudio;
  /** Samples [i0, i0 + n) of itemAudio(e), fetching only that range for 1× clips (long songs and clips). */
  async function itemSlice(e, i0, n) {
    const it = e.item;
    const m = IM.lib.get(it.mediaId);
    if (!m || m.hasAudio === false) return null;
    n = Math.min(n, Math.max(1, Math.round(e.dur * AUDIO_SR)) - i0);
    if (n <= 0) return null;
    let ch;
    if (Math.abs((it.speed || 1) - 1) < 1e-4 && !it.reverse) ch = await plainSamples(it, m, i0, n);
    else {
      const b = await itemAudio(e);
      ch = b && [b.getChannelData(0).slice(i0, i0 + n), b.getChannelData(1).slice(i0, i0 + n)];
    }
    if (!ch) return null;
    const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: AUDIO_SR });
    buf.copyToChannel(ch[0], 0); buf.copyToChannel(ch[1], 1);
    return buf;
  }

  /** Entries that produce sound. */
  function audibleEntries(L) {
    const out = [];
    for (const e of L.clips) if (e.item.type === 'video' && !e.item.audio.detached) out.push(e);
    for (const e of L.connected) if (e.item.type === 'audio' || (e.item.type === 'video' && !e.item.audio.detached)) out.push(e);
    for (const e of L.music) out.push(e);
    return out;
  }
  IM.audibleEntries = audibleEntries;
  const hasChain = (e) => IM.chainKey(e.item.audio) !== 'flat|none|0';

  const GAIN_STEP = 1 / 100;
  /**
   * Context time of movie sample position s (samples from the context start). Positions on a sample boundary are
   * nudged a hair early so that the browser's time→frame rounding always lands on that very sample.
   */
  const whenOf = (s) => { const r = Math.round(s); return Math.max(0, (Math.abs(s - r) < 1e-6 ? r - 1e-7 : s) / AUDIO_SR); };
  /**
   * Gain automation of entry e (volume, fades, transition crossfades, ducking) for a context that starts at movie
   * time cs: linear between points at e.start + k·GAIN_STEP and the entry's end, whatever the context's extent.
   */
  function scheduleGain(param, p, L, e, dur, cs, ce) {
    const it = e.item;
    const t1 = Math.min(dur, e.end);
    const pt = (k) => {
      const t = e.start + k * GAIN_STEP;
      if (k > 0 && t >= t1) return [t1, IM.itemGain(it, e.dur, e.dur, e) * IM.duckFactor(p, L, t1, it.id)];
      return [t, IM.itemGain(it, t - e.start, e.dur, e) * IM.duckFactor(p, L, t, it.id)];
    };
    let k = 1;
    if (e.start >= cs) {
      param.setValueAtTime(0, 0); // (a gain node starts at 1: nothing may leak from the effect chain before the clip)
      param.setValueAtTime(pt(0)[1], whenOf((e.start - cs) * AUDIO_SR));
    } else {
      // start on the ramp that crosses cs, at the value it has there
      k = Math.max(0, Math.floor((cs - e.start) / GAIN_STEP));
      while (k > 0 && e.start + k * GAIN_STEP > cs) k--;
      while (e.start + (k + 1) * GAIN_STEP <= cs) k++;
      const [ta, va] = pt(k), [tb, vb] = pt(k + 1);
      param.setValueAtTime(tb > ta ? va + (vb - va) * (cs - ta) / (tb - ta) : vb, 0);
      k++;
    }
    for (; ; k++) {
      const [t, v] = pt(k);
      param.linearRampToValueAtTime(v, t - cs);
      if (t >= ce) return;
      if (t >= t1) break;
    }
    // effect tails end with the clip, fading out quickly like the viewer's
    param.setTargetAtTime(0, t1 - cs, 0.012);
  }

  /** Full offline mix of the movie (exactly what the viewer plays). Needs memory for the whole movie. */
  async function mixdown(p, opts) {
    opts = opts || {};
    const L = Pr.layout(p);
    const dur = Math.max(1 / L.fps, L.duration);
    const len = Math.ceil(dur * AUDIO_SR);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, len, AUDIO_SR);
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const entries = audibleEntries(L).filter((e) => e.start < dur);
    let done = 0;
    try {
      for (const e of entries) {
        if (e.item.audio && e.item.audio.mute) continue;
        const buf = await itemAudio(e);
        done++;
        if (opts.onProgress) opts.onProgress(done / Math.max(1, entries.length));
        if (!buf) continue;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        scheduleGain(g.gain, p, L, e, dur, 0, Infinity);
        if (hasChain(e)) { const ch = IM.buildAudioChain(ctx, e.item.audio); src.connect(ch.input); ch.output.connect(g); }
        else src.connect(g);
        g.connect(master);
        src.start(whenOf(e.start * AUDIO_SR), 0, Math.min(dur, e.end) - e.start);
      }
    } finally { closeStreams(); }
    return ctx.startRendering();
  }
  IM.mixdown = mixdown;

  const MIX_WINDOW = 30 * AUDIO_SR; // samples of movie mixed at a time (memory stays bounded for long movies)
  const MIX_PREROLL = 6 * AUDIO_SR; // with effects: echo and room tails carry across window edges
  const MIX_LEAD = 256;             // without: clips that start between two samples settle before the kept part
  /**
   * Samples [A, B) of the movie's mix, the same as those samples of mixdown(): same gains, fades, ducking and
   * effects, every clip's audio on the same sample grid. Rendering starts `pre` samples early; that part is dropped.
   */
  async function mixWindow(p, L, A, B, pre) {
    const dur = Math.max(1 / L.fps, L.duration);
    const CS = Math.max(0, A - pre);
    const cs = CS / AUDIO_SR, ce = B / AUDIO_SR;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.max(1, B - CS), AUDIO_SR);
    const master = ctx.createGain();
    master.connect(ctx.destination);
    for (const e of audibleEntries(L)) {
      const t1 = Math.min(dur, e.end);
      if (e.start >= dur || e.start >= ce || t1 <= cs || (e.item.audio && e.item.audio.mute)) continue;
      // the clip's first sample at or after the context start (sample i always plays at e.start + i / 48000)
      const i0 = e.start >= cs ? 0 : Math.ceil((cs - e.start) * AUDIO_SR - 1e-6);
      const buf = await itemSlice(e, i0, Math.ceil((ce - e.start) * AUDIO_SR) + 2 - i0);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      scheduleGain(g.gain, p, L, e, dur, cs, ce);
      if (hasChain(e)) { const chn = IM.buildAudioChain(ctx, e.item.audio); src.connect(chn.input); chn.output.connect(g); }
      else src.connect(g);
      g.connect(master);
      const at = e.start + i0 / AUDIO_SR;
      src.start(whenOf(e.start * AUDIO_SR + i0 - CS), 0, t1 - at);
    }
    const out = await ctx.startRendering();
    if (A === CS) return out;
    const cut = new AudioBuffer({ length: B - A, numberOfChannels: 2, sampleRate: AUDIO_SR });
    for (let c = 0; c < 2; c++) cut.copyToChannel(out.getChannelData(c).subarray(A - CS, B - CS), c);
    return cut;
  }
  /** Decode a moment of every sound in the movie so that a file the browser can't read fails the share up front. */
  async function checkAudio(p, onProgress) {
    const L = Pr.layout(p);
    const seen = new Set(), list = audibleEntries(L).filter((e) => {
      const m = IM.lib.get(e.item.mediaId);
      if (!m || m.hasAudio === false || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    try {
      for (let i = 0; i < list.length; i++) {
        const it = list[i].item;
        await decodeSamples(IM.lib.get(it.mediaId), it.srcIn, 0, 480);
        if (onProgress) onProgress((i + 1) / list.length);
      }
    } finally { closeStreams(); }
  }
  /** Feed the movie's whole mix to an encoder source, window by window. */
  async function addMovieAudio(p, asrc, onProgress, state) {
    const L = Pr.layout(p);
    const N = Math.ceil(Math.max(1 / L.fps, L.duration) * AUDIO_SR);
    const pre = audibleEntries(L).some(hasChain) ? MIX_PREROLL : MIX_LEAD;
    try {
      for (let A = 0; A < N; A += MIX_WINDOW) {
        if (state && state.cancelled) throw new AbortRender();
        const B = Math.min(N, A + MIX_WINDOW);
        await asrc.add(await mixWindow(p, L, A, B, pre));
        if (onProgress) onProgress(B / N);
      }
    } finally { closeStreams(); }
  }
  IM.mixWindow = mixWindow;
  IM.mixConsts = { AUDIO_SR, MIX_WINDOW, MIX_PREROLL, MIX_LEAD, closeStreams };

  // ------------------------------------------------------------------ export
  const Exporter = {
    running: null,
    /**
     * Export project p. o: {resolution, quality, audioOnly, fileHandle, onProgress(fraction, label), signal}
     * Resolves {blob|null, name, mime, verified, stats}.
     */
    async export(p, o) {
      o = o || {};
      if (this.running) throw new RenderError('Another share is already in progress.');
      const mb = await IM.loadMediabunny();
      if (!mb) throw new RenderError('The media engine failed to load.');
      const state = { cancelled: false };
      this.running = state;
      BG.pause(true);
      const progress = (f, label) => { if (o.onProgress) o.onProgress(clamp(f, 0, 1), label); };
      let output = null, writable = null;
      try {
        await Engine.prepare(p);
        const L = Pr.layout(p);
        if (!L.durationF) throw new RenderError('The movie is empty.');
        if (o.audioOnly) return await this.exportAudioOnly(p, o, mb, progress, state);
        const fmt = await resolveFormat(p, o);
        if (!fmt) return await this.exportRealtime(p, o, progress, state);
        const aCodec = await pickAudioCodec(fmt.container);
        await Cache.load();
        const segs = segmentsFor(p, fmt);
        const refConfig = await Engine.probeConfig(fmt);
        progress(0, 'Preparing audio…');
        if (aCodec) await checkAudio(p, (f) => progress(0.05 * f, 'Preparing audio…'));
        const useHandle = !!(o.fileHandle && fmt.container === 'mp4');
        if (useHandle) writable = await o.fileHandle.createWritable();
        const target = useHandle ? new mb.StreamTarget(writable, { chunked: true }) : new mb.BufferTarget();
        const format = fmt.container === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: useHandle ? false : 'in-memory' }) : new mb.WebMOutputFormat();
        output = new mb.Output({ format, target });
        const vsrc = new mb.EncodedVideoPacketSource(fmt.codec);
        output.addVideoTrack(vsrc, { frameRate: fmt.fps });
        let asrc = null;
        if (aCodec) { asrc = new mb.AudioBufferSource({ codec: aCodec, bitrate: 192000 }); output.addAudioTrack(asrc); }
        await output.start();
        const totalFrames = L.durationF;
        let framesDone = 0, reused = 0, rendered = 0;
        let firstPacket = true;
        const addPackets = async (seg, data) => {
          const base = seg.sF / fmt.fps;
          for (const pk of data.packets) {
            const packet = new mb.EncodedPacket(pk.data, pk.type, base + pk.ts / 1e6, pk.dur / 1e6);
            await vsrc.add(packet, firstPacket ? { decoderConfig: refConfig || data.config } : undefined);
            firstPacket = false;
          }
        };
        for (const seg of segs) {
          if (state.cancelled) throw new AbortRender();
          let data = null;
          if (!o.noCache && Cache.has(seg.key)) {
            data = await Cache.get(seg.key);
            if (data && refConfig && !configsCompatible(data.config, refConfig)) data = null;
            if (data && data.frames !== seg.eF - seg.sF) data = null;
            if (data) reused += seg.eF - seg.sF;
          }
          if (!data) {
            // every section starts from a fresh encoder (as background sections do), so a cached section is
            // bit-identical to what a fresh export would produce
            const session = new EncoderSession(fmt);
            try {
              data = await Engine.encodeSegment(p, seg, fmt, session, { shouldAbort: () => state.cancelled });
            } finally { session.close(); }
            if (refConfig && data.config && !configsCompatible(data.config, refConfig)) {
              throw new RenderError('The video encoder changed its configuration mid-export. Please try again.');
            }
            rendered += seg.eF - seg.sF;
            Cache.put(seg.key, data).catch(() => {});
          }
          await addPackets(seg, data);
          framesDone += seg.eF - seg.sF;
          progress(0.05 + 0.85 * framesDone / totalFrames, 'Rendering…');
        }
        if (asrc) await addMovieAudio(p, asrc, (f) => progress(0.9 + 0.03 * f, 'Encoding audio…'), state);
        vsrc.close(); if (asrc) asrc.close();
        progress(0.93, 'Finishing…');
        await output.finalize();
        const mime = fmt.container === 'mp4' ? 'video/mp4' : 'video/webm';
        let blob = null;
        if (useHandle) blob = await o.fileHandle.getFile();
        else blob = new Blob([output.target.buffer], { type: mime });
        // ---- verification ----
        progress(0.95, 'Verifying…');
        const ver = await Verifier.verify(blob, p, fmt, segs);
        if (!ver.ok && !o.retried) {
          console.warn('Export verification failed; re-rendering affected segments', ver);
          for (const k of ver.badKeys) await Cache.remove(k);
          this.running = null;
          return this.export(p, Object.assign({}, o, { retried: true, noCache: ver.badKeys.length === 0 }));
        }
        progress(1, 'Done');
        return { blob, mime, ext: fmt.container === 'mp4' ? 'mp4' : 'webm', usedHandle: useHandle, verified: ver.ok, verification: ver, stats: { frames: totalFrames, reused, rendered, fmt } };
      } catch (e) {
        // cancelled or failed: leave no half-written movie behind (a picked file keeps its previous contents)
        if (output && output.state !== 'finalized') { try { await output.cancel(); } catch (err) { /* */ } }
        if (writable) { try { await writable.abort(); } catch (err) { /* already closed */ } }
        throw e;
      } finally {
        this.running = null;
        BG.pause(false);
      }
    },
    cancel() { if (this.running) this.running.cancelled = true; },
    async exportAudioOnly(p, o, mb, progress, state) {
      if (state.cancelled) throw new AbortRender();
      const codec = await pickAudioCodec('mp4');
      const mp4 = codec === 'aac';
      const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
      const asrc = new mb.AudioBufferSource({ codec: codec || 'opus', bitrate: 256000 });
      output.addAudioTrack(asrc);
      await output.start();
      await addMovieAudio(p, asrc, (f) => progress(f * 0.95, 'Mixing audio…'), state);
      asrc.close();
      await output.finalize();
      progress(1, 'Done');
      const mime = mp4 ? 'audio/mp4' : 'audio/webm';
      return { blob: new Blob([output.target.buffer], { type: mime }), mime, ext: mp4 ? 'm4a' : 'webm', verified: true, stats: { audioOnly: true } };
    },
    /** Fallback for browsers without WebCodecs encoding: paced real-time capture. */
    async exportRealtime(p, o, progress, state) {
      const L = Pr.layout(p);
      const fps = L.fps;
      const [W, H] = RES[o.resolution || 1080] || RES[1080];
      const r = Engine.getRenderer(W, H);
      const mix = await mixdown(p);
      const stream = r.canvas.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = actx.createMediaStreamDestination();
      stream.addTrack(dest.stream.getAudioTracks()[0]);
      const mime = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      if (!mime) throw new RenderError('This browser can’t export video. Please use a current version of Chrome, Edge or Safari.');
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W * H * fps * 0.14 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      rec.start(1000);
      const src = actx.createBufferSource(); src.buffer = mix; src.connect(dest);
      const t0 = actx.currentTime + 0.1;
      src.start(t0);
      await Engine.renderRange(p, 0, L.durationF, W, H, async (f) => {
        if (state.cancelled) throw new AbortRender();
        const due = t0 + f / fps;
        while (actx.currentTime < due - 0.004) await new Promise((res) => setTimeout(res, 2));
        track.requestFrame();
        progress(f / L.durationF, 'Recording…');
      });
      while (actx.currentTime < t0 + L.duration) await new Promise((res) => setTimeout(res, 20));
      rec.stop(); await done; actx.close();
      const type = mime.split(';')[0];
      return { blob: new Blob(chunks, { type }), mime: type, ext: type === 'video/mp4' ? 'mp4' : 'webm', verified: false, stats: { realtime: true } };
    },
    /** Render a single frame at time t as an image blob (Share > Image). */
    async exportImage(p, t, o) {
      o = o || {};
      await Engine.prepare(p);
      const L = Pr.layout(p);
      const f = clamp(Pr.frameAt(p, t), 0, Math.max(0, L.durationF - 1));
      const [W, H] = RES[o.resolution || 1080] || RES[1080];
      let blob = null;
      await Engine.renderRange(p, f, f + 1, W, H, async (ff, canvas) => {
        blob = await new Promise((res) => canvas.toBlob(res, o.type || 'image/jpeg', 0.95));
      });
      return blob;
    },
  };
  IM.Exporter = Exporter;

  // ------------------------------------------------------------------ verification
  const Verifier = {
    async verify(blob, p, fmt, segs) {
      const res = { ok: true, checks: [], badKeys: [] };
      try {
        const mb = await IM.loadMediabunny();
        const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
        const vt = await input.getPrimaryVideoTrack();
        if (!vt) return { ok: false, checks: ['no video track'], badKeys: [] };
        const L = Pr.layout(p);
        const stats = await vt.computePacketStats();
        res.frames = stats.packetCount;
        if (stats.packetCount !== L.durationF) { res.ok = false; res.checks.push(`frame count ${stats.packetCount} ≠ ${L.durationF}`); }
        if (!(await vt.canDecode())) { res.checks.push('decode check skipped (codec not decodable here)'); return res; }
        const sink = new mb.CanvasSink(vt, { width: 96, height: 54, fit: 'fill', poolSize: 2 });
        // choose frames: first & last frame + middle of up to 8 segments
        // first/last frame of the movie, plus the boundaries (where sections are spliced) and middle of sections
        const picks = new Set([0, L.durationF - 1]);
        const step = Math.max(1, Math.floor(segs.length / 10));
        for (let i = 0; i < segs.length; i += step) {
          picks.add(segs[i].sF); picks.add(segs[i].eF - 1);
          picks.add(Math.floor((segs[i].sF + segs[i].eF - 1) / 2));
        }
        const frames = Array.from(picks).filter((f) => f >= 0).sort((a, b) => a - b);
        const small = document.createElement('canvas'); small.width = 96; small.height = 54;
        const sctx = small.getContext('2d', { willReadFrequently: true });
        const dec = document.createElement('canvas'); dec.width = 96; dec.height = 54;
        const gctx = dec.getContext('2d', { willReadFrequently: true });
        for (const f of frames) {
          const got = await sink.getCanvas((f + 0.5) / fmt.fps);
          if (!got) { res.ok = false; res.checks.push(`frame ${f} missing`); continue; }
          gctx.clearRect(0, 0, 96, 54);
          gctx.drawImage(got.canvas, 0, 0, 96, 54);
          const a = gctx.getImageData(0, 0, 96, 54).data;
          // render the expected frame and its neighbours: the decoded frame must match frame f best
          const lo = Math.max(0, f - 1), hi = Math.min(L.durationF, f + 2);
          const exp = new Map();
          await Engine.renderRange(p, lo, hi, fmt.W, fmt.H, async (ff, canvas) => {
            sctx.drawImage(canvas, 0, 0, 96, 54);
            exp.set(ff, sctx.getImageData(0, 0, 96, 54).data);
          });
          const psnr = psnrOf(a, exp.get(f));
          let offByOne = false;
          for (const [ff, d] of exp) if (ff !== f && psnr < 40 && psnrOf(a, d) > psnr + 1.5) offByOne = true;
          res.checks.push({ frame: f, psnr: Math.round(psnr * 10) / 10, offByOne });
          if (psnr < 24 || offByOne) {
            res.ok = false;
            const seg = segs.find((s) => f >= s.sF && f < s.eF);
            if (seg) res.badKeys.push(seg.key);
          }
        }
        if (input.dispose) input.dispose();
      } catch (e) {
        console.warn('verification error', e);
        res.checks.push('verification error: ' + e.message);
      }
      return res;
    },
  };
  function psnrOf(a, b) {
    let se = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; se += d * d; n++; }
    }
    const mse = se / Math.max(1, n);
    return mse < 1e-6 ? 99 : 10 * Math.log10(255 * 255 / mse);
  }
  IM.Verifier = Verifier;

  // ------------------------------------------------------------------ background pre-rendering
  const BG = {
    enabled: true,
    paused: false,
    active: false,
    lastInput: performance.now(),
    status: { done: 0, total: 0, rendering: false },
    fmt: null,
    init() {
      const bump = () => { this.lastInput = performance.now(); };
      ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, bump, { capture: true, passive: true }));
      IM.bus.on('project-changed', () => this.kick());
      IM.bus.on('project-opened', () => this.kick());
      setInterval(() => this.kick(), 3000);
    },
    idle() {
      const pl = IM.app.player;
      return this.enabled && !this.paused && !Exporter.running && IM.app.view === 'editor' && !!IM.app.project &&
        document.visibilityState === 'visible' && !(pl && pl.isPlaying()) && performance.now() - this.lastInput > 1800;
    },
    pause(on) { this.paused = on; if (!on) this.kick(); },
    kick() {
      if (this.active || !this.idle()) { this.updateStatus(); return; }
      this.active = true;
      this.run().catch((e) => { if (!(e instanceof AbortRender)) console.warn('background render stopped', e); }).finally(() => { this.active = false; this.status.rendering = false; this.emit(); });
    },
    async format(p) {
      const o = Object.assign({ resolution: 1080, quality: 'high' }, IM.prefs.shareFile || {});
      const key = [Pr.fps(p), o.resolution, o.quality].join(':');
      if (!this.fmt || this.fmtKey !== key) { this.fmt = await resolveFormat(p, o); this.fmtKey = key; }
      return this.fmt;
    },
    async run() {
      await Cache.load();
      for (;;) {
        const p = IM.app.project;
        if (!p || !this.idle()) return;
        const fmt = await this.format(p);
        if (!fmt) return;
        const segs = segmentsFor(p, fmt);
        this.status.total = segs.length;
        this.status.done = segs.filter((s) => Cache.has(s.key)).length;
        const todo = segs.find((s) => !Cache.has(s.key));
        if (!todo) { this.status.rendering = false; this.emit(); return; }
        this.status.rendering = true;
        this.emit();
        const version = p.version;
        try {
          await Engine.prepare(p);
          const session = new EncoderSession(fmt);
          try {
            const data = await Engine.encodeSegment(p, todo, fmt, session, {
              background: true,
              // stop at the next frame when the user is back, the movie changed, or a foreground render waits
              shouldAbort: () => !this.idle() || IM.app.project !== p || p.version !== version || RenderLock.fgWaiting > 0,
            });
            await Cache.put(todo.key, data);
          } finally { session.close(); }
        } catch (e) {
          if (e instanceof AbortRender) return;
          throw e;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    updateStatus() {
      const p = IM.app.project;
      if (!p || !this.fmt) return;
      const segs = segmentsFor(p, this.fmt);
      this.status.total = segs.length;
      this.status.done = segs.filter((s) => Cache.has(s.key)).length;
      this.emit();
    },
    emit() { IM.bus.emit('bg-render', Object.assign({}, this.status)); },
  };
  IM.BackgroundRender = BG;
  IM.segmentsFor = segmentsFor;
  IM.resolveFormat = resolveFormat;
})(window.IM = window.IM || {});
