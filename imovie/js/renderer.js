/* Frame composition (project -> frame spec) and WebGL rendering */
(function (IM) {
  'use strict';
  const P = () => IM.Project;
  const clamp = IM.clamp;

  // ======================================================================
  // Compose: build a frame description for project p at time t
  // ======================================================================
  const Compose = {
    /**
     * provider: { video(item, srcTime, entry) -> {src,key,w,h,stamp}|null, image(item) -> {...}|null }
     */
    frame(p, t, provider, opts) {
      opts = opts || {};
      const Pr = P();
      const L = Pr.layout(p);
      const spec = { base: null, overlays: [], titles: [], projectFilter: p.settings.filter || 'none', time: t };
      if (!L.clips.length) return spec;
      const tt = Math.min(t, Math.max(0, L.duration - 1e-3));
      const act = Pr.activeAt(p, tt);
      const prim = act.prim;
      if (prim.length === 1) spec.base = Compose.layer(prim[0], tt, provider, true, opts);
      else if (prim.length >= 2) {
        const a = prim[0], b = prim[1];
        const d = a.trOut || 0.001;
        const prog = clamp((tt - b.start) / d, 0, 1);
        spec.base = {
          kind: 'transition', type: (a.item.transition && a.item.transition.type) || 'cross-dissolve', p: prog,
          a: Compose.layer(a, tt, provider, true, opts), b: Compose.layer(b, tt, provider, true, opts),
        };
      }
      const conn = act.conn.filter((e) => e.item.type !== 'audio').sort((x, y) => x.lane - y.lane);
      for (const e of conn) {
        if (opts.skipIds && opts.skipIds.has(e.item.id)) continue;
        const it = e.item;
        const local = tt - e.start;
        if (it.type === 'title') {
          spec.titles.push({ kind: 'title', title: it.title, local, dur: e.dur, id: it.id, opacity: 1 });
          continue;
        }
        const layer = Compose.layer(e, tt, provider, false, opts);
        if (!layer) continue;
        const ov = it.overlay || Pr.defaultOverlay();
        let op = ov.opacity == null ? 1 : ov.opacity;
        let tp = 1; // entrance/exit progress for pip/split
        if (ov.fade > 0) {
          const f = Math.min(ov.fade, e.dur / 2);
          tp = clamp(Math.min(local / f, (e.dur - local) / f), 0, 1);
        }
        if (ov.mode === 'cutaway') op *= tp;
        spec.overlays.push({ mode: ov.mode, layer, opacity: op, progress: tp, ov, id: it.id, local, dur: e.dur });
      }
      return spec;
    },
    /** Layer spec for a timeline entry at time t. primary: letterbox black outside */
    layer(e, t, provider, primary, opts) {
      const Pr = P();
      const it = e.item;
      const local = clamp(t - e.start, 0, e.dur);
      const v = it.video || Pr.defaultVideo();
      let filter = v.filter || 'none';
      if (opts && opts.filterOverride && opts.filterOverride.id === it.id) filter = opts.filterOverride.filter;
      const base = { video: v, filter, time: local, opacity: 1, primary, id: it.id };
      if (it.type === 'title') return Object.assign(base, { kind: 'titleclip', title: it.title, local, dur: e.dur });
      if (it.type === 'bg') {
        const bg = IM.Backgrounds.get(it.bgId) || IM.Backgrounds.get('black');
        return Object.assign(base, { kind: 'bg', bgKind: bg.kind, c1: IM.hexToRgb((it.bg && it.bg.color1) || bg.color1 || '#000'), c2: IM.hexToRgb((it.bg && it.bg.color2) || bg.color2 || '#000') });
      }
      const m = IM.lib.get(it.mediaId);
      if (!m) return Object.assign(base, { kind: 'missing' });
      let src = null;
      if (it.type === 'image') src = provider.image(it, m);
      else if (it.type === 'freeze' || it.type === 'video') src = provider.video(it, Pr.sampleTime(it, local, m), e, m);
      if (!src) return Object.assign(base, { kind: 'pending' });
      const rect = Pr.cropRectAt(it, m, local, e.dur);
      const rot = ((((v.rotate || 0) + (src.metaRot || 0)) / 90) | 0) % 4;
      let stab = null;
      if (it.type !== 'image' && IM.stabilizer && IM.stabilizer.needs(v)) {
        // correction for the frame actually drawn (its own timestamp), identical in viewer and export
        const ts = src.ts != null ? src.ts : Pr.sampleTime(it, local, m);
        stab = IM.stabilizer.forFrame(it, m, ts, src.metaRot || 0, src.w / src.h, opts && opts.noStabRequest);
        if (!stab && opts && opts.strict) return Object.assign(base, { kind: 'pending', why: 'stabilization' });
      }
      return Object.assign(base, { kind: 'media', src, rect, rot, flip: filter === 'flipped', stab });
    },
  };
  IM.Compose = Compose;

  // ======================================================================
  // Renderer
  // ======================================================================
  class Renderer {
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      this.g = new IM.GL(canvas, { preserve: !!opts.preserve });
      this.W = 0; this.H = 0;
      this.fb = null;
      this.tex = new Map();
      this.keyColors = new Map();
      this.titleCanvas = document.createElement('canvas');
      this.titleCtx = this.titleCanvas.getContext('2d');
      this.titleTex = this.g.texture();
      this.setSize(opts.width || 960, opts.height || 540);
      IM.bus.on('gl-restored', () => { if (this.g.lost === false) this._rebuild(); });
    }
    _rebuild() {
      this.tex.clear();
      this.titleTex = this.g.texture();
      const w = this.W, h = this.H;
      this.W = 0; this.H = 0;
      this.setSize(w, h);
    }
    setSize(w, h) {
      w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
      if (w === this.W && h === this.H) return;
      this.W = w; this.H = h;
      this.canvas.width = w; this.canvas.height = h;
      const g = this.g;
      if (this.fb) Object.values(this.fb).forEach((f) => g.deleteFbo(f));
      this.fb = {};
      ['a', 'b', 'acc', 'acc2', 'o', 'bg', 'tmp'].forEach((k) => { this.fb[k] = g.fbo(w, h); });
      this.titleCanvas.width = w; this.titleCanvas.height = h;
    }
    // ---------- programs ----------
    prog(key, srcFn) { return this.g.program(key, srcFn()); }
    clipProg(f) { return this.prog('clip:' + f, () => IM.Shaders.clip(f)); }
    trProg(t) { return this.prog('tr:' + t, () => IM.Shaders.transition(t)); }
    bgProg(k) { return this.prog('bg:' + k, () => IM.Shaders.background(k)); }
    simple(name) { return this.prog(name, () => IM.Shaders[name]); }

    // ---------- textures ----------
    textureFor(src) {
      let rec = this.tex.get(src.key);
      if (!rec) {
        rec = { t: this.g.texture(), stamp: null, used: 0 };
        this.tex.set(src.key, rec);
        if (this.tex.size > 40) this._gcTextures();
      }
      rec.used = performance.now();
      const needs = src.stamp == null || rec.stamp !== src.stamp;
      if (needs) {
        const ok = this.g.upload(rec.t, src.src, src.w, src.h);
        if (ok) rec.stamp = src.stamp;
      }
      return rec.t;
    }
    _gcTextures() {
      const arr = Array.from(this.tex.entries()).sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < arr.length - 30; i++) { this.g.deleteTexture(arr[i][1].t); this.tex.delete(arr[i][0]); }
    }
    dropTexture(key) {
      const r = this.tex.get(key);
      if (r) { this.g.deleteTexture(r.t); this.tex.delete(key); }
    }

    // ---------- main ----------
    render(spec, opts) {
      if (this.g.lost) return;
      opts = opts || {};
      const g = this.g, fb = this.fb;
      const res = [this.W, this.H];
      // base
      if (!spec.base) g.clear(fb.acc, [0, 0, 0, 1]);
      else if (spec.base.kind === 'transition') {
        this.renderLayer(spec.base.a, fb.a, true);
        this.renderLayer(spec.base.b, fb.b, true);
        g.draw(this.trProg(spec.base.type), fb.acc, { u_p: spec.base.p, u_ratio: this.W / this.H, u_res: res, u_time: spec.time || 0 }, { u_from: fb.a, u_to: fb.b });
      } else this.renderLayer(spec.base, fb.acc, true);

      // overlays
      for (const ov of spec.overlays) {
        this.renderLayer(ov.layer, fb.o, false);
        if (ov.mode === 'pip') {
          const pp = ov.ov.pip;
          let sc = pp.scale, op = ov.opacity;
          if (pp.style === 'zoom') sc *= IM.ease.outCubic(ov.progress); else op *= ov.progress;
          const w = sc, h = sc;
          const cx = pp.x + pp.scale / 2, cy = pp.y + pp.scale / 2;
          const border = pp.border === 'thick' ? 6 : pp.border === 'thin' ? 2.5 : 0;
          g.draw(this.simple('PLACE'), fb.acc, {
            u_dst: [cx - w / 2, cy - h / 2, w, h], u_opacity: op, u_border: border * this.H / 540,
            u_borderColor: IM.hexToRgb(pp.borderColor || '#ffffff'), u_shadow: pp.shadow ? 1 : 0, u_res: res,
          }, { u_tex: fb.o }, { blend: true });
        } else if (ov.mode === 'split') {
          const sideIdx = { left: 0, right: 1, top: 2, bottom: 3 }[ov.ov.split.side] || 0;
          let slide = 1;
          if (ov.ov.split.slide > 0) slide = IM.ease.inOutCubic(clamp(ov.local / ov.ov.split.slide, 0, 1));
          g.draw(this.simple('SPLIT'), fb.acc2, { u_side: sideIdx, u_slide: slide, u_opacity: ov.opacity }, { u_base: fb.acc, u_ov: fb.o });
          this._swapAcc();
        } else if (ov.mode === 'greenscreen') {
          const key = this.keyColor(ov.id, ov.ov.key);
          const k = ov.ov.key;
          const crop = k.crop || [0, 0, 1, 1];
          g.draw(this.simple('CHROMA'), fb.acc, {
            u_key: key, u_soft: k.softness == null ? 0.5 : k.softness, u_tol: 0.08 + (k.strength == null ? 0.4 : k.strength) * 0.12,
            u_opacity: ov.opacity, u_crop: [crop[0], crop[1], crop[2], crop[3]],
          }, { u_tex: fb.o }, { blend: true });
        } else {
          g.draw(this.simple('PLACE'), fb.acc, { u_dst: [0, 0, 1, 1], u_opacity: ov.opacity, u_border: 0, u_shadow: 0, u_res: res }, { u_tex: fb.o }, { blend: true });
        }
      }
      // project-wide filter (before titles)
      if (spec.projectFilter && spec.projectFilter !== 'none') {
        g.draw(this.clipProg(spec.projectFilter), fb.acc2, this.clipUniforms(null, [0, 0, 1, 1], 0, spec.projectFilter === 'flipped', 1, spec.time), { u_tex: fb.acc });
        this._swapAcc();
      }
      // titles
      for (const t of spec.titles) this.drawTitle(t, fb.acc);
      // present
      if (!opts.noPresent) g.draw(this.simple('COPY'), null, { u_opacity: 1, u_fade: spec.fade || 0 }, { u_tex: fb.acc });
    }
    _swapAcc() { const t = this.fb.acc; this.fb.acc = this.fb.acc2; this.fb.acc2 = t; }

    clipUniforms(v, rect, rot, flip, outside, time, stab) {
      v = v || IM.Project.defaultVideo();
      const c = v.color || {};
      const b = v.balance || {};
      const gains = b.mode && b.mode !== 'none' && b.gains ? b.gains : [1, 1, 1];
      return {
        u_rect: [rect.x != null ? rect.x : rect[0], rect.y != null ? rect.y : rect[1], rect.w != null ? rect.w : rect[2], rect.h != null ? rect.h : rect[3]],
        u_rot: rot || 0, u_flip: flip ? 1 : 0, u_outside: outside ? 1 : 0,
        u_gains: gains, u_levels: [c.shadows || 0, c.bright || 0, c.highlights || 0],
        u_contrast: c.contrast || 0, u_sat: c.sat == null ? 1 : c.sat, u_temp: c.temp || 0,
        u_opacity: 1, u_amount: 1, u_time: time || 0, u_res: [this.W, this.H],
        u_stab: stab ? stab.s : [0, 0, 0, 0], u_rs: stab ? stab.rs : [0, 0, 0, 1], u_rsDir: stab ? stab.dir : [0, 1],
      };
    }
    /** Render a layer spec full-frame into target fbo. primary: black outside the picture. */
    renderLayer(L, target, primary) {
      const g = this.g, fb = this.fb;
      if (!L || L.kind === 'pending' || L.kind === 'missing') {
        g.clear(target, primary ? [0, 0, 0, 1] : [0, 0, 0, 0]);
        return;
      }
      if (L.kind === 'media') {
        const tex = this.textureFor(L.src);
        const u = this.clipUniforms(L.video, L.rect, L.rot, L.flip, primary, L.time, L.stab);
        g.draw(this.clipProg(L.filter), target, u, { u_tex: tex });
        return;
      }
      if (L.kind === 'bg') {
        const v = L.video || {};
        const col = v.color || {};
        const plain = (!L.filter || L.filter === 'none') && !(v.balance && v.balance.mode !== 'none') && !col.shadows && !col.bright && !col.highlights && !col.contrast && (col.sat == null || col.sat === 1) && !col.temp;
        const dst = plain ? target : fb.bg;
        g.draw(this.bgProg(L.bgKind), dst, { u_c1: L.c1, u_c2: L.c2, u_time: L.time, u_res: [this.W, this.H] });
        if (!plain) g.draw(this.clipProg(L.filter), target, this.clipUniforms(L.video, [0, 0, 1, 1], 0, L.filter === 'flipped', true, L.time), { u_tex: fb.bg });
        return;
      }
      if (L.kind === 'titleclip') {
        g.clear(target, [0, 0, 0, 1]);
        this.drawTitle({ title: L.title, local: L.local, dur: L.dur, opacity: 1 }, target);
        return;
      }
      g.clear(target, primary ? [0, 0, 0, 1] : [0, 0, 0, 0]);
    }
    drawTitle(t, target) {
      const ctx = this.titleCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      const r = IM.renderTitle(ctx, this.W, this.H, t.title, t.local, t.dur) || {};
      this.g.upload(this.titleTex, this.titleCanvas, this.W, this.H);
      this.g.draw(this.simple('TITLE'), target, {
        u_opacity: (r.opacity == null ? 1 : r.opacity) * (t.opacity == null ? 1 : t.opacity),
        u_blur: r.blur || 0, u_useH: r.H ? 1 : 0, u_H: r.H || [1, 0, 0, 0, 1, 0, 0, 0, 1], u_res: [this.W, this.H],
      }, { u_tex: this.titleTex }, { blend: true });
    }
    /** Determine chroma key colour for a green/blue screen overlay (auto-detected from the frame border). */
    keyColor(id, key) {
      if (key && key.color) return IM.hexToRgb(key.color);
      const cached = this.keyColors.get(id);
      if (cached && performance.now() - cached.at < 4000) return cached.rgb;
      const g = this.g.gl;
      const w = 32, h = 18;
      if (!this._small) this._small = this.g.fbo(w, h);
      this.g.draw(this.simple('COPY'), this._small, { u_opacity: 1, u_fade: 0 }, { u_tex: this.fb.o });
      const px = new Uint8Array(w * h * 4);
      g.bindFramebuffer(g.FRAMEBUFFER, this._small.fb);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      let gs = [0, 0, 0, 0], bs = [0, 0, 0, 0];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = px[i + 3] / 255 || 1;
        const r = px[i] / a, gg = px[i + 1] / a, b = px[i + 2] / a;
        if (gg > r * 1.15 && gg > b * 1.15) { gs[0] += r; gs[1] += gg; gs[2] += b; gs[3]++; }
        else if (b > r * 1.15 && b > gg * 1.05) { bs[0] += r; bs[1] += gg; bs[2] += b; bs[3]++; }
      }
      let rgb;
      if (gs[3] >= bs[3] && gs[3] > 0) rgb = [gs[0] / gs[3] / 255, gs[1] / gs[3] / 255, gs[2] / gs[3] / 255];
      else if (bs[3] > 0) rgb = [bs[0] / bs[3] / 255, bs[1] / bs[3] / 255, bs[2] / bs[3] / 255];
      else rgb = [0.1, 0.8, 0.2];
      this.keyColors.set(id, { rgb, at: performance.now() });
      return rgb;
    }
    /** Read back current output to a 2D canvas (for thumbnails/snapshots). */
    snapshot(w, h) {
      const c = document.createElement('canvas');
      c.width = w || this.W; c.height = h || this.H;
      c.getContext('2d').drawImage(this.canvas, 0, 0, c.width, c.height);
      return c;
    }
  }
  IM.Renderer = Renderer;
})(window.IM = window.IM || {});
