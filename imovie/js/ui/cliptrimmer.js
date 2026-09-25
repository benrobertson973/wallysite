/* Clip Trimmer (Window > Show Clip Trimmer, ⌘\) and Precision Editor (⌘/) */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;
  const clamp = IM.clamp;

  function drawStrip(ctx, m, x, y, w, hh, t0, t1) {
    const tw = Math.round(hh * 16 / 9);
    ctx.fillStyle = '#111'; ctx.fillRect(x, y, w, hh);
    if (m.kind === 'audio') {
      ctx.fillStyle = '#1b4722'; ctx.fillRect(x, y, w, hh);
      if (m.peaks) {
        ctx.fillStyle = '#4cb857';
        const pd = m.peaks.data, r = m.peaks.rate;
        for (let px = 0; px < w; px++) {
          const a = t0 + (px / w) * (t1 - t0), b = t0 + ((px + 1) / w) * (t1 - t0);
          let pk = 0; for (let i = Math.floor(a * r); i < Math.ceil(b * r) && i < pd.length; i++) if (pd[i] > pk) pk = pd[i];
          const bh = pk / 255 * hh; ctx.fillRect(x + px, y + hh - bh, 1, bh);
        }
      }
      return;
    }
    for (let tx = x; tx < x + w; tx += tw) {
      const t = t0 + ((tx - x) / w) * (t1 - t0);
      const th = IM.lib.thumbAt(m, t);
      if (!th) continue;
      const ta = tw / hh, sa = th.sw / th.sh;
      let sx = th.sx, sy = th.sy, sw = th.sw, sh = th.sh;
      if (sa > ta) { sw = th.sh * ta; sx += (th.sw - sw) / 2; } else { sh = th.sw / ta; sy += (th.sh - sh) / 2; }
      ctx.drawImage(th.img, sx, sy, sw, sh, tx, y, Math.min(tw, x + w - tx), hh);
    }
  }

  // ======================================================================
  const Trimmer = {
    el: null, itemId: null,
    isOpen() { return !!this.itemId; },
    toggle() {
      if (this.isOpen()) { this.close(); return; }
      const f = IM.selectedItems().find((x) => x.item.type === 'video' || x.item.type === 'audio');
      if (f) this.open(f.item.id);
    },
    open(id) {
      if (IM.precisionEditor.isOpen()) IM.precisionEditor.close();
      this.itemId = id;
      if (!this.el) this.build();
      IM.timelineUI.body.appendChild(this.el);
      this.el.classList.remove('hidden');
      this.resize();
      this.draw();
    },
    close() { this.itemId = null; if (this.el) this.el.classList.add('hidden'); },
    build() {
      this.canvas = h('canvas');
      this.label = h('span');
      this.el = h('div.trimmer', h('div.trimmer-head', h('b', 'Clip Trimmer'), this.label, h('button.btn.small.close', { on: { click: () => this.close() } }, 'Close')), this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      this.canvas.addEventListener('pointermove', (e) => this.onHover(e));
      new ResizeObserver(() => { this.resize(); this.draw(); }).observe(this.el);
      IM.bus.on('project-changed', () => { if (this.itemId) { if (!Pr.findItem(app.project, this.itemId)) this.close(); else this.draw(); } });
      IM.bus.on('project-live', () => this.draw());
      IM.bus.on('selection', () => {
        if (!this.itemId) return;
        const f = IM.selectedItems().find((x) => x.item.type === 'video' || x.item.type === 'audio');
        if (f && f.item.id !== this.itemId) { this.itemId = f.item.id; this.draw(); }
      });
      window.addEventListener('keydown', (e) => { if (this.itemId && e.key === 'Enter' && !IM.isTyping(e)) { this.close(); e.preventDefault(); } }, true);
    },
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = this.canvas.clientWidth, hh = this.canvas.clientHeight;
      this.W = w; this.H = hh; this.dpr = dpr;
      this.canvas.width = Math.max(1, w * dpr); this.canvas.height = Math.max(1, hh * dpr);
    },
    geo() {
      const f = Pr.findItem(app.project, this.itemId);
      if (!f) return null;
      const it = f.item;
      const m = IM.lib.get(it.mediaId);
      if (!m) return null;
      const pad = 16;
      const x0 = pad, x1 = this.W - pad;
      const D = m.duration;
      const tx = (t) => x0 + (t / D) * (x1 - x0);
      return { it, m, D, x0, x1, tx, xt: (x) => clamp((x - x0) / (x1 - x0) * D, 0, D), y: 18, hh: this.H - 34 };
    },
    draw() {
      if (!this.itemId || !this.W) return;
      const g = this.geo();
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, this.W, this.H);
      if (!g) return;
      const { it, m, D, tx, y, hh } = g;
      drawStrip(ctx, m, g.x0, y, g.x1 - g.x0, hh, 0, D);
      // dim unused parts
      const a = tx(it.srcIn), b = tx(it.srcOut);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(g.x0, y, a - g.x0, hh); ctx.fillRect(b, y, g.x1 - b, hh);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.strokeRect(a + 1, y + 1, b - a - 2, hh - 2);
      ctx.fillStyle = '#f8c63c'; ctx.fillRect(a - 2, y, 5, hh); ctx.fillRect(b - 3, y, 5, hh);
      // playhead within clip
      const L = Pr.layout(app.project);
      const e = L.byId.get(it.id);
      if (e && app.player.t >= e.start && app.player.t <= e.end) {
        const st = Pr.srcTime(it, app.player.t - e.start);
        ctx.fillStyle = '#fff'; ctx.fillRect(tx(st) - 0.5, y - 4, 1.5, hh + 8);
      }
      if (this.hoverX != null) { ctx.fillStyle = '#ff3b30'; ctx.fillRect(this.hoverX, y - 4, 1, hh + 8); }
      ctx.fillStyle = '#cfcfcf'; ctx.font = '11px -apple-system, Helvetica, Arial';
      ctx.fillText(IM.fmtDur(Pr.dur(it)) + ' of ' + IM.fmtDur(D), a + 6, y - 5);
      this.label.textContent = ' — ' + (it.name || m.name);
    },
    onHover(e) {
      const g = this.geo();
      if (!g || this.dragging) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const a = g.tx(g.it.srcIn), b = g.tx(g.it.srcOut);
      this.canvas.style.cursor = Math.abs(x - a) < 7 || Math.abs(x - b) < 7 ? 'ew-resize' : x > a && x < b ? 'grab' : 'default';
      this.hoverX = x;
      app.player.setSource(g.m, g.xt(x));
      this.draw();
    },
    onDown(e) {
      const g = this.geo();
      if (!g) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const it = g.it;
      const a = g.tx(it.srcIn), b = g.tx(it.srcOut);
      const mode = Math.abs(x - a) < 7 ? 'in' : Math.abs(x - b) < 7 ? 'out' : x > a && x < b ? 'slip' : null;
      if (!mode) return;
      const live = IM.beginLive(mode === 'slip' ? 'Slip' : 'Trim');
      const s0 = { srcIn: it.srcIn, srcOut: it.srcOut };
      this.dragging = true;
      const fps = Pr.fps(app.project);
      IM.drag(e, (dx) => {
        const dt = dx / (g.x1 - g.x0) * g.D;
        live.update((p) => {
          const f = Pr.findItem(p, it.id);
          const x2 = f.item;
          const minLen = (x2.speed || 1) / fps;
          if (mode === 'in') x2.srcIn = clamp(s0.srcIn + dt, 0, s0.srcOut - minLen);
          else if (mode === 'out') x2.srcOut = clamp(s0.srcOut + dt, s0.srcIn + minLen, g.D);
          else { const len = s0.srcOut - s0.srcIn; const ni = clamp(s0.srcIn + dt, 0, g.D - len); x2.srcIn = ni; x2.srcOut = ni + len; }
        });
        const f = Pr.findItem(app.project, it.id);
        app.player.setSource(g.m, mode === 'out' ? f.item.srcOut : f.item.srcIn);
        this.draw();
      }, (ev, moved) => { this.dragging = false; app.player.clearSource(); if (moved) live.commit(); this.draw(); }, { threshold: 1 });
    },
  };
  IM.clipTrimmer = Trimmer;

  // ======================================================================
  // Precision editor: roll the edit point between two primary clips and adjust the transition.
  const Precision = {
    el: null, index: -1,
    isOpen() { return this.index >= 0; },
    toggle() { if (this.isOpen()) this.close(); else { const f = IM.selectedItems().find((x) => x.where === 'primary'); this.open(f ? f.item.id : null, 'end'); } },
    open(id, edge) {
      const p = app.project;
      if (!p || p.clips.length < 2) return;
      let i = id ? p.clips.findIndex((c) => c.id === id) : -1;
      if (i < 0) {
        const e = Pr.primaryAt(p, app.player.t);
        i = e ? e.index : 0;
      }
      if (edge === 'start') i -= 1;
      this.index = clamp(i, 0, p.clips.length - 2);
      if (Trimmer.isOpen()) Trimmer.close();
      if (!this.el) this.build();
      IM.timelineUI.body.appendChild(this.el);
      this.el.classList.remove('hidden');
      this.resize(); this.draw();
    },
    close() { this.index = -1; if (this.el) this.el.classList.add('hidden'); },
    build() {
      this.canvas = h('canvas');
      this.label = h('span');
      this.el = h('div.trimmer', { style: { height: '190px' } },
        h('div.trimmer-head', h('b', 'Precision Editor'), this.label,
          h('button.btn.small', { style: { marginLeft: 'auto' }, on: { click: () => this.step(-1) } }, '◀'),
          h('button.btn.small', { on: { click: () => this.step(1) } }, '▶'),
          h('button.btn.small', { on: { click: () => this.close() } }, 'Close Precision Editor')),
        this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      new ResizeObserver(() => { this.resize(); this.draw(); }).observe(this.el);
      IM.bus.on('project-changed', () => { if (this.isOpen()) { if (this.index >= app.project.clips.length - 1) this.close(); else this.draw(); } });
      IM.bus.on('project-live', () => this.draw());
    },
    step(d) { this.index = clamp(this.index + d, 0, app.project.clips.length - 2); this.draw(); },
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = this.canvas.clientWidth; this.H = this.canvas.clientHeight; this.dpr = dpr;
      this.canvas.width = Math.max(1, this.W * dpr); this.canvas.height = Math.max(1, this.H * dpr);
    },
    geo() {
      const p = app.project;
      const A = p.clips[this.index], B = p.clips[this.index + 1];
      if (!A || !B) return null;
      const L = Pr.layout(p);
      const eA = L.byId.get(A.id), eB = L.byId.get(B.id);
      const pps = Math.max(20, Math.min(160, (this.W - 40) / 10));
      const cut = this.W / 2;
      return { p, A, B, eA, eB, pps, cut, rowH: (this.H - 40) / 2 };
    },
    draw() {
      if (!this.isOpen() || !this.W) return;
      const g = this.geo();
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, this.W, this.H);
      if (!g) return;
      const { A, B, pps, cut, rowH } = g;
      const mA = IM.lib.get(A.mediaId), mB = IM.lib.get(B.mediaId);
      const y1 = 12, y2 = 12 + rowH + 16;
      // outgoing clip (top): used part ends at the cut; unused tail dimmed
      const drawClip = (it, m, y, isA) => {
        if (!m || (it.type !== 'video' && it.type !== 'audio')) {
          ctx.fillStyle = '#333'; ctx.fillRect(isA ? 20 : cut, y, (this.W / 2) - 20, rowH);
          ctx.fillStyle = '#aaa'; ctx.fillText(it.type === 'title' ? 'Title' : it.type === 'bg' ? 'Background' : 'Photo', (isA ? 20 : cut) + 8, y + 16);
          return;
        }
        const sp = it.speed || 1;
        const t0 = 0, t1 = m.duration;
        const xs = isA ? cut - (it.srcOut - t0) / sp * pps : cut - (it.srcIn - t0) / sp * pps;
        const w = (t1 - t0) / sp * pps;
        drawStrip(ctx, m, xs, y, w, rowH, t0, t1);
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        const inX = xs + it.srcIn / sp * pps, outX = xs + it.srcOut / sp * pps;
        ctx.fillRect(xs, y, inX - xs, rowH); ctx.fillRect(outX, y, xs + w - outX, rowH);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(inX, y + 0.5, outX - inX, rowH - 1);
      };
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.W, this.H); ctx.clip();
      drawClip(A, mA, y1, true);
      drawClip(B, mB, y2, false);
      ctx.restore();
      // cut line & transition
      ctx.fillStyle = '#f8c63c'; ctx.fillRect(cut - 1, 6, 3, this.H - 12);
      if (A.transition) {
        const tw = g.eA.trOut * pps;
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(cut - tw / 2, y1 + rowH, tw, 16);
        ctx.fillStyle = '#ddd'; ctx.font = '11px -apple-system, Helvetica'; ctx.fillText('Transition ' + g.eA.trOut.toFixed(1) + 's', cut - tw / 2 + 4, y1 + rowH + 12);
        ctx.fillStyle = '#f8c63c'; ctx.fillRect(cut - tw / 2 - 2, y1 + rowH, 4, 16); ctx.fillRect(cut + tw / 2 - 2, y1 + rowH, 4, 16);
      }
      this.label.textContent = ' — edit ' + (this.index + 1) + ' of ' + (g.p.clips.length - 1);
    },
    onDown(e) {
      const g = this.geo();
      if (!g) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const { A, B, pps, cut, rowH } = g;
      const y1 = 12;
      const trBand = y > y1 + rowH && y < y1 + rowH + 16 && A.transition;
      const live = IM.beginLive(trBand ? 'Change Transition Duration' : 'Roll Edit');
      const s0 = { aOut: A.srcOut, bIn: B.srcIn, aDur: Pr.dur(A), bDur: Pr.dur(B), tr: A.transition ? A.transition.dur : 0 };
      const fps = Pr.fps(g.p);
      IM.drag(e, (dx) => {
        let dt = Pr.snap(g.p, dx / pps);
        live.update((p) => {
          const a = p.clips[this.index], b = p.clips[this.index + 1];
          if (trBand) { a.transition.dur = clamp(s0.tr + Math.abs(x + dx - cut) * 2 / pps - Math.abs(x - cut) * 2 / pps, 2 / fps, 10); return; }
          // roll: move the cut (A gets longer/shorter, B the opposite), total unchanged
          if (a.type === 'video' || a.type === 'audio') {
            const mA = IM.lib.get(a.mediaId);
            dt = Math.min(dt, (mA.duration - s0.aOut) / (a.speed || 1));
          }
          if (b.type === 'video' || b.type === 'audio') dt = Math.max(dt, -s0.bIn / (b.speed || 1));
          dt = clamp(dt, -(s0.aDur - 2 / fps), s0.bDur - 2 / fps);
          if (a.type === 'video' || a.type === 'audio') a.srcOut = s0.aOut + dt * (a.speed || 1); else a.srcOut = a.srcIn + s0.aDur + dt;
          if (b.type === 'video' || b.type === 'audio') b.srcIn = s0.bIn + dt * (b.speed || 1); else b.srcOut = b.srcIn + s0.bDur - dt;
        });
        const L = Pr.layout(app.project);
        app.player.seek(L.clips[this.index].visEnd);
        this.draw();
      }, (ev, moved) => { if (moved) live.commit(); }, { threshold: 1 });
      void y;
    },
  };
  IM.precisionEditor = Precision;
})(window.IM = window.IM || {});
