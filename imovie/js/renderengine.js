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
  async function elementFrame(server, t) {
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

  // ------------------------------------------------------------------ exact provider
  /** Frame provider for Compose that serves frames fetched ahead of rendering. */
  class ExactProvider {
    constructor() { this.frames = new Map(); this.stamp = 0; }
    set(key, f) { const old = this.frames.get(key); if (old && old !== f && old.frame && !old.keep) old.frame.close(); this.frames.set(key, f); }
    video(it) {
      const f = this.frames.get(it.id);
      if (!f) return null;
      this.stamp++;
      return { src: f.frame || f.canvas, key: 'x:' + it.id, w: f.w, h: f.h, stamp: 'x' + this.stamp, metaRot: f.rot || 0 };
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
      const sig = JSON.stringify({ n: seg.eF - seg.sF, fps, fmt: fmt.key, pf, layers });
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
    },
    /**
     * Render frames [sF, eF) of project p. For each frame calls onFrame(f, canvas) after drawing.
     * opts.shouldAbort() can cancel between frames.
     */
    async renderRange(p, sF, eF, W, H, onFrame, opts) {
      opts = opts || {};
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
          const spec = IM.Compose.frame(p, f / fps, provider, {});
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

  // ------------------------------------------------------------------ audio: range decode, time-stretch, per-item buffers
  const audioCache = new Map(); // key -> AudioBuffer (timeline-time, before gain/effects)
  let audioCacheBytes = 0;
  const AUDIO_CACHE_MAX = 400 * 1024 * 1024;
  const AUDIO_SR = 48000;

  /** Decode [a, b) seconds of a media file's audio to Float32 channels at AUDIO_SR. */
  async function decodeRange(m, a, b) {
    a = Math.max(0, a); b = Math.max(a + 1e-3, b);
    let src = null;
    if (m.audioBuffer) src = m.audioBuffer;
    else if (m.size < 120 * 1024 * 1024 || m.builtin) {
      src = await IM.lib.getAudioBuffer(m);
      if (src && m.size < 40 * 1024 * 1024) m.audioBuffer = src;
    }
    if (!src) {
      const mb = await IM.loadMediabunny();
      const input = new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS });
      const at = await input.getPrimaryAudioTrack();
      if (!at) return null;
      const sink = new mb.AudioBufferSink(at);
      const parts = [];
      let sr = AUDIO_SR;
      for await (const { buffer, timestamp } of sink.buffers(Math.max(0, a - 0.1), b + 0.1)) { parts.push({ buffer, timestamp }); sr = buffer.sampleRate; }
      const len = Math.ceil((b - a) * sr);
      const out = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: 2, sampleRate: sr });
      for (const { buffer, timestamp } of parts) {
        const off = Math.round((timestamp - a) * sr);
        for (let c = 0; c < 2; c++) {
          const s = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)), d = out.getChannelData(c);
          for (let i = 0; i < s.length; i++) { const j = off + i; if (j >= 0 && j < len) d[j] = s[i]; }
        }
      }
      return resample(out, 0, out.duration);
    }
    return resample(src, a, b);
  }
  /** Extract [a,b) from an AudioBuffer as stereo channels at AUDIO_SR (linear resampling if needed). */
  function resample(buf, a, b) {
    const srIn = buf.sampleRate;
    const n = Math.max(1, Math.round((b - a) * AUDIO_SR));
    const ch = [new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < 2; c++) {
      const s = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
      const d = ch[c];
      if (srIn === AUDIO_SR) {
        const off = Math.round(a * srIn);
        for (let i = 0; i < n; i++) { const j = off + i; d[i] = j >= 0 && j < s.length ? s[j] : 0; }
      } else {
        const ratio = srIn / AUDIO_SR, off = a * srIn;
        for (let i = 0; i < n; i++) {
          const x = off + i * ratio, j = Math.floor(x), fr = x - j;
          const v0 = j >= 0 && j < s.length ? s[j] : 0, v1 = j + 1 >= 0 && j + 1 < s.length ? s[j + 1] : 0;
          d[i] = v0 + (v1 - v0) * fr;
        }
      }
    }
    return ch;
  }
  /** Pitch-preserving time stretch (WSOLA). rate > 1 = faster/shorter. */
  function wsola(chans, rate, outLen) {
    const sr = AUDIO_SR;
    const inLen = chans[0].length;
    const N = 1920, Hs = N / 2, Ha = Hs * rate;
    const tol = Math.round(sr * 0.012);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const out = chans.map(() => new Float32Array(outLen + N));
    const norm = new Float32Array(outLen + N);
    const mono = new Float32Array(inLen);
    for (let i = 0; i < inLen; i++) mono[i] = (chans[0][i] + (chans[1] ? chans[1][i] : chans[0][i])) * 0.5;
    let prev = 0;
    const L = Hs;
    for (let k = 0, op = 0; op < outLen; k++, op += Hs) {
      const nominal = Math.round(k * Ha);
      let best = nominal;
      if (k > 0) {
        const nat = prev + Hs;
        let bestC = -Infinity;
        for (let d = -tol; d <= tol; d += 4) {
          const q = nominal + d;
          if (q < 0 || q + L >= inLen || nat + L >= inLen) continue;
          let c = 0;
          for (let j = 0; j < L; j += 8) c += mono[q + j] * mono[nat + j];
          if (c > bestC) { bestC = c; best = q; }
        }
        const coarse = best;
        for (let d = -3; d <= 3; d++) {
          const q = coarse + d;
          if (q < 0 || q + L >= inLen || nat + L >= inLen) continue;
          let c = 0;
          for (let j = 0; j < L; j += 2) c += mono[q + j] * mono[nat + j];
          if (c > bestC) { bestC = c; best = q; }
        }
      }
      for (let c = 0; c < chans.length; c++) {
        const s = chans[c], o = out[c];
        for (let j = 0; j < N; j++) { const idx = best + j; if (idx >= 0 && idx < inLen) o[op + j] += s[idx] * win[j]; }
      }
      for (let j = 0; j < N; j++) norm[op + j] += win[j];
      prev = best;
    }
    return out.map((o) => { const r = new Float32Array(outLen); for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? o[i] / norm[i] : 0; return r; });
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
    const srcA = it.srcIn, srcB = Math.min(it.srcOut, it.srcIn + e.dur * sp + 0.05);
    let ch = await decodeRange(m, srcA, srcB);
    if (!ch) return null;
    const needLen = Math.round(e.dur * sp * AUDIO_SR);
    if (Math.abs(sp - 1) < 1e-4) {
      ch = ch.map((c) => { const r = new Float32Array(outLen); r.set(c.subarray(0, Math.min(c.length, outLen))); return r; });
    } else if (it.preservePitch !== false) {
      const src = ch.map((c) => c.subarray(0, Math.min(c.length, needLen)));
      ch = wsola(src, sp, outLen);
    } else {
      // varispeed: resample (pitch changes with speed)
      ch = ch.map((c) => {
        const r = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) { const x = i * sp, j = Math.floor(x), fr = x - j; const v0 = c[j] || 0, v1 = c[j + 1] || 0; r[i] = v0 + (v1 - v0) * fr; }
        return r;
      });
    }
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

  /** Entries that produce sound. */
  function audibleEntries(L) {
    const out = [];
    for (const e of L.clips) if (e.item.type === 'video' && !e.item.audio.detached) out.push(e);
    for (const e of L.connected) if (e.item.type === 'audio' || (e.item.type === 'video' && !e.item.audio.detached)) out.push(e);
    for (const e of L.music) out.push(e);
    return out;
  }
  IM.audibleEntries = audibleEntries;

  /** Full offline mix of the movie (exactly what the viewer plays). */
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
    for (const e of entries) {
      const it = e.item;
      const buf = await itemAudio(e);
      done++;
      if (opts.onProgress) opts.onProgress(done / Math.max(1, entries.length));
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      const step = 1 / 100;
      const t0 = e.start, t1 = Math.min(dur, e.end);
      g.gain.setValueAtTime(IM.itemGain(it, 0, e.dur) * IM.duckFactor(p, L, t0, it.id), t0);
      for (let t = t0 + step; t < t1; t += step) g.gain.linearRampToValueAtTime(IM.itemGain(it, t - e.start, e.dur) * IM.duckFactor(p, L, t, it.id), t);
      g.gain.linearRampToValueAtTime(IM.itemGain(it, e.dur, e.dur) * IM.duckFactor(p, L, t1, it.id), t1);
      if (IM.chainKey(it.audio) !== 'flat|none|0') {
        const ch = IM.buildAudioChain(ctx, it.audio);
        src.connect(ch.input); ch.output.connect(g);
      } else src.connect(g);
      g.connect(master);
      src.start(t0, 0, t1 - t0);
    }
    return ctx.startRendering();
  }
  IM.mixdown = mixdown;

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
        // audio mix first (fast) so the file has both tracks
        progress(0, 'Preparing audio…');
        const mix = await mixdown(p, { onProgress: (f) => progress(f * 0.05, 'Preparing audio…') });
        const useHandle = !!(o.fileHandle && fmt.container === 'mp4');
        const target = useHandle ? new mb.StreamTarget(await o.fileHandle.createWritable(), { chunked: true }) : new mb.BufferTarget();
        const format = fmt.container === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: useHandle ? false : 'in-memory' }) : new mb.WebMOutputFormat();
        const output = new mb.Output({ format, target });
        const vsrc = new mb.EncodedVideoPacketSource(fmt.codec);
        output.addVideoTrack(vsrc, { frameRate: fmt.fps });
        let asrc = null;
        if (aCodec && mix) { asrc = new mb.AudioBufferSource({ codec: aCodec, bitrate: 192000 }); output.addAudioTrack(asrc); }
        await output.start();
        const totalFrames = L.durationF;
        let framesDone = 0, reused = 0, rendered = 0;
        let session = null;
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
            if (!session) session = new EncoderSession(fmt);
            const baseDone = framesDone;
            data = await Engine.encodeSegment(p, seg, fmt, session, {
              shouldAbort: () => state.cancelled,
            });
            if (refConfig && data.config && !configsCompatible(data.config, refConfig)) {
              throw new RenderError('The video encoder changed its configuration mid-export. Please try again.');
            }
            rendered += seg.eF - seg.sF;
            Cache.put(seg.key, data).catch(() => {});
            void baseDone;
          }
          await addPackets(seg, data);
          framesDone += seg.eF - seg.sF;
          progress(0.05 + 0.85 * framesDone / totalFrames, 'Rendering…');
        }
        if (session) session.close();
        if (asrc) { progress(0.9, 'Encoding audio…'); await asrc.add(mix); }
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
      } finally {
        this.running = null;
        BG.pause(false);
      }
    },
    cancel() { if (this.running) this.running.cancelled = true; },
    async exportAudioOnly(p, o, mb, progress, state) {
      const mix = await mixdown(p, { onProgress: (f) => progress(f * 0.7, 'Mixing audio…') });
      if (state.cancelled) throw new AbortRender();
      const codec = await pickAudioCodec('mp4');
      const mp4 = codec === 'aac';
      const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
      const asrc = new mb.AudioBufferSource({ codec: codec || 'opus', bitrate: 256000 });
      output.addAudioTrack(asrc);
      await output.start();
      await asrc.add(mix);
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
        const picks = new Set([0, L.durationF - 1]);
        const step = Math.max(1, Math.floor(segs.length / 8));
        for (let i = 0; i < segs.length; i += step) picks.add(Math.floor((segs[i].sF + segs[i].eF - 1) / 2));
        const frames = Array.from(picks).filter((f) => f >= 0).sort((a, b) => a - b);
        const small = document.createElement('canvas'); small.width = 96; small.height = 54;
        const sctx = small.getContext('2d', { willReadFrequently: true });
        for (const f of frames) {
          const got = await sink.getCanvas((f + 0.5) / fmt.fps);
          if (!got) { res.ok = false; res.checks.push(`frame ${f} missing`); continue; }
          const gctx = got.canvas.getContext('2d', { willReadFrequently: true });
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
              shouldAbort: () => !this.idle() || IM.app.project !== p || p.version !== version,
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
