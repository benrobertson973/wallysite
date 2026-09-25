/* Timeline — canvas-rendered, modeled closely on iMovie 10's magnetic timeline */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;
  const clamp = IM.clamp;

  const PAD_L = 16;          // left padding before time 0
  const WELL_H = 38;         // background music well height
  const TOP_MARGIN = 30;     // free space above the top lane (for dropping titles / cutaways)
  const TITLE_H = 21;
  const EDGE = 6;            // trim handle hit width
  const GAP = 1;             // half gap between adjacent primary clips

  const COL = {
    bg: '#282828', wellBg: '#1e1e1e', wellLine: '#101010',
    clipEdge: 'rgba(0,0,0,0.6)', placeholder: '#151515',
    blueBg: '#1c3b60', blueWave: '#4d8ee0', blueWaveHi: '#7fb3f5',
    greenBg: '#1b4722', greenWave: '#4cb857', greenWaveHi: '#8fe097',
    purpleBg: '#35265c', purpleWave: '#9274dd', purpleWaveHi: '#bba6f5',
    title: '#6e51c5', titleHi: '#8d74e0', titleText: '#ffffff',
    sel: '#f8c63c', playhead: '#ffffff', skimmer: '#ff3b30',
    trans: '#555555', transHi: '#6c6c6c', glyph: '#e9e9e9',
    yellow: '#ffd60a', red: '#ff453a', text: '#e6e6e6', dim: '#7c7c7c',
  };

  // custom cursors (iMovie style trim cursors)
  const cur = (svg, x, y, fb) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${x} ${y}, ${fb}`;
  const CURSORS = {
    trimStart: cur('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g stroke="#000" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M9 5v14M9 5h3M9 19h3M4 12h13M14 9l3 3-3 3"/></g><g stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M9 5v14M9 5h3M9 19h3M4 12h13M14 9l3 3-3 3"/></g></svg>', 9, 12, 'ew-resize'),
    trimEnd: cur('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g stroke="#000" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M15 5v14M15 5h-3M15 19h-3M20 12H7M10 9l-3 3 3 3"/></g><g stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M15 5v14M15 5h-3M15 19h-3M20 12H7M10 9l-3 3 3 3"/></g></svg>', 15, 12, 'ew-resize'),
    volume: cur('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g stroke="#000" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M12 4v16M8.5 7.5 12 4l3.5 3.5M8.5 16.5 12 20l3.5-3.5M5 12h14"/></g><g stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M12 4v16M8.5 7.5 12 4l3.5 3.5M8.5 16.5 12 20l3.5-3.5M5 12h14"/></g></svg>', 12, 12, 'ns-resize'),
    range: cur('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g stroke="#000" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M6 5v14M18 5v14M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3"/></g><g stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M6 5v14M18 5v14M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3"/></g></svg>', 12, 12, 'col-resize'),
  };

  // volume <-> vertical position (dB scale: bottom -60dB, 0dB at 83%, top +12dB)
  const volToFrac = (v) => (v <= 0.001 ? 0 : clamp((20 * Math.log10(v) + 60) / 72, 0, 1));
  const fracToVol = (f) => (f <= 0.005 ? 0 : clamp(Math.pow(10, (f * 72 - 60) / 20), 0, 4));
  IM.volToFrac = volToFrac; IM.fracToVol = fracToVol;

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function audioColors(it, where) {
    if (it.type === 'audio') {
      if (it._voiceover || (IM.lib.get(it.mediaId) || {}).source === 'voiceover' || it._detached || isDetached(it)) return ['purpleBg', 'purpleWave', 'purpleWaveHi'];
      return ['greenBg', 'greenWave', 'greenWaveHi'];
    }
    return ['blueBg', 'blueWave', 'blueWaveHi'];
  }
  function isDetached(it) {
    const m = IM.lib.get(it.mediaId);
    return !!(m && m.kind === 'video');
  }

  // small cached thumbnails for backgrounds / title clips
  const stillCache = new Map();
  function stillFor(it) {
    let key;
    if (it.type === 'bg') key = 'bg:' + it.bgId + ':' + (it.bg ? it.bg.color1 + it.bg.color2 : '');
    else if (it.type === 'title') key = 'title:' + it.title.style + ':' + (it.title.text || []).join('|') + ':' + it.title.color + it.title.font;
    else return null;
    let c = stillCache.get(key);
    if (c) return c;
    const r = IM.thumbRenderer();
    if (!r) return null;
    let spec;
    if (it.type === 'bg') {
      const e = { item: it, start: 0, end: 4, dur: 4 };
      spec = { base: IM.Compose.layer(e, 1.2, IM.stillProvider, true), overlays: [], titles: [], time: 1.2 };
    } else {
      const d = Pr.dur(it);
      spec = { base: { kind: 'black' }, overlays: [], titles: [{ title: it.title, local: IM.titleRestTime(it.title, d), dur: d, opacity: 1 }], time: 0 };
    }
    try { r.render(spec); } catch (e) { return null; }
    c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    c.getContext('2d').drawImage(r.canvas, 0, 0, 160, 90);
    stillCache.set(key, c);
    if (stillCache.size > 200) stillCache.delete(stillCache.keys().next().value);
    return c;
  }

  const TL = {
    // ------------------------------------------------------------------ setup
    init(host) {
      this.host = host;
      this.el = h('div.timeline');
      host.appendChild(this.el);
      this.timeEl = h('div.tl-time');
      this.settingsBtn = h('button.tl-settings', { on: { click: (e) => this.settingsPopover(e.currentTarget) } }, 'Settings');
      this.header = h('div.tl-header', this.timeEl, h('div', { style: { flex: '1' } }), this.settingsBtn);
      this.scroller = h('div.tl-scroll');
      this.canvas = h('canvas.tl-canvas');
      this.sizer = h('div.tl-sizer');
      this.scroller.append(this.canvas, this.sizer);
      this.empty = h('div.tl-empty', 'Drag and drop video clips and photos from the browser above to start creating your movie.');
      this.body = h('div.tl-body', this.scroller, this.empty);
      this.el.append(this.header, this.body);
      this.ctx = this.canvas.getContext('2d');
      this.dx = new Map();       // displayed offsets (animation)
      this.dxTarget = new Map();
      this.hover = null;
      this.drag = null;
      this.ext = null;          // external drag feedback
      this.range = null;        // {id, t0, t1}
      this.rKey = false;
      this.hovering = false;
      this.pointer = null;
      this.lastUserScroll = 0;

      this.scroller.addEventListener('scroll', () => { this.lastUserScroll = performance.now(); this.redraw(); });
      this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      this.canvas.addEventListener('pointermove', (e) => this.onHover(e));
      this.canvas.addEventListener('pointerleave', () => this.onLeave());
      this.canvas.addEventListener('dblclick', (e) => this.onDbl(e));
      this.canvas.addEventListener('contextmenu', (e) => this.onContext(e));
      this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      window.addEventListener('keydown', (e) => { if (IM.eventKey(e) === 'r' && !IM.isTyping(e) && !e.metaKey && !e.ctrlKey) { this.rKey = true; this.updateCursor(); } });
      window.addEventListener('keyup', (e) => { if (IM.eventKey(e) === 'r') { this.rKey = false; this.updateCursor(); } });
      window.addEventListener('blur', () => { this.rKey = false; });

      new ResizeObserver(() => this.resize()).observe(this.body);
      IM.bus.on('project-changed', () => { this.redraw(); this.updateEmpty(); });
      IM.bus.on('project-live', () => this.redraw());
      IM.bus.on('project-opened', () => { this.dx.clear(); this.dxTarget.clear(); this.range = null; this.fitInitial(); this.updateEmpty(); this.redraw(); });
      IM.bus.on('selection', () => this.redraw());
      IM.bus.on('prefs', () => this.redraw());
      IM.lib.on('thumbs', () => this.redraw());
      IM.lib.on('peaks', () => this.redraw());
      IM.bus.on('added', (ids) => this.revealItems(ids));
      app.player.on('time', (t) => { this.updateTime(); this.autoScroll(t); this.redraw(); });
      app.player.on('skim', () => { this.updateTime(); this.redraw(); });
      app.player.on('play', () => this.redraw());
    },
    get p() { return app.project; },
    get pps() { return this.p ? (this.p.settings.zoom || 40) : 40; },
    set pps(v) { if (this.p) this.p.settings.zoom = clamp(v, 1.5, 800); },
    resize() {
      const w = this.scroller.clientWidth, hh = this.scroller.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = w; this.H = hh; this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(hh * dpr));
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = hh + 'px';
      this.redraw(true);
    },
    updateEmpty() { this.empty.classList.toggle('hidden', !!(this.p && (this.p.clips.length || this.p.music.length))); },
    fitInitial() {
      const p = this.p;
      if (!p) return;
      if (!p.settings.zoomSet) {
        const d = Pr.duration(p);
        if (d > 0 && this.W) this.pps = clamp((this.W - PAD_L - 120) / d, 4, 120);
      }
      this.scroller.scrollLeft = 0;
      this.scroller.scrollTop = 0;
    },
    updateTime() {
      const pl = app.player;
      const t = pl.skimT != null && !pl.playing && this.hovering ? pl.skimT : pl.t;
      const d = this.p ? Pr.duration(this.p) : 0;
      this.timeEl.innerHTML = `<span class="cur">${IM.fmtTime(t)}</span><span class="sep"> / </span><span class="tot">${IM.fmtTime(d)}</span>`;
    },

    // ------------------------------------------------------------------ geometry
    sizes() {
      const cs = this.p ? this.p.settings.clipSize : 0.35;
      const vh = Math.round(34 + 78 * clamp(cs == null ? 0.35 : cs, 0, 1));
      const wave = !this.p || this.p.settings.waveforms !== false;
      const ah = wave ? Math.max(16, Math.round(vh * 0.42)) : 0;
      const audH = wave ? Math.max(24, Math.round(vh * 0.5)) : 20;
      return { vh, ah, audH, tw: Math.round(vh * 16 / 9) };
    },
    tx(t) { return PAD_L + t * this.pps; },
    xt(x) { return (x - PAD_L) / this.pps; },
    geom() {
      const p = this.p;
      const S = this.sizes();
      const L = Pr.layout(p);
      const G = { S, L, clips: [], conn: [], music: [], trans: [], byId: new Map() };
      // lanes
      const laneKind = new Map();
      for (const e of L.connected) {
        const k = laneKind.get(e.lane) || { video: false, title: false, audio: false };
        if (e.item.type === 'title') k.title = true; else if (e.item.type === 'audio') k.audio = true; else k.video = true;
        laneKind.set(e.lane, k);
      }
      const laneH = (lane) => {
        const k = laneKind.get(lane);
        if (lane < 0) return S.audH + 6;
        if (!k) return TITLE_H + 6;
        if (k.video) return S.vh + (S.ah ? Math.round(S.ah * 0.6) : 0) + 6;
        return TITLE_H + 6;
      };
      // the committed layout stays fixed while dragging (previews for new lanes draw in the free space)
      const maxAbove = L.above;
      const maxBelow = L.below;
      G.laneY = new Map(); G.laneH = new Map();
      let y = TOP_MARGIN;
      for (let lane = maxAbove; lane >= 1; lane--) { G.laneY.set(lane, y); G.laneH.set(lane, laneH(lane)); y += laneH(lane); }
      G.primY = y + 4;
      G.primH = S.vh + S.ah;
      y = G.primY + G.primH + 8;
      for (let lane = -1; lane >= -maxBelow; lane--) { G.laneY.set(lane, y); G.laneH.set(lane, laneH(lane)); y += laneH(lane); }
      G.contentH = y + 40;
      G.maxAbove = maxAbove; G.maxBelow = maxBelow;
      // primary clips
      for (const e of L.clips) {
        const off = this.dx.get(e.item.id) || 0;
        const x0 = this.tx(e.visStart) + off + GAP, x1 = this.tx(e.visEnd) + off - GAP;
        const g = { e, item: e.item, where: 'primary', x0, x1, startX: this.tx(e.start) + off, y: G.primY, vh: S.vh, ah: S.ah, off };
        const hasA = S.ah > 0 && e.item.type === 'video' && !e.item.audio.detached && Pr.hasAudio(e.item);
        g.hasAudio = hasA;
        g.h = S.vh + (S.ah && (hasA || e.item.type === 'video') ? S.ah : 0);
        if (e.item.type !== 'video') g.h = S.vh;
        G.clips.push(g); G.byId.set(e.item.id, g);
      }
      // transitions
      for (let i = 0; i < G.clips.length - 1; i++) {
        const g = G.clips[i];
        if (!g.item.transition || !g.e.trOut) continue;
        const x = (g.x1 + G.clips[i + 1].x0) / 2;
        const w = Math.max(18, Math.min(26, S.vh * 0.4)), hh = Math.round(w * 0.72);
        G.trans.push({ clip: g.item, x, y: G.primY + S.vh / 2 - hh / 2, w, h: hh, dur: g.e.trOut });
      }
      // connected
      for (const e of L.connected) {
        const a = G.byId.get(e.item.anchorId);
        const off = a ? a.off : 0;
        const lane = e.lane;
        const ly = G.laneY.get(lane);
        const lh = G.laneH.get(lane) - 6;
        const it = e.item;
        const g = { e, item: it, where: 'connected', x0: this.tx(e.start) + off, x1: this.tx(e.end) + off, lane, y: ly, off, anchor: a };
        g.startX = g.x0;
        if (it.type === 'title') { g.kind = 'title'; g.y = ly + lh - TITLE_H; g.h = TITLE_H; }
        else if (it.type === 'audio') { g.kind = 'audio'; g.h = S.audH; }
        else {
          g.kind = 'video'; g.vh = S.vh; g.hasAudio = S.ah > 0 && it.type === 'video' && !it.audio.detached && Pr.hasAudio(it);
          g.ah = g.hasAudio ? Math.round(S.ah * 0.6) : 0; g.h = g.vh + g.ah; g.y = ly + lh - g.h;
        }
        G.conn.push(g); G.byId.set(it.id, g);
      }
      // music well
      const wy = this.H - WELL_H + 5;
      for (const e of L.music) {
        const off = this.dx.get(e.item.id) || 0;
        const g = { e, item: e.item, where: 'music', x0: this.tx(e.start) + off + GAP, x1: this.tx(e.end) + off - GAP, y: wy, h: WELL_H - 10, well: true, off };
        g.startX = this.tx(e.start) + off;
        G.music.push(g); G.byId.set(e.item.id, g);
      }
      G.contentW = this.tx(Math.max(L.totalEnd, L.duration)) + Math.max(300, this.W * 0.6);
      return G;
    },

    // ------------------------------------------------------------------ drawing
    redraw(sync) {
      if (sync) { this._draw(); return; }
      if (this._rafPending) return;
      this._rafPending = true;
      requestAnimationFrame(() => { this._rafPending = false; this._draw(); });
    },
    _draw() {
      const ctx = this.ctx;
      if (!this.W || !ctx) return;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, this.W, this.H);
      if (!this.p) return;
      this.stepAnimation();
      const G = this.G = this.geom();
      this.sizer.style.width = Math.ceil(G.contentW) + 'px';
      this.sizer.style.height = Math.ceil(G.contentH + WELL_H) + 'px';
      const sl = this.scroller.scrollLeft, st = this.scroller.scrollTop;
      this.viewL = sl; this.viewR = sl + this.W;
      const trackH = this.H - WELL_H;
      // ---- tracks (clipped above the well) ----
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, this.W, trackH); ctx.clip();
      ctx.translate(-sl, -st);
      const L = G.L;
      // end of movie shading for things past the end
      const dragIds = this.drag && this.drag.kind === 'move' ? new Set(this.drag.ids) : null;
      // connected (below first so titles etc overlay properly)
      for (const g of G.conn) if (!(dragIds && dragIds.has(g.item.id) && this.drag.hideOriginal)) this.drawConnected(ctx, g, G);
      for (const g of G.clips) if (!(dragIds && dragIds.has(g.item.id) && this.drag.hideOriginal)) this.drawPrimary(ctx, g, G);
      for (const tr of G.trans) this.drawTransition(ctx, tr);
      // connection lines for selected connected items
      for (const g of G.conn) if (app.sel.ids.includes(g.item.id) && g.anchor) this.drawConnection(ctx, g, G);
      // range selection
      if (this.range) this.drawRange(ctx, G);
      // drag previews
      if (this.drag) this.drawDragPreview(ctx, G);
      if (this.ext) this.drawExternalPreview(ctx, G);
      // marquee
      if (this.drag && this.drag.kind === 'marquee') {
        const m = this.drag;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
        ctx.fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
        ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      }
      ctx.restore();

      // ---- background music well ----
      this.drawWell(ctx, G, sl);

      // ---- playhead & skimmer ----
      const pl = app.player;
      const phx = this.tx(pl.t) - sl;
      ctx.fillStyle = COL.playhead;
      ctx.fillRect(Math.round(phx) - 0.5, 0, 1.5, this.H);
      if (this.hovering && pl.skimming && pl.skimT != null && !pl.playing && !this.drag) {
        const sx = this.tx(pl.skimT) - sl;
        ctx.fillStyle = COL.skimmer;
        ctx.fillRect(Math.round(sx), 0, 1, this.H);
      }
      if (this.snapX != null) {
        ctx.fillStyle = 'rgba(255,214,10,0.9)';
        ctx.fillRect(Math.round(this.snapX - sl), 0, 1, this.H);
      }
      if (this.animating) this.redraw();
    },
    stepAnimation() {
      let moving = false;
      const keys = new Set([...this.dx.keys(), ...this.dxTarget.keys()]);
      for (const k of keys) {
        const cur = this.dx.get(k) || 0, tgt = this.dxTarget.get(k) || 0;
        let nv = cur + (tgt - cur) * 0.32;
        if (Math.abs(tgt - nv) < 0.4) nv = tgt;
        else moving = true;
        if (nv === 0 && tgt === 0) { this.dx.delete(k); this.dxTarget.delete(k); } else this.dx.set(k, nv);
      }
      this.animating = moving;
    },
    /** Snapshot display x of clips so a model change can animate from old to new positions. */
    captureDisplay() {
      const out = new Map();
      if (!this.G) return out;
      for (const g of this.G.clips) out.set(g.item.id, g.x0);
      for (const g of this.G.music) out.set(g.item.id, g.x0);
      return out;
    },
    animateFrom(before) {
      if (!before || !this.p) return;
      const G = this.geom();
      this.dx.clear(); this.dxTarget.clear();
      for (const g of G.clips.concat(G.music)) {
        if (!before.has(g.item.id)) continue;
        const d = before.get(g.item.id) - (g.x0 - (g.off || 0));
        if (Math.abs(d) > 0.5) { this.dx.set(g.item.id, d); this.dxTarget.set(g.item.id, 0); }
      }
      this.redraw();
    },

    drawPrimary(ctx, g, G) {
      const it = g.item;
      if (g.x1 < this.viewL - 50 || g.x0 > this.viewR + 50) return;
      const w = Math.max(2, g.x1 - g.x0);
      const selected = app.sel.ids.includes(it.id);
      const hov = this.hover && this.hover.item === it;
      const isTarget = this.ext && this.ext.replaceId === it.id;
      ctx.save();
      roundRect(ctx, g.x0, g.y, w, g.h, 4);
      ctx.clip();
      // video part
      this.drawFilmstrip(ctx, it, g, g.x0, g.x1, g.y, g.vh, g.startX);
      // audio part
      if (it.type === 'video' && g.ah > 0) {
        if (g.hasAudio) this.drawAudio(ctx, g, g.x0, g.x1, g.y + g.vh, g.ah, g.startX, hov || selected);
        else { ctx.fillStyle = '#202020'; ctx.fillRect(g.x0, g.y + g.vh, w, g.ah); }
      }
      // speed indicator
      if ((it.type === 'video' || it.type === 'audio') && Math.abs((it.speed || 1) - 1) > 1e-3) this.drawSpeed(ctx, g, selected);
      ctx.restore();
      // outline
      ctx.strokeStyle = COL.clipEdge; ctx.lineWidth = 1;
      roundRect(ctx, g.x0 + 0.5, g.y + 0.5, w - 1, g.h - 1, 4); ctx.stroke();
      if (it.type === 'video' && g.ah > 0 && g.hasAudio) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(g.x0 + 1, g.y + g.vh, w - 2, 1); }
      if (hov && !this.drag && !selected) { ctx.strokeStyle = 'rgba(255,255,255,0.25)'; roundRect(ctx, g.x0 + 0.5, g.y + 0.5, w - 1, g.h - 1, 4); ctx.stroke(); }
      if (isTarget) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; roundRect(ctx, g.x0 + 1.5, g.y + 1.5, w - 3, g.h - 3, 4); ctx.stroke(); }
      if (selected) this.drawSelection(ctx, g.x0, g.y, w, g.h);
      // hover badge: duration upper-left
      if ((hov && !this.drag) || (this.drag && this.drag.kind === 'trim' && this.drag.id === it.id)) this.drawBadge(ctx, g.x0 + 5, g.y + 5, IM.fmtDur(Pr.dur(it)));
      if (this.drag && this.drag.kind === 'trim' && this.drag.id === it.id && this.drag.limited) {
        ctx.fillStyle = COL.red;
        const ex = this.drag.edge === 'start' ? g.x0 : g.x1 - 3;
        ctx.fillRect(ex, g.y, 3, g.h);
      }
    },
    drawSelection(ctx, x, y, w, hh) {
      ctx.strokeStyle = COL.sel;
      ctx.lineWidth = 3;
      roundRect(ctx, x + 1.5, y + 1.5, w - 3, hh - 3, 4);
      ctx.stroke();
    },
    drawBadge(ctx, x, y, text) {
      ctx.save();
      ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      roundRect(ctx, x, y, tw + 10, 16, 4); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 5, y + 8.5);
      ctx.restore();
    },
    drawFilmstrip(ctx, it, g, x0, x1, y, hh, startX) {
      const tw = Math.max(8, Math.round(hh * 16 / 9));
      const m = it.mediaId ? IM.lib.get(it.mediaId) : null;
      ctx.fillStyle = COL.placeholder;
      ctx.fillRect(x0, y, x1 - x0, hh);
      const vis0 = Math.max(x0, this.viewL - tw), vis1 = Math.min(x1, this.viewR + tw);
      const first = x0 + Math.floor(Math.max(0, vis0 - x0) / tw) * tw;
      const still = (it.type === 'bg' || it.type === 'title') ? stillFor(it) : null;
      for (let tx = first; tx < vis1; tx += tw) {
        const local = clamp((tx - startX) / this.pps, 0, Pr.dur(it));
        let img = null, sx = 0, sy = 0, sw = 0, sh = 0;
        if (still) { img = still; sw = still.width; sh = still.height; }
        else if (m && (it.type === 'video' || it.type === 'freeze')) {
          const th = IM.lib.thumbAt(m, it.type === 'freeze' ? it.frameTime : Pr.srcTime(it, local));
          if (th) { img = th.img; sx = th.sx; sy = th.sy; sw = th.sw; sh = th.sh; }
        } else if (m && it.type === 'image') {
          const th = IM.lib.thumbAt(m, 0);
          if (th) { img = th.img; sx = th.sx; sy = th.sy; sw = th.sw; sh = th.sh; }
        }
        if (!img) continue;
        // cover-fit crop into tile
        const ta = tw / hh, sa = sw / sh;
        let cx = sx, cy = sy, cw = sw, ch = sh;
        if (sa > ta) { cw = sh * ta; cx = sx + (sw - cw) / 2; } else { ch = sw / ta; cy = sy + (sh - ch) / 2; }
        ctx.drawImage(img, cx, cy, cw, ch, tx, y, tw, hh);
      }
      if (it.type === 'freeze') {
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x0, y, x1 - x0, hh);
      }
    },
    /** Waveform + volume line + fade handles for an item */
    drawAudio(ctx, g, x0, x1, y, hh, startX, hover, colorsOverride) {
      const it = g.item;
      const [bgK, waveK, hiK] = colorsOverride || audioColors(it, g.where);
      ctx.fillStyle = COL[bgK];
      ctx.fillRect(x0, y, x1 - x0, hh);
      const m = IM.lib.get(it.mediaId);
      const dur = Pr.dur(it);
      const a = it.audio;
      const vol = a.mute ? 0 : a.volume;
      const zeroY = y + hh - hh * 0.83;
      const baseY = y + hh;
      const peaks = m && m.peaks;
      const xa = Math.max(x0, this.viewL - 2), xb = Math.min(x1, this.viewR + 2);
      const sp = it.speed || 1;
      if (peaks) {
        const pd = peaks.data, rate = peaks.rate;
        const colW = 1;
        for (let px = Math.floor(xa); px < xb; px += colW) {
          const l0 = (px - startX) / this.pps, l1 = (px + colW - startX) / this.pps;
          let s0 = Pr.srcTime(it, clamp(l0, 0, dur)), s1 = Pr.srcTime(it, clamp(l1, 0, dur));
          if (s1 < s0) { const t = s0; s0 = s1; s1 = t; }
          let i0 = Math.floor(s0 * rate), i1 = Math.max(i0 + 1, Math.ceil(s1 * rate));
          let pk = 0;
          for (let i = i0; i < i1 && i < pd.length; i++) if (pd[i] > pk) pk = pd[i];
          const amp = (pk / 255) * vol * IM.itemGain(Object.assign({}, it, { audio: Object.assign({}, a, { volume: 1, mute: false }) }), clamp(l0, 0, dur), dur);
          const bh = Math.min(hh - 1, amp * hh * 0.83);
          if (bh < 0.5) continue;
          if (amp > 1.0) {
            ctx.fillStyle = COL[waveK]; ctx.fillRect(px, zeroY, colW, baseY - zeroY);
            ctx.fillStyle = COL.red; ctx.fillRect(px, baseY - bh, colW, bh - (baseY - zeroY));
          } else if (amp > 0.89) {
            ctx.fillStyle = COL[waveK]; ctx.fillRect(px, baseY - hh * 0.83 * 0.89, colW, hh * 0.83 * 0.89);
            ctx.fillStyle = COL.yellow; ctx.fillRect(px, baseY - bh, colW, bh - hh * 0.83 * 0.89);
          } else {
            ctx.fillStyle = COL[waveK]; ctx.fillRect(px, baseY - bh, colW, bh);
          }
        }
      } else {
        ctx.fillStyle = COL[waveK];
        ctx.globalAlpha = 0.35;
        ctx.fillRect(xa, baseY - 2, xb - xa, 2);
        ctx.globalAlpha = 1;
      }
      // volume line (with fades)
      const vf = volToFrac(vol);
      const ly = y + hh - vf * hh;
      ctx.strokeStyle = hover ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const fin = Math.min(a.fadeIn || 0, dur), fout = Math.min(a.fadeOut || 0, dur);
      const fx0 = startX + fin * this.pps, fx1 = startX + (dur - fout) * this.pps;
      const clipX1 = startX + dur * this.pps;
      if (fin > 0) {
        for (let px = startX; px <= fx0; px += 2) {
          const k = Math.sin(clamp((px - startX) / (fx0 - startX), 0, 1) * Math.PI / 2);
          const yy = y + hh - volToFrac(vol * k) * hh;
          if (px === startX) ctx.moveTo(Math.max(px, x0), yy); else ctx.lineTo(px, yy);
        }
      } else ctx.moveTo(Math.max(startX, x0), ly + 0.5);
      ctx.lineTo(fx1, ly + 0.5);
      if (fout > 0) {
        for (let px = fx1; px <= clipX1; px += 2) {
          const k = Math.sin(clamp((clipX1 - px) / (clipX1 - fx1), 0, 1) * Math.PI / 2);
          ctx.lineTo(Math.min(px, x1), y + hh - volToFrac(vol * k) * hh);
        }
      } else ctx.lineTo(Math.min(clipX1, x1), ly + 0.5);
      ctx.stroke();
      // fade handles (gray dots) on hover / selection
      if (hover || (this.drag && this.drag.kind === 'fade' && this.drag.id === it.id)) {
        const r = 4.2;
        const hx0 = Math.max(x0 + 5, fx0), hx1 = Math.min(x1 - 5, fx1);
        [hx0, hx1].forEach((hx) => {
          ctx.beginPath(); ctx.arc(hx, y + hh - vf * hh, r, 0, Math.PI * 2);
          ctx.fillStyle = '#cfcfcf'; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
        });
      }
      if (this.drag && this.drag.kind === 'volume' && this.drag.id === it.id) {
        const txt = Math.round(vol * 100) + '%';
        this.drawBadge(ctx, clamp(this.drag.px - 20, x0 + 2, x1 - 50), Math.max(y - 20, ly - 22), txt);
      }
      if (this.drag && this.drag.kind === 'fade' && this.drag.id === it.id) {
        const v = this.drag.edge === 'in' ? a.fadeIn : a.fadeOut;
        this.drawBadge(ctx, clamp(this.drag.px - 20, x0 + 2, x1 - 50), y - 18, (this.drag.edge === 'in' ? 'Fade In ' : 'Fade Out ') + v.toFixed(1) + 's');
      }
    },
    drawSpeed(ctx, g, selected) {
      const it = g.item;
      const sp = it.speed || 1;
      const x0 = g.x0, x1 = g.x1, y = g.y;
      const bh = 13;
      ctx.fillStyle = 'rgba(20,20,20,0.72)';
      ctx.fillRect(x0, y, x1 - x0, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x0, y + bh - 1, x1 - x0, 1);
      // turtle / rabbit icon
      ctx.save();
      ctx.fillStyle = '#f2f2f2';
      ctx.translate(x0 + 4, y + 1);
      ctx.scale(0.46, 0.46);
      const path = new Path2D(sp < 1
        ? 'M4.5 14.5c0-3.6 3-6.5 7-6.5s7 2.9 7 6.5zM19 12.5c.5-1.2 1.6-2 2.7-1.6.6.2.5 1.2-.1 1.4l-1.7.9zM6 15.2l-.9 2.3h2l.8-2.3zM15 15.2l.9 2.3h-2l-.8-2.3z'
        : 'M6 17.5c-1.6 0-2.5-.9-2.5-2 0-2.8 3.2-5.3 7.2-5.3 1.5 0 2.7.3 3.7.8l1.6-4.2c.3-.8 1.4-.9 1.7-.1.2.5 0 1.4-.4 2.5l1.3-2c.5-.7 1.5-.4 1.4.4-.1 1-1 2.6-2.3 4 1 .8 1.8 1.9 1.8 3 0 1.6-1.4 2.9-3.2 2.9z');
      ctx.fill(path);
      ctx.restore();
      if (it.reverse) { ctx.fillStyle = '#f2f2f2'; ctx.font = '600 9px sans-serif'; ctx.fillText('◀', x0 + 17, y + 10); }
      if (selected || (this.drag && this.drag.kind === 'speed' && this.drag.id === it.id)) {
        // slider knob at the right end
        const kx = x1 - 9;
        ctx.fillStyle = '#e8e8e8';
        roundRect(ctx, kx, y + 2, 7, bh - 4, 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(kx + 3, y + 4, 1, bh - 8);
      }
      if (this.drag && this.drag.kind === 'speed' && this.drag.id === it.id) {
        const lbl = sp >= 1 ? (Math.round(sp * 100) / 100) + 'x' : Math.round(sp * 100) + '%';
        this.drawBadge(ctx, Math.max(x0 + 2, x1 - 60), y + bh + 3, lbl);
      }
    },
    drawTransition(ctx, tr) {
      if (tr.x < this.viewL - 30 || tr.x > this.viewR + 30) return;
      const selected = app.sel.transition === tr.clip.id;
      const hov = this.hover && this.hover.kind === 'transition' && this.hover.clip === tr.clip;
      const x = tr.x - tr.w / 2, y = tr.y;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
      ctx.fillStyle = hov ? COL.transHi : COL.trans;
      roundRect(ctx, x, y, tr.w, tr.h, 3); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, tr.w - 1, tr.h - 1, 3); ctx.stroke();
      // bowtie glyph
      ctx.fillStyle = COL.glyph;
      const cx = tr.x, cy = y + tr.h / 2, gw = tr.w * 0.32, gh = tr.h * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - gw, cy - gh); ctx.lineTo(cx, cy); ctx.lineTo(cx - gw, cy + gh); ctx.closePath();
      ctx.moveTo(cx + gw, cy - gh); ctx.lineTo(cx, cy); ctx.lineTo(cx + gw, cy + gh); ctx.closePath();
      ctx.fill();
      if (selected) { ctx.strokeStyle = COL.sel; ctx.lineWidth = 2.5; roundRect(ctx, x - 1, y - 1, tr.w + 2, tr.h + 2, 4); ctx.stroke(); }
    },
    drawConnected(ctx, g, G) {
      const it = g.item;
      if (g.x1 < this.viewL - 50 || g.x0 > this.viewR + 50) return;
      const selected = app.sel.ids.includes(it.id);
      const hov = this.hover && this.hover.item === it;
      const w = Math.max(3, g.x1 - g.x0);
      const pastEnd = this.tx(G.L.duration);
      ctx.save();
      roundRect(ctx, g.x0, g.y, w, g.h, g.kind === 'title' ? 4 : 4);
      ctx.clip();
      if (g.kind === 'title') {
        ctx.fillStyle = hov || selected ? COL.titleHi : COL.title;
        ctx.fillRect(g.x0, g.y, w, g.h);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(g.x0, g.y, w, 1);
        const st = IM.TitleStyles.get(it.title.style);
        const txt = (it.title.text || []).filter(Boolean).join(' ').replace(/\s+/g, ' ');
        ctx.fillStyle = COL.titleText;
        ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
        ctx.textBaseline = 'middle';
        ctx.fillText(st.name + (txt ? ' – ' + txt : ''), Math.max(g.x0, this.viewL) + 7, g.y + g.h / 2 + 0.5);
      } else if (g.kind === 'audio') {
        this.drawAudio(ctx, g, g.x0, g.x1, g.y, g.h, g.startX, hov || selected);
        const m = IM.lib.get(it.mediaId);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
        ctx.textBaseline = 'top';
        ctx.fillText(it.name || (m && m.name) || 'Audio', Math.max(g.x0, this.viewL) + 6, g.y + 4);
      } else {
        this.drawFilmstrip(ctx, it, g, g.x0, g.x1, g.y, g.vh, g.startX);
        if (g.ah > 0) this.drawAudio(ctx, g, g.x0, g.x1, g.y + g.vh, g.ah, g.startX, hov || selected);
        if ((it.type === 'video' || it.type === 'audio') && Math.abs((it.speed || 1) - 1) > 1e-3) this.drawSpeed(ctx, g, selected);
      }
      // dim past movie end
      if (g.x1 > pastEnd) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(Math.max(g.x0, pastEnd), g.y, g.x1 - Math.max(g.x0, pastEnd), g.h); }
      ctx.restore();
      ctx.strokeStyle = COL.clipEdge; ctx.lineWidth = 1;
      roundRect(ctx, g.x0 + 0.5, g.y + 0.5, w - 1, g.h - 1, 4); ctx.stroke();
      if (selected) this.drawSelection(ctx, g.x0, g.y, w, g.h);
      if (hov && !this.drag && g.kind === 'video') this.drawBadge(ctx, g.x0 + 5, g.y + 5, IM.fmtDur(Pr.dur(it)));
      if (this.drag && this.drag.kind === 'trim' && this.drag.id === it.id) {
        this.drawBadge(ctx, g.x0 + 5, g.kind === 'title' ? g.y - 19 : g.y + 5, IM.fmtDur(Pr.dur(it)));
        if (this.drag.limited) { ctx.fillStyle = COL.red; ctx.fillRect(this.drag.edge === 'start' ? g.x0 : g.x1 - 3, g.y, 3, g.h); }
      }
    },
    drawConnection(ctx, g, G) {
      const a = g.anchor;
      if (!a) return;
      const x = g.x0 + 0.5;
      const top = g.lane > 0 ? g.y + g.h : a.y + a.h;
      const bot = g.lane > 0 ? a.y : g.y;
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
      ctx.fillStyle = COL.sel;
      ctx.beginPath(); ctx.arc(x, g.lane > 0 ? bot + 2 : top - 2, 2.6, 0, Math.PI * 2); ctx.fill();
    },
    drawRange(ctx, G) {
      const r = this.range;
      const g = G.byId.get(r.id);
      if (!g) return;
      const x0 = this.tx(r.t0) + (g.off || 0), x1 = this.tx(r.t1) + (g.off || 0);
      ctx.fillStyle = 'rgba(248,198,60,0.12)';
      ctx.fillRect(x0, g.y, x1 - x0, g.h);
      this.drawSelection(ctx, x0, g.y, Math.max(6, x1 - x0), g.h);
      ctx.fillStyle = COL.sel;
      ctx.fillRect(x0 - 1, g.y, 4, g.h); ctx.fillRect(x1 - 3, g.y, 4, g.h);
      this.drawBadge(ctx, x0 + 5, g.y + 5, IM.fmtDur(r.t1 - r.t0));
    },
    drawWell(ctx, G, sl) {
      const y = this.H - WELL_H;
      ctx.fillStyle = COL.wellBg;
      ctx.fillRect(0, y, this.W, WELL_H);
      ctx.fillStyle = COL.wellLine;
      ctx.fillRect(0, y, this.W, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, y + 1, this.W, 1);
      const over = this.ext && this.ext.target === 'music';
      if (over) { ctx.fillStyle = 'rgba(52,199,89,0.12)'; ctx.fillRect(0, y + 2, this.W, WELL_H - 2); }
      ctx.save();
      ctx.beginPath(); ctx.rect(30, y, this.W - 30, WELL_H); ctx.clip();
      ctx.translate(-sl, 0);
      const endX = this.tx(G.L.duration);
      for (const g of G.music) {
        if (g.x1 < sl - 20 || g.x0 > sl + this.W + 20) continue;
        const it = g.item;
        const w = Math.max(3, g.x1 - g.x0);
        const selected = app.sel.ids.includes(it.id);
        const hov = this.hover && this.hover.item === it;
        ctx.save();
        roundRect(ctx, g.x0, g.y, w, g.h, 4); ctx.clip();
        this.drawAudio(ctx, g, g.x0, g.x1, g.y, g.h, g.startX, hov || selected, ['greenBg', 'greenWave', 'greenWaveHi']);
        const m = IM.lib.get(it.mediaId);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
        ctx.textBaseline = 'top';
        ctx.fillText(it.name || (m && m.name) || 'Music', Math.max(g.x0, sl + 30) + 6, g.y + 4);
        if (g.x1 > endX) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(Math.max(g.x0, endX), g.y, g.x1 - Math.max(g.x0, endX), g.h); }
        ctx.restore();
        ctx.strokeStyle = COL.clipEdge; roundRect(ctx, g.x0 + 0.5, g.y + 0.5, w - 1, g.h - 1, 4); ctx.stroke();
        if (selected) this.drawSelection(ctx, g.x0, g.y, w, g.h);
        if (this.drag && this.drag.kind === 'trim' && this.drag.id === it.id) this.drawBadge(ctx, g.x0 + 5, g.y - 18, IM.fmtDur(Pr.dur(it)));
      }
      if (this.ext && this.ext.target === 'music') {
        const x = this.tx(this.ext.time);
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y + 3, 2, WELL_H - 6);
      }
      if (this.drag && this.drag.kind === 'move' && this.drag.where === 'music' && this.drag.musicIndex != null) {
        const L = G.L; const idx = this.drag.musicIndex;
        const t = idx < L.music.length ? L.music[idx].start : Pr.musicEnd(this.p);
        ctx.fillStyle = '#fff'; ctx.fillRect(this.tx(t) - 1, y + 3, 2, WELL_H - 6);
      }
      ctx.restore();
      // music note button on the left
      ctx.fillStyle = COL.wellBg; ctx.fillRect(0, y + 1, 30, WELL_H - 1);
      ctx.fillStyle = '#3b3b3b';
      roundRect(ctx, 6, y + 9, 20, 20, 4); ctx.fill();
      ctx.save();
      ctx.translate(8.5, y + 11.5); ctx.scale(0.62, 0.62);
      ctx.fillStyle = '#bdbdbd';
      ctx.fill(new Path2D('M19.5 3.3v11.9a3 3 0 1 1-1.8-2.8V7.6L9.5 9.4v7.8a3 3 0 1 1-1.8-2.8V6.4c0-.5.3-.9.8-1l10.2-2.6c.4-.1.8.2.8.5z'));
      ctx.restore();
    },
    drawDragPreview(ctx, G) {
      const d = this.drag;
      if (d.kind !== 'move' || !d.moved) return;
      ctx.save();
      ctx.globalAlpha = 0.85;
      for (const gi of d.ghosts) {
        const x = gi.x + d.dxPx, y = gi.y + (d.ghostDy || 0);
        const w = gi.w;
        ctx.save();
        roundRect(ctx, x, y, w, gi.h, 4); ctx.clip();
        const fake = Object.assign({}, gi.g, { x0: x, x1: x + w, y, startX: x - (gi.g.x0 - gi.g.startX) });
        if (gi.g.kind === 'title') { ctx.fillStyle = COL.titleHi; ctx.fillRect(x, y, w, gi.h); }
        else if (gi.g.kind === 'audio' || gi.g.where === 'music') this.drawAudio(ctx, fake, x, x + w, y, gi.h, fake.startX, false, gi.g.where === 'music' ? ['greenBg', 'greenWave', 'greenWaveHi'] : null);
        else this.drawFilmstrip(ctx, gi.g.item, fake, x, x + w, y, gi.g.vh || gi.h, fake.startX);
        ctx.restore();
        this.drawSelection(ctx, x, y, w, gi.h);
      }
      ctx.restore();
      if (d.insertX != null) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(d.insertX - 1, G.primY - 4, 2, G.primH + 8);
      }
      if (d.connectLine) {
        ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(d.connectLine.x, d.connectLine.y0); ctx.lineTo(d.connectLine.x, d.connectLine.y1); ctx.stroke();
      }
    },
    /** y and height for drawing a preview in lane (existing or new). */
    previewLaneBox(G, lane, hh) {
      const ly = G.laneY.get(lane);
      if (ly != null) {
        const lh = G.laneH.get(lane) - 6;
        return { y: lane > 0 ? ly + lh - hh : ly, h: hh };
      }
      if (lane > 0) {
        const top = G.maxAbove ? G.laneY.get(G.maxAbove) : G.primY;
        return { y: top - hh - 5, h: hh };
      }
      let bottom = G.primY + G.primH + 8;
      if (G.maxBelow) bottom = G.laneY.get(-G.maxBelow) + G.laneH.get(-G.maxBelow);
      return { y: bottom, h: hh };
    },
    drawExternalPreview(ctx, G) {
      const x = this.ext;
      if (x.target === 'insert' && x.insertX != null) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x.insertX - 1, G.primY - 4, 2, G.primH + 8);
      } else if (x.target === 'connect' || x.target === 'audio' || x.target === 'titleAbove') {
        const lane = x.lane;
        const xx = this.tx(x.time);
        const w = Math.max(20, x.dur * this.pps);
        const hh = x.target === 'titleAbove' ? TITLE_H : lane < 0 ? G.S.audH : Math.round(G.S.vh * 0.75);
        const yy = this.previewLaneBox(G, lane, hh).y;
        ctx.fillStyle = x.target === 'titleAbove' ? 'rgba(141,116,224,0.55)' : x.target === 'audio' ? 'rgba(76,184,87,0.45)' : 'rgba(255,255,255,0.18)';
        roundRect(ctx, xx, yy, w, hh, 4); ctx.fill();
        ctx.strokeStyle = COL.sel; ctx.lineWidth = 2; roundRect(ctx, xx + 1, yy + 1, w - 2, hh - 2, 4); ctx.stroke();
        ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (lane > 0) { ctx.moveTo(xx + 0.5, yy + hh); ctx.lineTo(xx + 0.5, G.primY); }
        else { ctx.moveTo(xx + 0.5, G.primY + G.primH); ctx.lineTo(xx + 0.5, yy); }
        ctx.stroke();
      } else if (x.target === 'transition' && x.clipId) {
        const g = G.byId.get(x.clipId);
        if (g) {
          const xx = g.x1 + GAP;
          ctx.fillStyle = COL.sel;
          ctx.fillRect(xx - 2, G.primY - 3, 4, G.primH + 6);
        }
      }
    },

    // ------------------------------------------------------------------ hit testing
    toContent(e) {
      const r = this.canvas.getBoundingClientRect();
      const vx = e.clientX - r.left, vy = e.clientY - r.top;
      return { vx, vy, x: vx + this.scroller.scrollLeft, y: vy + this.scroller.scrollTop, inWell: vy >= this.H - WELL_H };
    },
    hit(pt) {
      const G = this.G || (this.G = this.geom());
      if (pt.inWell) {
        const x = pt.vx + this.scroller.scrollLeft;
        const y = pt.vy;
        for (const g of G.music) {
          if (x >= g.x0 - 2 && x <= g.x1 + 2 && y >= g.y && y <= g.y + g.h) return this.hitItem(g, x, y);
        }
        return { kind: 'well' };
      }
      const { x, y } = pt;
      // transitions first
      for (const tr of G.trans) if (Math.abs(x - tr.x) <= tr.w / 2 + 1 && y >= tr.y - 1 && y <= tr.y + tr.h + 1) return { kind: 'transition', clip: tr.clip, tr };
      // connected (topmost drawn last → check reverse)
      for (let i = G.conn.length - 1; i >= 0; i--) {
        const g = G.conn[i];
        if (x >= g.x0 - 2 && x <= g.x1 + 2 && y >= g.y && y <= g.y + g.h) return this.hitItem(g, x, y);
      }
      for (const g of G.clips) {
        if (x >= g.x0 - GAP && x <= g.x1 + GAP && y >= g.y && y <= g.y + g.h) return this.hitItem(g, x, y);
      }
      return { kind: 'empty' };
    },
    hitItem(g, x, y) {
      const it = g.item;
      const base = { kind: 'item', g, item: it, where: g.where };
      if (this.rKey && (g.where === 'primary' || g.kind === 'video' || g.kind === 'audio' || g.where === 'music')) return Object.assign(base, { part: 'range' });
      const w = g.x1 - g.x0;
      const edge = Math.min(EDGE, w / 4);
      // speed knob
      if ((it.type === 'video' || it.type === 'audio') && Math.abs((it.speed || 1) - 1) > 1e-3 && app.sel.ids.includes(it.id) && y <= g.y + 13 && x >= g.x1 - 12) return Object.assign(base, { part: 'speed' });
      // audio area interactions
      const audioArea = this.audioAreaOf(g);
      if (audioArea && y >= audioArea.y) {
        const a = it.audio; const dur = Pr.dur(it);
        const vf = volToFrac(a.mute ? 0 : a.volume);
        const ly = audioArea.y + audioArea.h - vf * audioArea.h;
        const fx0 = Math.max(g.x0 + 5, g.startX + (a.fadeIn || 0) * this.pps);
        const fx1 = Math.min(g.x1 - 5, g.startX + (dur - (a.fadeOut || 0)) * this.pps);
        if (Math.hypot(x - fx0, y - ly) <= 7) return Object.assign(base, { part: 'fadeIn' });
        if (Math.hypot(x - fx1, y - ly) <= 7) return Object.assign(base, { part: 'fadeOut' });
        if (Math.abs(y - ly) <= 4 && x > g.x0 + edge && x < g.x1 - edge) return Object.assign(base, { part: 'volume', area: audioArea });
      }
      if (x <= g.x0 + edge) return Object.assign(base, { part: 'trimStart' });
      if (x >= g.x1 - edge) return Object.assign(base, { part: 'trimEnd' });
      return Object.assign(base, { part: 'body' });
    },
    audioAreaOf(g) {
      if (g.where === 'music') return { y: g.y, h: g.h };
      if (g.where === 'primary') return g.item.type === 'video' && g.hasAudio && g.ah > 0 ? { y: g.y + g.vh, h: g.ah } : null;
      if (g.kind === 'audio') return { y: g.y, h: g.h };
      if (g.kind === 'video' && g.hasAudio && g.ah > 0) return { y: g.y + g.vh, h: g.ah };
      return null;
    },
    cursorFor(hit) {
      if (!hit) return 'default';
      if (hit.kind === 'item') {
        switch (hit.part) {
          case 'trimStart': return CURSORS.trimStart;
          case 'trimEnd': return CURSORS.trimEnd;
          case 'volume': return CURSORS.volume;
          case 'fadeIn': case 'fadeOut': return 'ew-resize';
          case 'speed': return 'ew-resize';
          case 'range': return CURSORS.range;
          default: return 'default';
        }
      }
      return 'default';
    },
    updateCursor() {
      if (this.drag) return;
      this.canvas.style.cursor = this.cursorFor(this.hover);
    },

    // ------------------------------------------------------------------ pointer: hover & skim
    onHover(e) {
      if (this.drag) return;
      const pt = this.toContent(e);
      this.pointer = pt;
      this.hovering = true;
      const hit = this.hit(pt);
      const prev = this.hover;
      this.hover = hit.kind === 'item' || hit.kind === 'transition' ? hit : null;
      this.updateCursor();
      if (this.p && app.player.skimming) {
        const t = clamp(this.xt(pt.x), 0, Pr.duration(this.p));
        if (Pr.duration(this.p) > 0) app.player.setSkim(this.snapTime(t, 6));
      }
      if (!prev !== !this.hover || (prev && this.hover && prev.item !== this.hover.item) || (prev && this.hover && prev.part !== this.hover.part)) this.redraw();
      this.updateTime();
    },
    onLeave() {
      this.hovering = false;
      if (this.drag) return;
      this.hover = null;
      app.player.setSkim(null);
      this.updateTime();
      this.redraw();
    },

    // ------------------------------------------------------------------ pointer: press & drag
    onDown(e) {
      if (!this.p) return;
      if (e.button === 2) return;
      IM.closePopovers();
      app.focus = 'timeline';
      const pt = this.toContent(e);
      const hit = this.hit(pt);
      const pl = app.player;
      if (pl.isPlaying() && hit.kind !== 'item') pl.pause();
      const clickT = clamp(this.xt(pt.x), 0, Pr.duration(this.p));
      if (hit.kind === 'transition') {
        IM.selectTransition(hit.clip.id);
        pl.seek(clickT);
        return;
      }
      if (hit.kind === 'empty' || hit.kind === 'well') {
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { IM.clearSelection(); this.range = null; }
        if (pl.isPlaying()) pl.pause();
        pl.seek(this.snapTime(clickT, 6));
        if (hit.kind === 'empty') this.startMarquee(e, pt);
        return;
      }
      const it = hit.item;
      if (hit.part === 'range') { this.startRange(e, hit, pt); return; }
      // selection
      const sel = app.sel.ids;
      if (e.metaKey || e.ctrlKey) IM.select([it.id], { toggle: true });
      else if (e.shiftKey && hit.where === 'primary' && sel.length) {
        const p = this.p;
        const idx = p.clips.findIndex((c) => c.id === it.id);
        const others = p.clips.map((c, i) => (sel.includes(c.id) ? i : -1)).filter((i) => i >= 0);
        const a = Math.min(idx, ...others), b = Math.max(idx, ...others);
        IM.select(p.clips.slice(a, b + 1).map((c) => c.id));
      } else if (!sel.includes(it.id) || hit.part !== 'body') IM.select([it.id]);
      if (this.range && this.range.id !== it.id) this.range = null;
      if (!(e.metaKey || e.ctrlKey || e.shiftKey) && hit.part === 'body') {
        if (pl.isPlaying()) pl.pause();
        pl.seek(clickT);
      }
      switch (hit.part) {
        case 'trimStart': this.startTrim(e, hit, 'start'); break;
        case 'trimEnd': this.startTrim(e, hit, 'end'); break;
        case 'volume': this.startVolume(e, hit); break;
        case 'fadeIn': this.startFade(e, hit, 'in'); break;
        case 'fadeOut': this.startFade(e, hit, 'out'); break;
        case 'speed': this.startSpeed(e, hit); break;
        default: this.startMove(e, hit, pt);
      }
    },
    startMarquee(e, pt) {
      const d = { kind: 'marquee', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      IM.drag(e, (dx, dy, ev) => {
        this.drag = d;
        const q = this.toContent(ev);
        d.x1 = q.x; d.y1 = q.y;
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        const G = this.G;
        const ids = [];
        for (const g of G.clips.concat(G.conn)) if (g.x1 > x0 && g.x0 < x1 && g.y + g.h > y0 && g.y < y1) ids.push(g.item.id);
        IM.select(ids, { add: e.shiftKey });
        this.autoScrollDuring(ev);
        this.redraw();
      }, () => { this.drag = null; this.stopAutoScroll(); this.redraw(); }, { threshold: 4 });
    },
    startRange(e, hit, pt) {
      const g = hit.g;
      const e0 = g.e;
      const t0 = clamp(this.xt(pt.x - (g.off || 0)), e0.start, e0.end);
      this.range = { id: hit.item.id, t0, t1: t0 };
      IM.select([hit.item.id]);
      IM.drag(e, (dx, dy, ev) => {
        const q = this.toContent(ev);
        const t1 = clamp(this.xt(q.x - (g.off || 0)), e0.start, e0.end);
        this.range = { id: hit.item.id, t0: Math.min(t0, t1), t1: Math.max(t0, t1) };
        app.player.seek(t1);
        this.redraw();
      }, (ev, moved) => {
        if (!moved || this.range.t1 - this.range.t0 < 0.05) this.range = null;
        this.redraw();
      }, { threshold: 2 });
    },
    clearRange() { this.range = null; this.redraw(); },
    /** Delete the selected range (ripple). */
    deleteRange() {
      const r = this.range;
      if (!r) return;
      this.range = null;
      IM.edit('Delete', (p) => {
        const f = Pr.findItem(p, r.id);
        if (!f) return false;
        const L = Pr.layout(p);
        const e = L.byId.get(r.id);
        const a = r.t0 - e.start, b = r.t1 - e.start;
        const it = f.item;
        const dur = Pr.dur(it);
        if (a <= 0.05 && b >= dur - 0.05) { Pr.deleteItems(p, [it.id]); return; }
        if (a <= 0.05) { Pr.trim(p, it.id, 'start', b); return; }
        if (b >= dur - 0.05) { Pr.trim(p, it.id, 'end', -(dur - a)); return; }
        // middle: split into two and drop the middle
        if (f.where === 'primary') {
          Pr.splitPrimaryAt(p, e.start + b);
          Pr.splitPrimaryAt(p, e.start + a);
          const idx = p.clips.findIndex((c) => c.id === it.id);
          const mid = p.clips[idx + 1];
          if (mid) Pr.deleteItems(p, [mid.id]);
        } else {
          const pair = Pr.splitItem(it, b);
          if (!pair) return false;
          const [A, B] = pair;
          const list = f.where === 'connected' ? p.connected : p.music;
          const i = list.findIndex((c) => c.id === it.id);
          if (f.where === 'connected') B.offset = it.offset + b;
          list.splice(i, 1, A, B);
          Pr.invalidate(p);
          Pr.trim(p, A.id, 'end', -(b - a));
        }
      });
      IM.clearSelection();
    },
    startTrim(e, hit, edge) {
      const it = hit.item;
      const live = IM.beginLive('Trim');
      const orig = IM.clone(it);
      const origConn = this.p.connected.map((c) => ({ id: c.id, offset: c.offset }));
      const d = { kind: 'trim', id: it.id, edge, limited: false, where: hit.where };
      this.drag = d;
      const before = this.captureDisplay();
      const L0 = Pr.layout(this.p);
      const e0 = L0.byId.get(it.id);
      const startEdgeT = edge === 'start' ? e0.start : e0.end;
      this.canvas.style.cursor = edge === 'start' ? CURSORS.trimStart : CURSORS.trimEnd;
      IM.drag(e, (dx, dy, ev) => {
        const q = this.toContent(ev);
        let want = this.xt(q.x - (hit.g.off || 0)) - startEdgeT;
        // snapping to playhead/edits
        const snapT = this.snapTime(startEdgeT + want, 7, it.id);
        want = snapT - startEdgeT;
        live.update((p) => {
          const f = Pr.findItem(p, it.id);
          Object.assign(f.item, IM.clone(orig));
          for (const c of p.connected) { const o = origConn.find((x) => x.id === c.id); if (o) c.offset = o.offset; }
          Pr.invalidate(p);
          const applied = Pr.trim(p, it.id, edge, want) || 0;
          d.limited = Math.abs(applied - (edge === 'start' ? want : want)) > 0.02 && Math.abs(applied) < Math.abs(want) + 1e-6;
          d.applied = applied;
        });
        // keep the start edge under the pointer while dragging (ripple happens on release)
        if (edge === 'start' && hit.where === 'primary') {
          const idx = this.p.clips.findIndex((c) => c.id === it.id);
          const shift = (d.applied || 0) * this.pps;
          this.p.clips.forEach((c, i) => { if (i >= idx) { this.dx.set(c.id, shift); this.dxTarget.set(c.id, shift); } });
        }
        if (hit.where === 'primary' || hit.where === 'music') {
          const e1 = Pr.layout(this.p).byId.get(it.id);
          if (e1) app.player.seek(clamp(edge === 'start' ? e1.start : e1.end - 0.001, 0, Pr.duration(this.p)));
        }
        this.autoScrollDuring(ev);
        this.redraw();
      }, (ev, moved) => {
        this.drag = null;
        this.stopAutoScroll();
        this.snapX = null;
        if (moved) live.commit();
        // animate the ripple closing the gap
        for (const k of this.dxTarget.keys()) this.dxTarget.set(k, 0);
        this.redraw();
      }, { threshold: 1 });
    },
    startVolume(e, hit) {
      const it = hit.item;
      const live = IM.beginLive('Adjust Volume');
      const area = hit.area || this.audioAreaOf(hit.g);
      const d = { kind: 'volume', id: it.id, px: this.toContent(e).x };
      this.drag = d;
      this.canvas.style.cursor = CURSORS.volume;
      const startFrac = volToFrac(it.audio.mute ? 0 : it.audio.volume);
      const y0 = e.clientY;
      IM.drag(e, (dx, dy, ev) => {
        const f = clamp(startFrac - dy / area.h, 0, 1);
        let v = fracToVol(f);
        if (Math.abs(v - 1) < 0.04) v = 1;
        live.update((p) => { const fi = Pr.findItem(p, it.id); fi.item.audio.volume = Math.round(v * 100) / 100; fi.item.audio.mute = false; });
        d.px = this.toContent(ev).x;
        this.redraw();
      }, (ev, moved) => { this.drag = null; if (moved) live.commit(); this.redraw(); }, { threshold: 1 });
      void y0;
    },
    startFade(e, hit, which) {
      const it = hit.item;
      const live = IM.beginLive('Adjust Fade');
      const g = hit.g;
      const d = { kind: 'fade', id: it.id, edge: which, px: this.toContent(e).x };
      this.drag = d;
      this.canvas.style.cursor = 'ew-resize';
      const dur = Pr.dur(it);
      IM.drag(e, (dx, dy, ev) => {
        const q = this.toContent(ev);
        d.px = q.x;
        let v;
        if (which === 'in') v = clamp((q.x - g.startX) / this.pps, 0, dur - (it.audio.fadeOut || 0));
        else v = clamp((g.startX + dur * this.pps - q.x) / this.pps, 0, dur - (it.audio.fadeIn || 0));
        v = Math.round(v * 10) / 10;
        live.update((p) => { const fi = Pr.findItem(p, it.id); if (which === 'in') fi.item.audio.fadeIn = v; else fi.item.audio.fadeOut = v; });
        this.redraw();
      }, (ev, moved) => { this.drag = null; if (moved) live.commit(); this.redraw(); }, { threshold: 1 });
    },
    startSpeed(e, hit) {
      const it = hit.item;
      const live = IM.beginLive('Change Speed');
      const d = { kind: 'speed', id: it.id };
      this.drag = d;
      const srcLen = it.srcOut - it.srcIn;
      const x0 = hit.g.startX;
      IM.drag(e, (dx, dy, ev) => {
        const q = this.toContent(ev);
        const newDur = Math.max(0.1, (q.x - x0) / this.pps);
        let sp = clamp(srcLen / newDur, 0.05, 20);
        const nice = [0.1, 0.25, 0.5, 1, 2, 4, 8, 20];
        for (const n of nice) if (Math.abs(sp - n) / n < 0.04) sp = n;
        live.update((p) => Pr.setSpeed(p, it.id, Math.round(sp * 1000) / 1000));
        this.redraw();
      }, (ev, moved) => { this.drag = null; if (moved) live.commit(); this.redraw(); }, { threshold: 1 });
    },
    startMove(e, hit, pt) {
      const p = this.p;
      const it = hit.item;
      const selIds = app.sel.ids.includes(it.id) ? app.sel.ids.slice() : [it.id];
      const G = this.G;
      const where = hit.where;
      // only move items of the same kind together
      const ids = selIds.filter((id) => { const f = Pr.findItem(p, id); return f && f.where === where; });
      const ghosts = ids.map((id) => G.byId.get(id)).filter(Boolean).map((g) => ({ g, x: g.x0, y: g.y, w: g.x1 - g.x0, h: g.h }));
      const d = {
        kind: 'move', ids, where, item: it, moved: false, dxPx: 0, ghosts, grabX: pt.x, grabY: pt.y,
        hideOriginal: where === 'primary' || where === 'music', copy: e.altKey,
      };
      IM.drag(e, (dx, dy, ev) => {
        if (!d.moved) { d.moved = true; this.drag = d; if (d.copy) d.hideOriginal = false; }
        const q = this.toContent(ev);
        d.dxPx = q.x - d.grabX;
        d.ghostDy = 0;
        d.cur = q;
        this.updateMoveTarget(d, q);
        this.autoScrollDuring(ev);
        this.redraw();
      }, (ev, moved) => {
        this.stopAutoScroll();
        if (!moved) { this.drag = null; this.redraw(); return; }
        this.commitMove(d);
        this.drag = null;
        this.snapX = null;
        this.redraw();
      }, { threshold: 4 });
    },
    /** Compute drop target for moving timeline items. */
    updateMoveTarget(d, q) {
      const G = this.G;
      const p = this.p;
      const L = Pr.layout(p);
      d.insertX = null; d.connectLine = null; d.lane = null; d.musicIndex = null;
      this.dxTarget.clear();
      const primTop = G.primY, primBot = G.primY + G.primH;
      const ghost0 = d.ghosts[0];
      if (d.where === 'primary') {
        const aboveRow = q.y < primTop - 12 && !q.inWell;
        const allVisual = d.ids.every((id) => { const f = Pr.findItem(p, id); return f && f.item.type !== 'title' && f.item.type !== 'audio'; });
        if (aboveRow && allVisual && p.clips.length > d.ids.length) {
          // becomes a cutaway (connected) clip
          d.mode = 'toConnected';
          d.lane = Math.max(1, this.laneAt(q.y) || 1);
          const t = clamp(this.xt(ghost0.x + d.dxPx), 0, L.duration);
          d.dropT = this.snapTime(t, 7);
          const box = this.previewLaneBox(G, d.lane, ghost0.h);
          d.ghostDy = box.y - ghost0.y;
          // close the gap left by the lifted clips
          this.gapTargets(d.ids, -1, 0);
          d.connectLine = { x: this.tx(d.dropT), y0: box.y + box.h, y1: primTop };
          return;
        }
        d.mode = 'reorder';
        const idx = this.insertIndexAt(q.x - (d.grabX - ghost0.x) + (ghost0.w / 2), d.ids);
        d.insertIndex = idx;
        const gapW = d.ghosts.reduce((s, gi) => s + gi.w + GAP * 2, 0);
        this.gapTargets(d.ids, idx, gapW);
        d.insertX = this.insertXFor(idx, d.ids);
        return;
      }
      if (d.where === 'connected') {
        const f = Pr.findItem(p, d.item.id);
        const it = f.item;
        const onPrimary = q.y >= primTop && q.y <= primBot && it.type !== 'audio' && it.type !== 'title';
        if (q.inWell && it.type === 'audio') {
          d.mode = 'toMusic';
          d.musicIndex = Pr.musicIndexAt(p, this.xt(q.x));
          return;
        }
        if (onPrimary) {
          d.mode = 'toPrimary';
          const idx = this.insertIndexAt(q.x, []);
          d.insertIndex = idx;
          this.gapTargets([], idx, d.ghosts.reduce((s, gi) => s + gi.w, 0));
          d.insertX = this.insertXFor(idx, []);
          d.ghostDy = primTop - ghost0.y;
          return;
        }
        d.mode = 'connected';
        const newStart = this.snapTime(this.xt(ghost0.x + d.dxPx), 7, d.item.id);
        d.dropT = clamp(newStart, 0, Math.max(0, L.duration - 0.05));
        d.dxPx = this.tx(d.dropT) - ghost0.x;
        let lane = this.laneAt(q.y);
        if (it.type === 'audio') lane = lane == null || lane > 0 ? -1 : lane;
        else lane = lane == null || lane < 0 ? 1 : lane;
        d.lane = lane;
        d.ghostDy = this.previewLaneBox(G, lane, ghost0.h).y - ghost0.y;
        return;
      }
      if (d.where === 'music') {
        if (q.inWell || q.y > this.H - WELL_H - 20 + this.scroller.scrollTop) {
          d.mode = 'reorderMusic';
          d.musicIndex = Pr.musicIndexAt(p, this.xt(q.x));
          d.ghostDy = 0;
          return;
        }
        d.mode = 'toConnectedAudio';
        const t = this.snapTime(this.xt(ghost0.x + d.dxPx), 7);
        d.dropT = clamp(t, 0, Math.max(0, L.duration - 0.05));
        d.lane = -1;
      }
    },
    laneAt(y) {
      const G = this.G;
      if (y >= G.primY && y <= G.primY + G.primH) return 0;
      if (y < G.primY) {
        // nearest lane at or below the pointer; above the top lane means a new lane
        for (let lane = 1; lane <= G.maxAbove; lane++) if (y >= G.laneY.get(lane)) return lane;
        return G.maxAbove + 1;
      }
      for (let lane = -1; lane >= -G.maxBelow; lane--) if (y < G.laneY.get(lane) + G.laneH.get(lane)) return lane;
      return -(G.maxBelow + 1);
    },
    /** Insertion index among primary clips (excluding ids) for content x. */
    insertIndexAt(x, excludeIds) {
      const G = this.G;
      const list = G.clips.filter((g) => !excludeIds.includes(g.item.id));
      const p = this.p;
      let idx = 0;
      for (const g of list) {
        const baseX0 = g.x0 - (g.off || 0), baseX1 = g.x1 - (g.off || 0);
        if (x > (baseX0 + baseX1) / 2) idx++;
      }
      // convert to index in full clip array
      const remaining = p.clips.filter((c) => !excludeIds.includes(c.id));
      if (idx >= remaining.length) return p.clips.length;
      return p.clips.indexOf(remaining[idx]);
    },
    insertXFor(idx, excludeIds) {
      const G = this.G;
      const p = this.p;
      const next = p.clips[idx];
      if (next && !excludeIds.includes(next.id)) { const g = G.byId.get(next.id); return g.x0 - (g.off || 0) - GAP; }
      const L = Pr.layout(p);
      return this.tx(L.duration);
    },
    /** Animate clips to open a gap of gapW at insertion index (excluding lifted ids). */
    gapTargets(excludeIds, idx, gapW) {
      const G = this.G;
      const p = this.p;
      let removedBefore = 0;
      let passedInsert = false;
      p.clips.forEach((c, i) => {
        const g = G.byId.get(c.id);
        if (!g) return;
        const w = (g.x1 - (g.off || 0)) - (g.x0 - (g.off || 0)) + GAP * 2;
        if (excludeIds.includes(c.id)) { removedBefore += w; return; }
        if (idx >= 0 && i >= idx) passedInsert = true;
        const tgt = -removedBefore + (passedInsert ? gapW : 0);
        this.dxTarget.set(c.id, tgt);
        if (!this.dx.has(c.id)) this.dx.set(c.id, 0);
      });
      this.animating = true;
    },
    commitMove(d) {
      const p = this.p;
      const before = this.captureDisplay();
      this.dxTarget.clear();
      if (d.where === 'primary') {
        if (d.mode === 'toConnected') {
          IM.edit('Move', (pp) => {
            const items = d.ids.map((id) => pp.clips.find((c) => c.id === id)).filter(Boolean);
            const moved = d.copy ? items.map((x) => Object.assign(IM.clone(x), { id: IM.uid('c'), transition: null })) : items;
            if (!d.copy) {
              // keep connected children of the moved clips
              pp.clips = pp.clips.filter((c) => !d.ids.includes(c.id));
              Pr.invalidate(pp);
            }
            moved.forEach((m) => { m.transition = null; });
            Pr.connect(pp, moved, d.dropT, d.lane || 1);
          });
        } else if (d.mode === 'reorder') {
          if (d.copy) {
            IM.edit('Copy', (pp) => {
              const items = d.ids.map((id) => pp.clips.find((c) => c.id === id)).filter(Boolean).map((x) => Object.assign(IM.clone(x), { id: IM.uid('c') }));
              Pr.insertPrimary(pp, d.insertIndex, items);
            });
          } else {
            IM.edit('Move', (pp) => { Pr.moveClips(pp, d.ids, d.insertIndex); });
          }
        }
      } else if (d.where === 'connected') {
        if (d.mode === 'toPrimary') {
          IM.edit('Move', (pp) => {
            const items = d.ids.map((id) => pp.connected.find((c) => c.id === id)).filter(Boolean);
            const clones = items.map((x) => Object.assign(IM.clone(x), { id: d.copy ? IM.uid('c') : x.id, anchorId: null, offset: 0, lane: 1, overlay: null }));
            if (!d.copy) pp.connected = pp.connected.filter((c) => !d.ids.includes(c.id));
            Pr.insertPrimary(pp, d.insertIndex, clones);
          });
        } else if (d.mode === 'toMusic') {
          IM.edit('Move', (pp) => {
            const items = d.ids.map((id) => pp.connected.find((c) => c.id === id)).filter(Boolean);
            if (!d.copy) pp.connected = pp.connected.filter((c) => !d.ids.includes(c.id));
            Pr.addMusic(pp, items.map((x) => (d.copy ? Object.assign(IM.clone(x), { id: IM.uid('c') }) : x)), d.musicIndex);
          });
        } else {
          const L = Pr.layout(p);
          const baseStart = L.byId.get(d.item.id).start;
          const shift = d.dropT - baseStart;
          IM.edit(d.copy ? 'Copy' : 'Move', (pp) => {
            const L2 = Pr.layout(pp);
            const starts = d.ids.map((id) => ({ id, start: L2.byId.get(id).start }));
            for (const s of starts) {
              let id = s.id;
              if (d.copy) {
                const src = pp.connected.find((c) => c.id === s.id);
                const cp = Object.assign(IM.clone(src), { id: IM.uid('c') });
                pp.connected.push(cp); Pr.invalidate(pp);
                id = cp.id;
              }
              Pr.moveConnected(pp, id, s.start + shift, s.id === d.item.id ? d.lane : undefined);
            }
          });
        }
      } else if (d.where === 'music') {
        if (d.mode === 'reorderMusic') {
          IM.edit('Move', (pp) => { Pr.moveMusic(pp, d.item.id, d.musicIndex); });
        } else if (d.mode === 'toConnectedAudio' && p.clips.length) {
          IM.edit('Move', (pp) => {
            const it = pp.music.find((c) => c.id === d.item.id);
            pp.music = pp.music.filter((c) => c.id !== d.item.id);
            Pr.invalidate(pp);
            Pr.connect(pp, [it], d.dropT, -1);
          });
        }
      }
      this.animateFrom(before);
    },

    // ------------------------------------------------------------------ snapping & scrolling
    snapTime(t, px, excludeId) {
      this.snapX = null;
      if (!IM.prefs.snapping || !this.p) return t;
      const tol = px / this.pps;
      let best = t, bd = tol;
      const pts = Pr.snapPoints(this.p);
      pts.push(app.player.t);
      if (excludeId) {
        const e = Pr.layout(this.p).byId.get(excludeId);
        if (e) { const i1 = pts.indexOf(e.start); if (i1 >= 0) pts.splice(i1, 1); const i2 = pts.indexOf(e.end); if (i2 >= 0) pts.splice(i2, 1); }
      }
      for (const s of pts) { const dd = Math.abs(s - t); if (dd < bd) { bd = dd; best = s; } }
      if (best !== t && this.drag) this.snapX = this.tx(best);
      return best;
    },
    autoScrollDuring(ev) {
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      let v = 0;
      if (x < 30) v = -(30 - x) * 0.6;
      else if (x > this.W - 30) v = (x - (this.W - 30)) * 0.6;
      this._asv = v;
      if (v && !this._asRaf) {
        const step = () => {
          if (!this._asv) { this._asRaf = 0; return; }
          this.scroller.scrollLeft += this._asv;
          this._asRaf = requestAnimationFrame(step);
        };
        this._asRaf = requestAnimationFrame(step);
      }
    },
    stopAutoScroll() { this._asv = 0; },
    autoScroll(t) {
      const pl = app.player;
      if (!pl.playing || this.drag) return;
      if (performance.now() - this.lastUserScroll < 1200 && !this._followScrolled) return;
      const x = this.tx(t) - this.scroller.scrollLeft;
      if (x > this.W - 40 || x < 0) {
        this._followScrolled = true;
        this.scroller.scrollLeft = Math.max(0, this.tx(t) - 60);
        setTimeout(() => { this._followScrolled = false; }, 50);
      }
    },
    scrollToTime(t) {
      const x = this.tx(t);
      if (x < this.scroller.scrollLeft + 20 || x > this.scroller.scrollLeft + this.W - 40) this.scroller.scrollLeft = Math.max(0, x - this.W / 3);
    },
    revealItems(ids) {
      if (!ids || !ids.length || !this.p) return;
      const e = Pr.layout(this.p).byId.get(ids[ids.length - 1]);
      if (e) this.scrollToTime(e.end);
      this.updateEmpty();
    },

    // ------------------------------------------------------------------ zoom
    zoomBy(f, anchorT) {
      if (!this.p) return;
      const t = anchorT != null ? anchorT : app.player.t;
      const vx = this.tx(t) - this.scroller.scrollLeft;
      this.pps = this.pps * f;
      this.p.settings.zoomSet = true;
      IM.lib.saveProject(this.p);
      this._draw();
      this.scroller.scrollLeft = Math.max(0, this.tx(t) - vx);
      this.redraw();
    },
    zoomToFit() {
      if (!this.p) return;
      const d = Pr.duration(this.p);
      if (d <= 0) return;
      this.pps = clamp((this.W - PAD_L - 40) / d, 1.5, 800);
      this.p.settings.zoomSet = true;
      this.scroller.scrollLeft = 0;
      this.redraw();
    },
    onWheel(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const pt = this.toContent(e);
        this.zoomBy(Math.exp(-e.deltaY * 0.01), this.xt(pt.x));
        return;
      }
      // vertical wheel over timeline scrolls horizontally when there's no vertical overflow
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && this.scroller.scrollHeight <= this.scroller.clientHeight + 2) {
        e.preventDefault();
        this.scroller.scrollLeft += e.deltaY;
      }
    },

    // ------------------------------------------------------------------ double click & context menu
    onDbl(e) {
      const pt = this.toContent(e);
      const hit = this.hit(pt);
      if (hit.kind === 'transition') { this.transitionPopover(hit.clip, hit.tr); return; }
      if (hit.kind !== 'item') return;
      const it = hit.item;
      if (it.type === 'title') { IM.select([it.id]); if (IM.viewerUI) IM.viewerUI.editTitle(it.id); return; }
      if (hit.part === 'trimStart' || hit.part === 'trimEnd') { if (IM.precisionEditor) IM.precisionEditor.open(it.id, hit.part === 'trimStart' ? 'start' : 'end'); return; }
    },
    transitionPopover(clip, tr) {
      const p = this.p;
      const r = this.canvas.getBoundingClientRect();
      const anchor = { left: r.left + tr.x - this.scroller.scrollLeft - tr.w / 2, top: r.top + tr.y - this.scroller.scrollTop, width: tr.w, height: tr.h, right: 0, bottom: 0 };
      anchor.right = anchor.left + anchor.width; anchor.bottom = anchor.top + anchor.height;
      const field = h('input.text-field.dur-field', { type: 'text', value: clip.transition.dur.toFixed(1) });
      const apply = () => {
        const v = parseFloat(field.value);
        if (!isFinite(v) || v <= 0) return;
        IM.edit('Change Transition Duration', (pp) => { const c = pp.clips.find((x) => x.id === clip.id); if (c && c.transition) c.transition.dur = clamp(v, 0.1, 10); });
      };
      field.addEventListener('change', apply);
      field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { apply(); IM.closePopovers(); } ev.stopPropagation(); });
      const content = h('div.tr-pop',
        h('div.pop-row', h('label', 'Duration:'), field, h('span', { style: { color: '#aaa' } }, 's')),
        h('button.btn', {
          on: {
            click: () => {
              apply();
              const v = parseFloat(field.value);
              IM.edit('Apply to All Transitions', (pp) => { for (const c of pp.clips) if (c.transition) c.transition.dur = clamp(v, 0.1, 10); });
              IM.closePopovers();
            },
          },
        }, 'Apply to All Transitions'));
      IM.popover(anchor, content, { side: 'top' });
      setTimeout(() => { field.focus(); field.select(); }, 30);
      void p;
    },
    onContext(e) {
      e.preventDefault();
      const pt = this.toContent(e);
      const hit = this.hit(pt);
      const run = (c) => () => IM.run(c);
      const k = (c) => ({ disabled: !IM.can(c) });
      if (hit.kind === 'transition') {
        IM.selectTransition(hit.clip.id);
        IM.contextMenu(e, [
          { label: 'Change Duration…', action: () => this.transitionPopover(hit.clip, hit.tr) },
          { label: 'Delete', action: run('delete') },
        ]);
        return;
      }
      if (hit.kind !== 'item') {
        IM.contextMenu(e, [
          Object.assign({ label: 'Paste', key: 'cmd+v', action: run('paste') }, k('paste')),
          { separator: true },
          Object.assign({ label: 'Select All', key: 'cmd+a', action: run('selectAll') }, k('selectAll')),
        ]);
        return;
      }
      if (!app.sel.ids.includes(hit.item.id)) IM.select([hit.item.id]);
      const it = hit.item;
      const items = [
        Object.assign({ label: 'Cut', key: 'cmd+x', action: run('cut') }, k('cut')),
        Object.assign({ label: 'Copy', key: 'cmd+c', action: run('copy') }, k('copy')),
        Object.assign({ label: 'Paste', key: 'cmd+v', action: run('paste') }, k('paste')),
        Object.assign({ label: 'Delete', key: 'delete', action: run('delete') }, k('delete')),
        { separator: true },
        Object.assign({ label: 'Split Clip', key: 'cmd+b', action: run('split') }, k('split')),
      ];
      if (it.type === 'video') {
        items.push(Object.assign({ label: 'Join Clip', action: run('join') }, k('join')));
        items.push(Object.assign({ label: 'Detach Audio', key: 'alt+cmd+b', action: run('detachAudio') }, k('detachAudio')));
        items.push({ separator: true });
        items.push(Object.assign({ label: 'Add Freeze Frame', key: 'alt+f', action: run('freezeFrame') }, k('freezeFrame')));
      }
      if (it.type === 'video' || it.type === 'audio') {
        items.push({ separator: true });
        items.push({ label: 'Show Clip Trimmer', key: 'cmd+\\', action: () => IM.clipTrimmer.open(it.id) });
      }
      if (hit.where === 'primary' && this.p.clips.length > 1) {
        items.push(Object.assign({ label: 'Show Precision Editor', key: 'cmd+/', action: () => IM.precisionEditor && IM.precisionEditor.open(it.id, 'end') }, {}));
        items.push(Object.assign({ label: 'Add Cross Dissolve', key: 'cmd+t', action: run('addCrossDissolve') }, k('addCrossDissolve')));
      }
      if (it.mediaId && !IM.lib.get(it.mediaId).builtin) {
        items.push({ separator: true });
        items.push({ label: 'Reveal in Project Media', action: () => IM.browserUI && IM.browserUI.reveal(it.mediaId, it.srcIn, it.srcOut) });
      }
      IM.contextMenu(e, items);
    },

    // ------------------------------------------------------------------ external drag (from browsers)
    /**
     * payload: {kind:'media', items:[{mediaId,a,b}], dur, audioOnly} | {kind:'title', style} | {kind:'bg', bgId} | {kind:'transition', type}
     */
    dragOver(payload, clientX, clientY) {
      if (!this.p) return false;
      const r = this.canvas.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) { this.dragLeave(); return false; }
      const pt = this.toContent({ clientX, clientY });
      const G = this.G || this.geom();
      const L = Pr.layout(this.p);
      const t = clamp(this.xt(pt.x), 0, 1e9);
      const x = { time: t, dur: payload.dur || 4, target: null, lane: null };
      const primTop = G.primY, primBot = G.primY + G.primH;
      if (payload.kind === 'transition') {
        // nearest edit point
        let best = null, bd = 40;
        for (let i = 0; i < G.clips.length - 1; i++) {
          const g = G.clips[i];
          const dd = Math.abs(pt.x - (g.x1 + GAP));
          if (dd < bd && pt.y > primTop - 20 && pt.y < primBot + 20) { bd = dd; best = g; }
        }
        if (best) { x.target = 'transition'; x.clipId = best.item.id; }
      } else if (pt.inWell) {
        if (payload.kind === 'media') { x.target = 'music'; x.time = Pr.musicEnd(this.p); }
      } else if (!L.clips.length) {
        x.target = 'append';
      } else if (payload.kind === 'title') {
        if (pt.y >= primTop && pt.y <= primBot) {
          const g = G.clips.find((c) => pt.x >= c.x0 && pt.x <= c.x1);
          if (g && pt.x > g.x0 + 18 && pt.x < g.x1 - 18) { x.target = 'titleAbove'; x.lane = this.freeLane(t, x.dur, 1); x.time = this.snapTime(t, 8); }
          else { x.target = 'insert'; x.index = this.insertIndexAt(pt.x, []); x.insertX = this.insertXFor(x.index, []); }
        } else if (pt.y < primTop) {
          x.target = 'titleAbove'; x.time = clamp(this.snapTime(t, 8), 0, L.duration - 0.05); x.lane = Math.max(1, this.laneAt(pt.y) || 1);
        } else if (t >= L.duration) { x.target = 'insert'; x.index = this.p.clips.length; x.insertX = this.tx(L.duration); }
      } else if (payload.kind === 'bg') {
        if (pt.y < primTop - 8) { x.target = 'connect'; x.lane = Math.max(1, this.laneAt(pt.y) || 1); x.time = clamp(this.snapTime(t, 8), 0, L.duration - 0.05); }
        else { x.target = 'insert'; x.index = this.insertIndexAt(pt.x, []); x.insertX = this.insertXFor(x.index, []); }
      } else if (payload.kind === 'media') {
        const audioOnly = payload.audioOnly;
        if (audioOnly) {
          if (pt.y > primBot || (pt.y >= primTop && pt.y <= primBot)) {
            x.target = 'audio'; x.lane = pt.y > primBot ? Math.min(-1, this.laneAt(pt.y) || -1) : -1;
            x.time = clamp(this.snapTime(t, 8), 0, Math.max(0, L.duration - 0.05));
            x.lane = this.freeLane(x.time, x.dur, x.lane);
          } else { x.target = 'audio'; x.lane = -1; x.time = clamp(this.snapTime(t, 8), 0, L.duration - 0.05); x.lane = this.freeLane(x.time, x.dur, -1); }
        } else if (pt.y < primTop - 6) {
          x.target = 'connect'; x.lane = Math.max(1, this.laneAt(pt.y) || 1);
          x.time = clamp(this.snapTime(t, 8), 0, Math.max(0, L.duration - 0.05));
        } else if (t >= L.duration - 0.01) {
          x.target = 'insert'; x.index = this.p.clips.length; x.insertX = this.tx(L.duration);
        } else {
          const g = G.clips.find((c) => pt.x >= c.x0 && pt.x <= c.x1 && pt.y >= primTop && pt.y <= primBot);
          const edgeZone = g ? Math.min(28, (g.x1 - g.x0) * 0.22) : 0;
          if (g && pt.x > g.x0 + edgeZone && pt.x < g.x1 - edgeZone) { x.target = 'replace'; x.replaceId = g.item.id; }
          else { x.target = 'insert'; x.index = this.insertIndexAt(pt.x, []); x.insertX = this.insertXFor(x.index, []); }
        }
      }
      // gap animation for inserts
      this.dxTarget.clear();
      if (x.target === 'insert' && x.index != null && x.index < this.p.clips.length) this.gapTargets([], x.index, (payload.dur || 4) * this.pps);
      else for (const k of this.dx.keys()) this.dxTarget.set(k, 0);
      this.animating = true;
      this.ext = x;
      this.hovering = true;
      if (x.target === 'insert' || x.target === 'connect' || x.target === 'audio' || x.target === 'titleAbove') app.player.setSkim(clamp(x.time, 0, L.duration));
      this.autoScrollDuring({ clientX });
      this.redraw();
      return !!x.target;
    },
    freeLane(t, dur, lane) {
      const L = Pr.layout(this.p);
      const sign = lane < 0 ? -1 : 1;
      let l = Math.abs(lane);
      for (;;) {
        const busy = L.connected.some((e) => Math.abs(e.lane) === l && Math.sign(e.lane) === sign && e.start < t + dur && e.end > t);
        if (!busy) return l * sign;
        l++;
      }
    },
    dragLeave() {
      if (!this.ext) return;
      this.ext = null;
      for (const k of this.dx.keys()) this.dxTarget.set(k, 0);
      this.animating = true;
      this.stopAutoScroll();
      this.redraw();
    },
    drop(payload, clientX, clientY) {
      const ok = this.dragOver(payload, clientX, clientY);
      const x = this.ext;
      this.stopAutoScroll();
      if (!ok || !x) { this.dragLeave(); return false; }
      this.ext = null;
      const before = this.captureDisplay();
      this.dxTarget.clear(); this.dx.clear();
      const p = this.p;
      if (payload.kind === 'transition') {
        IM.edit('Add Transition', (pp) => Pr.setTransition(pp, x.clipId, payload.type, IM.prefs.transitionDuration));
        IM.selectTransition(x.clipId);
        this.redraw();
        return true;
      }
      if (payload.kind === 'title') {
        const it = Pr.makeTitle(payload.style);
        if (x.target === 'titleAbove') IM.edit('Add Title', (pp) => { Pr.connect(pp, [it], x.time, x.lane); });
        else IM.edit('Add Title', (pp) => { Pr.insertPrimary(pp, x.index != null ? x.index : pp.clips.length, [it]); });
        IM.select([it.id]);
        this.animateFrom(before);
        return true;
      }
      if (payload.kind === 'bg') {
        const it = Pr.makeBackground(payload.bgId);
        if (x.target === 'connect') IM.edit('Add Background', (pp) => { Pr.connect(pp, [it], x.time, x.lane); });
        else IM.edit('Add Background', (pp) => { Pr.insertPrimary(pp, x.index != null ? x.index : pp.clips.length, [it]); });
        IM.select([it.id]);
        this.animateFrom(before);
        return true;
      }
      // media
      const items = IM.mediaItemsFromSelection(payload.items);
      if (!items.length) return false;
      if (x.target === 'replace') {
        this.replaceMenu(clientX, clientY, x.replaceId, payload);
        this.redraw();
        return true;
      }
      if (x.target === 'music') {
        const aud = items.map((it) => (it.type === 'audio' ? it : Object.assign(it, { type: 'audio' })));
        IM.edit('Add Music', (pp) => Pr.addMusic(pp, aud));
        IM.select(aud.map((a) => a.id));
      } else if (x.target === 'audio') {
        const aud = items.map((it) => Object.assign(it, { type: 'audio' }));
        if (!p.clips.length) IM.edit('Add Music', (pp) => Pr.addMusic(pp, aud));
        else IM.edit('Add Audio', (pp) => Pr.connect(pp, aud, x.time, x.lane || -1));
        IM.select(aud.map((a) => a.id));
      } else if (x.target === 'connect') {
        const vis = items.filter((it) => it.type !== 'audio');
        IM.edit('Add Cutaway', (pp) => Pr.connect(pp, vis, x.time, x.lane || 1));
        IM.select(vis.map((a) => a.id));
      } else {
        const vis = items.filter((it) => it.type !== 'audio');
        const aud = items.filter((it) => it.type === 'audio');
        IM.edit(x.target === 'append' ? 'Add to Movie' : 'Insert', (pp) => {
          if (vis.length) Pr.insertPrimary(pp, x.target === 'append' ? pp.clips.length : x.index, vis);
          if (aud.length) Pr.addMusic(pp, aud);
        });
        IM.select(vis.concat(aud).map((a) => a.id));
        if (x.target === 'append' && vis.length) { const e = Pr.layout(p).byId.get(vis[0].id); if (e) app.player.seek(e.start); }
      }
      this.updateEmpty();
      this.animateFrom(before);
      IM.bus.emit('added', items.map((i) => i.id));
      return true;
    },
    replaceMenu(cx, cy, clipId, payload) {
      const doReplace = (mode) => {
        const items = IM.mediaItemsFromSelection(payload.items).filter((it) => it.type !== 'audio');
        if (!items.length) return;
        IM.edit('Replace', (pp) => Pr.replaceClip(pp, clipId, items[0], mode));
        IM.select([items[0].id]);
      };
      const m = new IM.Menu([
        { label: 'Replace', action: () => doReplace('replace') },
        { label: 'Replace from Start', action: () => doReplace('start') },
        { label: 'Replace from End', action: () => doReplace('end') },
        { label: 'Insert', action: () => {
          const items = IM.mediaItemsFromSelection(payload.items).filter((it) => it.type !== 'audio');
          const pt = this.toContent({ clientX: cx, clientY: cy });
          const t = clamp(this.xt(pt.x), 0, Pr.duration(this.p));
          IM.edit('Insert', (pp) => Pr.insertAt(pp, t, items));
          IM.select(items.map((i) => i.id));
        } },
        { separator: true },
        { label: 'Cancel', action: () => {} },
      ]);
      m.showAt(cx + 2, cy + 2);
    },

    // ------------------------------------------------------------------ project settings popover
    settingsPopover(anchor) {
      const p = this.p;
      if (!p) return;
      const filterName = (IM.Filters.get(p.settings.filter || 'none') || IM.Filters.get('none')).name;
      const themeName = p.settings.theme ? (IM.Themes && IM.Themes.get(p.settings.theme) ? IM.Themes.get(p.settings.theme).name : 'No Theme') : 'No Theme';
      const themeBtn = h('button.ps-thumb', { on: { click: () => { IM.closePopovers(); IM.themes && IM.themes.chooser(); } } }, h('div.ps-theme-art', themeName === 'No Theme' ? '' : themeName[0]));
      const filterBtn = h('button.ps-thumb.filter', { on: { click: () => { IM.closePopovers(); IM.inspector && IM.inspector.projectFilterChooser(anchor); } } });
      const sizeSlider = IM.slider({
        min: 0, max: 1, step: 0.01, value: p.settings.clipSize == null ? 0.35 : p.settings.clipSize,
        onInput: (v) => { p.settings.clipSize = v; this.redraw(); },
        onChange: () => IM.lib.saveProject(p),
      });
      const waves = IM.checkbox('Show Waveforms', p.settings.waveforms !== false, (v) => { p.settings.waveforms = v; IM.lib.saveProject(p); this.redraw(); });
      const tmusic = IM.checkbox('Theme music', !!p.settings.themeMusic, (v) => { p.settings.themeMusic = v; IM.lib.saveProject(p); });
      tmusic.querySelector('input').disabled = !p.settings.theme;
      const content = h('div.ps-pop',
        h('h4', 'Project Settings'),
        h('div.ps-row', themeBtn, h('div.ps-col', h('div.ps-label', 'Theme'), h('div.ps-value', themeName))),
        h('div.ps-row', filterBtn, h('div.ps-col', h('div.ps-label', 'Filter'), h('div.ps-value', filterName))),
        h('div.ps-row.indent', tmusic),
        h('div.pop-sep'),
        h('div.ps-size', h('span', 'Clip Size'), h('span.ps-small', IM.icon('film', 12)), sizeSlider, h('span.ps-large', IM.icon('film', 18))),
        h('div.ps-row.indent', waves));
      IM.popover(anchor, content, { side: 'bottom', align: 'right' });
    },
  };
  IM.timelineUI = TL;
})(window.IM = window.IM || {});
