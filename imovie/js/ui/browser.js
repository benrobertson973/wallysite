/* Media browser: filmstrips that wrap across rows, skimming, range selection, marking, drag to timeline */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;
  const clamp = IM.clamp;

  // ------------------------------------------------------------------ drag & drop manager
  IM.DnD = {
    active: null,
    start(e, payload, ghostCanvas, count) {
      const ghost = h('div.drag-ghost', ghostCanvas, count > 1 ? h('div.count', String(count)) : null);
      document.body.appendChild(ghost);
      const place = (x, y) => { ghost.style.left = (x + 12) + 'px'; ghost.style.top = (y + 10) + 'px'; };
      place(e.clientX, e.clientY);
      const st = { payload, ghost, overTimeline: false, overEvent: null };
      this.active = st;
      document.body.style.cursor = 'copy';
      const move = (ev) => {
        place(ev.clientX, ev.clientY);
        const tgt = IM.trailerUI && IM.trailerUI.active() ? IM.trailerUI : IM.timelineUI;
        st.overTimeline = tgt && app.view === 'editor' ? tgt.dragOver(payload, ev.clientX, ev.clientY) : false;
        if (st.overEvent) st.overEvent.classList.remove('drop');
        st.overEvent = null;
        if (!st.overTimeline && payload.kind === 'media' && IM.sidebarUI) {
          const row = IM.sidebarUI.eventAt(ev.clientX, ev.clientY);
          if (row) { row.classList.add('drop'); st.overEvent = row; }
        }
        ghost.style.opacity = st.overTimeline || st.overEvent ? '0.95' : '0.6';
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('keydown', key, true);
        ghost.remove();
        document.body.style.cursor = '';
        this.active = null;
        const tgt = IM.trailerUI && IM.trailerUI.active() ? IM.trailerUI : IM.timelineUI;
        if (st.cancelled) { tgt && tgt.dragLeave(); return; }
        if (st.overEvent) {
          st.overEvent.classList.remove('drop');
          IM.lib.moveMedia(payload.items.map((s) => s.mediaId), st.overEvent.dataset.eventId);
          return;
        }
        if (tgt && app.view === 'editor') {
          const ok = tgt.drop(payload, ev.clientX, ev.clientY);
          if (!ok) tgt.dragLeave();
        }
      };
      const key = (ev) => { if (ev.key === 'Escape') { st.cancelled = true; ev.preventDefault(); ev.stopPropagation(); up(ev); } };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('keydown', key, true);
    },
  };
  function ghostFor(thumbInfo, w, hh, label) {
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, hh);
    if (thumbInfo && thumbInfo.img) {
      const t = thumbInfo;
      const ta = w / hh, sa = t.sw / t.sh;
      let sx = t.sx, sy = t.sy, sw = t.sw, sh = t.sh;
      if (sa > ta) { sw = t.sh * ta; sx += (t.sw - sw) / 2; } else { sh = t.sw / ta; sy += (t.sh - sh) / 2; }
      ctx.drawImage(t.img, sx, sy, sw, sh, 0, 0, w, hh);
    }
    if (label) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, hh - 18, w, 18);
      ctx.fillStyle = '#fff'; ctx.font = '600 11px -apple-system, Helvetica, Arial'; ctx.fillText(label, 6, hh - 5);
    }
    return c;
  }
  IM.ghostFor = ghostFor;

  const ZOOMS = [0, 60, 30, 15, 10, 5, 2, 1, 0.5]; // seconds per thumbnail; 0 = "All"

  const Browser = {
    init(host) {
      this.el = h('div.browser-pane');
      host.appendChild(this.el);
      const sideBtn = h('button.tb-btn', { 'data-tip': 'Show or hide the Libraries list', on: { click: () => IM.run('toggleLibraries') } }, IM.icon('sidebar', 16));
      this.titleEl = h('div.br-title');
      this.filterBtn = IM.popupButton([
        { value: 'all', label: 'All Clips' }, { value: 'favorites', label: 'Favorites' },
        { value: 'hide-rejected', label: 'Hide Rejected' }, { value: 'rejected', label: 'Rejected' },
      ], IM.prefs.browserFilter || 'all', (v) => { IM.prefs.browserFilter = v; IM.savePrefs(); IM.setBrowserSelection([]); this.redraw(); }, { plain: true });
      this.search = h('input.text-field', { type: 'search', placeholder: 'Search' });
      this.search.addEventListener('input', () => this.redraw());
      this.search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { this.search.value = ''; this.search.blur(); this.redraw(); } });
      const searchWrap = h('div.search-field', IM.icon('search', 12), this.search);
      const gear = h('button.tb-btn', { 'data-tip': 'Settings', on: { click: (e) => this.settings(e.currentTarget) } }, IM.icon('gear', 16));
      this.header = h('div.br-header', sideBtn, this.titleEl, this.filterBtn, searchWrap, gear);
      this.scroller = h('div.br-scroll');
      this.canvas = h('canvas.br-canvas');
      this.sizer = h('div.br-sizer');
      this.scroller.append(this.canvas, this.sizer);
      this.emptyEl = h('div.br-empty.hidden');
      this.addBtn = h('button.br-add-btn', { 'data-tip': 'Add to Project', on: { click: () => { IM.run('append'); } } }, IM.icon('plus-circle', 22));
      this.body = h('div.br-body', this.scroller, this.emptyEl, this.addBtn);
      this.el.append(this.header, this.body);
      this.ctx = this.canvas.getContext('2d');
      this.hover = null;
      new ResizeObserver(() => this.resize()).observe(this.body);
      this.scroller.addEventListener('scroll', () => this.redraw());
      this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
      this.canvas.addEventListener('pointerleave', () => this.onLeave());
      this.canvas.addEventListener('dblclick', (e) => this.onDbl(e));
      this.canvas.addEventListener('contextmenu', (e) => this.onContext(e));
      this.canvas.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
      ['changed', 'media-added', 'thumbs', 'peaks'].forEach((ev) => IM.lib.on(ev, () => this.redraw()));
      ['libsel', 'bselection', 'project-changed', 'marks', 'view', 'tab'].forEach((ev) => IM.bus.on(ev, () => this.redraw()));
      app.player.on('source-time', () => this.redraw());
      app.player.on('source-stopped', () => this.redraw());
      this.body.addEventListener('dragover', (e) => { e.preventDefault(); });
    },
    resize() {
      // measure with the canvas out of the way: at its old size it can overflow the new space and bring up a scrollbar
      this.canvas.style.width = this.canvas.style.height = '0px';
      const w = this.scroller.clientWidth, hh = this.scroller.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = w; this.H = hh; this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr)); this.canvas.height = Math.max(1, Math.round(hh * dpr));
      this.canvas.style.width = w + 'px'; this.canvas.style.height = hh + 'px';
      this.redraw(true);
    },
    redraw(sync) {
      if (sync) { this.draw(); return; }
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    },
    // ------------------------------------------------------------------ data
    sourceMedia() {
      const sel = app.libSel;
      let list = [];
      if (sel === 'project' && app.project) {
        const p = app.project;
        const ids = new Set();
        IM.Project.forEachItem(p, (it) => { if (it.mediaId) ids.add(it.mediaId); });
        for (const m of IM.lib.media.values()) {
          if (m.hidden || m.builtin) continue;
          if (m.eventId === p.eventId || ids.has(m.id)) list.push(m);
        }
        list.sort((a, b) => a.created - b.created);
        this.title = p.name;
      } else if (sel === 'photos') {
        list = IM.lib.allUserMedia().filter((m) => m.kind === 'image').sort((a, b) => a.date - b.date);
        this.title = 'Photos Library';
      } else {
        const ev = IM.lib.eventById(sel);
        list = ev ? IM.lib.mediaInEvent(ev.id) : [];
        this.title = ev ? ev.name : '';
      }
      return list;
    },
    displayItems() {
      const q = (this.search.value || '').trim().toLowerCase();
      const filter = IM.prefs.browserFilter || 'all';
      const out = [];
      for (const m of this.sourceMedia()) {
        if (q && !m.name.toLowerCase().includes(q)) continue;
        if (m.status === 'loading') continue;
        const D = m.kind === 'image' ? 0 : m.duration;
        let ranges = [[0, D]];
        if (m.kind !== 'image') {
          if (filter === 'favorites') ranges = m.favorites.slice();
          else if (filter === 'rejected') ranges = m.rejected.slice();
          else if (filter === 'hide-rejected') { ranges = [[0, D]]; for (const [a, b] of m.rejected) ranges = IM.rangeSub(ranges, a, b); }
        } else {
          const fav = m.favorites.length > 0, rej = m.rejected.length > 0;
          if (filter === 'favorites' && !fav) ranges = [];
          if (filter === 'rejected' && !rej) ranges = [];
          if (filter === 'hide-rejected' && rej) ranges = [];
        }
        for (const [a, b] of ranges) out.push({ m, a, b: m.kind === 'image' ? 0 : b });
      }
      return out;
    },
    sizes() {
      const cs = IM.prefs.browserClipSize == null ? 1 : IM.prefs.browserClipSize;
      const th = Math.round(38 + cs * 34);
      return { th, tw: Math.round(th * 16 / 9), zoom: ZOOMS[IM.prefs.browserZoom || 0] };
    },
    layout() {
      const S = this.sizes();
      const items = this.displayItems();
      const W = this.W - 24;
      const rowGap = 10, colGap = 10;
      const wave = IM.prefs.browserWaveforms;
      const rowH = S.th + (wave ? Math.round(S.th * 0.34) : 0);
      const segs = [];
      const headers = [];
      let x = 12, y = 12;
      let lastDay = null;
      const byDay = app.libSel !== 'project';
      for (const d of items) {
        const m = d.m;
        const day = new Date(m.date || m.created).toDateString();
        if (byDay && day !== lastDay) {
          if (lastDay !== null) { y += rowH + rowGap + 6; x = 12; }
          headers.push({ y, text: IM.fmtDate(m.date || m.created, 'long') });
          y += 24;
          lastDay = day;
        }
        const dur = m.kind === 'image' ? 0 : d.b - d.a;
        let n = 1;
        if (m.kind !== 'image' && S.zoom > 0) n = Math.max(1, Math.ceil(dur / S.zoom));
        let total = n * S.tw;
        if (m.kind === 'audio') total = Math.max(S.tw, S.zoom > 0 ? n * S.tw : S.tw * 1.5);
        let remaining = total;
        let t0 = d.a;
        const pieces = [];
        while (remaining > 0.5) {
          let avail = W - x + 12;
          if (avail < Math.min(S.tw, remaining)) { x = 12; y += rowH + rowGap; avail = W; }
          const w = Math.min(remaining, Math.max(S.tw, Math.floor(avail / S.tw) * S.tw));
          const frac = w / total;
          const t1 = m.kind === 'image' ? 0 : t0 + dur * frac;
          pieces.push({ d, m, x, y, w, h: S.th, rowH, t0, t1 });
          t0 = t1;
          remaining -= w;
          x += w;
          if (remaining > 0.5) { x = 12; y += rowH + rowGap; }
        }
        pieces.forEach((pc, i) => { pc.first = i === 0; pc.last = i === pieces.length - 1; pc.pieces = pieces; });
        segs.push(...pieces);
        x += colGap;
      }
      const height = y + rowH + 30;
      return { S, segs, headers, height, rowH, items };
    },

    // ------------------------------------------------------------------ drawing
    draw() {
      const ctx = this.ctx;
      const vis = app.view === 'media' || (app.view === 'editor' && app.tab === 'media');
      this.el.classList.toggle('hidden', !vis);
      if (!vis || !this.W) return; // shown again: its ResizeObserver sizes the canvas and draws
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, this.W, this.H);
      const LY = this.L = this.layout();
      this.titleEl.textContent = this.title || '';
      this.sizer.style.height = LY.height + 'px';
      // a new scroll height can bring up or remove the scrollbar: fit the canvas to the space left
      if (!this._refit && (this.scroller.clientWidth !== this.W || this.scroller.clientHeight !== this.H)) {
        this._refit = true;
        try { this.resize(); } finally { this._refit = false; }
        return;
      }
      const st = this.scroller.scrollTop;
      // empty state
      const empty = !LY.segs.length;
      this.emptyEl.classList.toggle('hidden', !empty);
      if (empty) this.renderEmpty();
      ctx.save();
      ctx.translate(0, -st);
      const font = getComputedStyle(document.body).fontFamily;
      for (const hd of LY.headers) {
        if (hd.y > st + this.H || hd.y + 24 < st) continue;
        ctx.fillStyle = '#a8a8a8';
        ctx.font = '600 12px ' + font;
        ctx.textBaseline = 'top';
        ctx.fillText(hd.text, 14, hd.y + 4);
      }
      const used = new Map();
      const p = app.project;
      const bsel = app.bsel;
      for (const s of LY.segs) {
        if (s.y > st + this.H || s.y + s.rowH < st) continue;
        this.drawSeg(ctx, s, font);
        // used-in-project / favorite / reject bars
        if (p && s.m.kind !== 'audio') {
          let ur = used.get(s.m.id);
          if (!ur) { ur = Pr.usedRanges(p, s.m.id); used.set(s.m.id, ur); }
          this.drawRangeBars(ctx, s, ur, '#ff9f0a', s.y + s.h - 3);
        }
        this.drawRangeBars(ctx, s, s.m.favorites, '#34c759', s.y);
        this.drawRangeBars(ctx, s, s.m.rejected, '#ff453a', s.y);
      }
      // selection frames
      for (const sel of bsel) this.drawSelection(ctx, LY, sel, font);
      // skimmer
      const hv = this.hover;
      if (hv && hv.seg && app.player.skimming && !app.player.sourcePlay) {
        ctx.fillStyle = '#ff3b30';
        ctx.fillRect(Math.round(hv.x), hv.seg.y, 1, hv.seg.h);
        if (!bsel.some((b) => b.mediaId === hv.seg.m.id)) this.badge(ctx, hv.seg.pieces[0].x + 4, hv.seg.pieces[0].y + 4, hv.seg.m.kind === 'image' ? 'Photo' : IM.fmtDur(hv.seg.d.b - hv.seg.d.a), font);
        // trailer: show how much of the clip the selected shot will use
        if (IM.trailerUI && IM.trailerUI.wantsClick() && hv.seg.m.kind === 'video') {
          const sg = hv.seg, pps = sg.w / Math.max(1e-6, sg.t1 - sg.t0);
          const w = Math.max(3, Math.min(IM.trailerUI.selDur() * pps, sg.x + sg.w - hv.x));
          ctx.fillStyle = 'rgba(248,198,60,0.16)'; ctx.fillRect(hv.x, sg.y, w, sg.h);
          ctx.strokeStyle = '#f8c63c'; ctx.lineWidth = 2; ctx.strokeRect(hv.x + 1, sg.y + 1, w - 2, sg.h - 2);
        }
      }
      // playing source playhead
      const sp = app.player.sourcePlay;
      if (sp) {
        const seg = LY.segs.find((s) => s.m === sp.media && app.player.source && app.player.source.t >= s.t0 - 1e-3 && app.player.source.t <= s.t1 + 1e-3);
        if (seg) {
          const x = seg.x + (app.player.source.t - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0) * seg.w;
          ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x), seg.y, 1.5, seg.h);
        }
      }
      ctx.restore();
      this.placeAddButton(LY, st);
    },
    drawSeg(ctx, s, font) {
      const m = s.m;
      const S = this.L.S;
      ctx.save();
      const r = 4;
      ctx.beginPath();
      const lr = s.first ? r : 0, rr = s.last ? r : 0;
      ctx.moveTo(s.x + lr, s.y);
      ctx.lineTo(s.x + s.w - rr, s.y); if (rr) ctx.quadraticCurveTo(s.x + s.w, s.y, s.x + s.w, s.y + rr);
      ctx.lineTo(s.x + s.w, s.y + s.rowH - rr); if (rr) ctx.quadraticCurveTo(s.x + s.w, s.y + s.rowH, s.x + s.w - rr, s.y + s.rowH);
      ctx.lineTo(s.x + lr, s.y + s.rowH); if (lr) ctx.quadraticCurveTo(s.x, s.y + s.rowH, s.x, s.y + s.rowH - lr);
      ctx.lineTo(s.x, s.y + lr); if (lr) ctx.quadraticCurveTo(s.x, s.y, s.x + lr, s.y);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = '#111';
      ctx.fillRect(s.x, s.y, s.w, s.rowH);
      if (m.kind === 'audio') {
        ctx.fillStyle = '#1b4722';
        ctx.fillRect(s.x, s.y, s.w, s.rowH);
        this.drawWave(ctx, s, s.y, s.rowH, '#4cb857');
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '600 11px ' + font; ctx.textBaseline = 'top';
        if (s.first) ctx.fillText(m.name, s.x + 6, s.y + 5);
      } else {
        const n = Math.max(1, Math.round(s.w / S.tw));
        for (let i = 0; i < n; i++) {
          const tx = s.x + i * S.tw;
          const t = m.kind === 'image' ? 0 : s.t0 + (i / n) * (s.t1 - s.t0) + (n === 1 && s.first && s.last ? (s.t1 - s.t0) * 0.08 : 0);
          const th = IM.lib.thumbAt(m, t);
          if (!th) continue;
          const ta = S.tw / S.th, sa = th.sw / th.sh;
          let sx = th.sx, sy = th.sy, sw = th.sw, sh = th.sh;
          if (sa > ta) { sw = th.sh * ta; sx += (th.sw - sw) / 2; } else { sh = th.sw / ta; sy += (th.sh - sh) / 2; }
          ctx.drawImage(th.img, sx, sy, sw, sh, tx, s.y, Math.min(S.tw, s.x + s.w - tx), S.th);
        }
        if (m.error) {
          ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(s.x, s.y, s.w, S.th);
          ctx.fillStyle = '#ffcc00'; ctx.font = '600 11px ' + font; ctx.fillText('⚠ Missing', s.x + 6, s.y + 16);
        }
        if (IM.prefs.browserWaveforms && m.kind === 'video') {
          ctx.fillStyle = '#1c3b60';
          ctx.fillRect(s.x, s.y + S.th, s.w, s.rowH - S.th);
          this.drawWave(ctx, s, s.y + S.th, s.rowH - S.th, '#4d8ee0');
        }
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.rowH - 1);
    },
    drawWave(ctx, s, y, hh, color) {
      const m = s.m;
      if (!m.peaks) return;
      const pd = m.peaks.data, rate = m.peaks.rate;
      ctx.fillStyle = color;
      for (let px = 0; px < s.w; px++) {
        const t0 = s.t0 + (px / s.w) * (s.t1 - s.t0), t1 = s.t0 + ((px + 1) / s.w) * (s.t1 - s.t0);
        let pk = 0;
        for (let i = Math.floor(t0 * rate); i < Math.ceil(t1 * rate) && i < pd.length; i++) if (pd[i] > pk) pk = pd[i];
        const bh = (pk / 255) * (hh - 3);
        if (bh > 0.4) ctx.fillRect(s.x + px, y + hh - bh, 1, bh);
      }
    },
    drawRangeBars(ctx, s, ranges, color, y) {
      if (!ranges || !ranges.length) return;
      ctx.fillStyle = color;
      if (s.m.kind === 'image') { ctx.fillRect(s.x, y, s.w, 3); return; }
      for (const [a, b] of ranges) {
        const lo = Math.max(a, s.t0), hi = Math.min(b, s.t1);
        if (hi <= lo) continue;
        const x0 = s.x + (lo - s.t0) / (s.t1 - s.t0) * s.w, x1 = s.x + (hi - s.t0) / (s.t1 - s.t0) * s.w;
        ctx.fillRect(x0, y, Math.max(2, x1 - x0), 3);
      }
    },
    drawSelection(ctx, LY, sel, font) {
      const segs = LY.segs.filter((s) => s.m.id === sel.mediaId && (s.m.kind === 'image' || (s.t1 > sel.a + 1e-4 && s.t0 < sel.b - 1e-4) || (s.d.a <= sel.a && s.d.b >= sel.b && s.t0 <= sel.a && s.t1 >= sel.a)));
      if (!segs.length) return;
      ctx.strokeStyle = '#f8c63c';
      ctx.fillStyle = '#f8c63c';
      ctx.lineWidth = 3;
      let firstX = null, firstY = null;
      segs.forEach((s) => {
        let x0 = s.x, x1 = s.x + s.w;
        if (s.m.kind !== 'image') {
          const span = Math.max(1e-6, s.t1 - s.t0);
          x0 = s.x + clamp((sel.a - s.t0) / span, 0, 1) * s.w;
          x1 = s.x + clamp((sel.b - s.t0) / span, 0, 1) * s.w;
        }
        const startsHere = s.m.kind === 'image' || sel.a >= s.t0 - 1e-4;
        const endsHere = s.m.kind === 'image' || sel.b <= s.t1 + 1e-4;
        ctx.beginPath();
        ctx.moveTo(x0 + 1.5, s.y + 1.5); ctx.lineTo(x1 - 1.5, s.y + 1.5);
        ctx.moveTo(x0 + 1.5, s.y + s.rowH - 1.5); ctx.lineTo(x1 - 1.5, s.y + s.rowH - 1.5);
        ctx.stroke();
        if (startsHere) { ctx.fillRect(x0, s.y, 5, s.rowH); if (firstX === null) { firstX = x0; firstY = s.y; } }
        if (endsHere) ctx.fillRect(x1 - 5, s.y, 5, s.rowH);
        s._selX1 = x1;
      });
      if (firstX !== null && sel.b != null && segs[0].m.kind !== 'image') this.badge(ctx, firstX + 8, firstY + 5, IM.fmtDur(sel.b - sel.a), font);
    },
    badge(ctx, x, y, text, font) {
      ctx.font = '600 11px ' + font;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, tw + 10, 16, 4); else ctx.rect(x, y, tw + 10, 16);
      ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 5, y + 8.5);
    },
    placeAddButton(LY, st) {
      const b = this.addBtn;
      const sel = app.bsel[app.bsel.length - 1];
      if (!sel || app.view !== 'editor' || !this.hover || this.hover.seg.m.id !== sel.mediaId) { b.style.display = 'none'; return; }
      const segs = LY.segs.filter((s) => s.m.id === sel.mediaId);
      const last = segs.filter((s) => s.m.kind === 'image' || s.t0 < sel.b - 1e-4).pop();
      if (!last) { b.style.display = 'none'; return; }
      const x1 = last.m.kind === 'image' ? last.x + last.w : last.x + clamp((sel.b - last.t0) / Math.max(1e-6, last.t1 - last.t0), 0, 1) * last.w;
      b.style.display = 'flex';
      b.style.left = (x1 - 28) + 'px';
      b.style.top = (last.y - st + last.h - 26) + 'px';
    },
    renderEmpty() {
      const el = IM.clear(this.emptyEl);
      if (app.libSel === 'photos') {
        el.append(h('div.t1', 'No Photos'), h('div.t2', 'Photos you import appear here.'));
        return;
      }
      const btn = h('button.import-big', { 'data-tip': 'Import Media', on: { click: () => IM.run('import') } }, IM.icon('import', 40));
      el.append(btn, h('div.t1', 'Import Media'), h('div.t2', 'Or drag video, photo and audio files here.'));
    },

    // ------------------------------------------------------------------ hit testing
    pt(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top + this.scroller.scrollTop };
    },
    segAt(pt) {
      if (!this.L) return null;
      for (const s of this.L.segs) if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.rowH) return s;
      return null;
    },
    timeAt(s, x) {
      if (s.m.kind === 'image') return 0;
      return clamp(s.t0 + (x - s.x) / s.w * (s.t1 - s.t0), s.d.a, s.d.b);
    },
    onMove(e) {
      if (this.dragging) return;
      const pt = this.pt(e);
      const s = this.segAt(pt);
      this.hover = s ? { seg: s, x: pt.x, t: this.timeAt(s, pt.x) } : null;
      this.canvas.style.cursor = s && this.onHandle(s, pt) ? 'ew-resize' : 'default';
      if (s && app.player.skimming && !app.player.sourcePlay) {
        if (s.m.kind !== 'audio') app.player.setSource(s.m, this.hover.t);
      } else if (!app.player.sourcePlay) app.player.clearSource();
      this.redraw();
    },
    onLeave() {
      if (this.dragging) return;
      this.hover = null;
      if (!app.player.sourcePlay) app.player.clearSource();
      this.redraw();
    },
    onHandle(s, pt) {
      const sel = app.bsel.find((b) => b.mediaId === s.m.id);
      if (!sel || s.m.kind === 'image') return null;
      const span = Math.max(1e-6, s.t1 - s.t0);
      const xa = s.x + (sel.a - s.t0) / span * s.w, xb = s.x + (sel.b - s.t0) / span * s.w;
      if (sel.a >= s.t0 - 1e-4 && sel.a <= s.t1 + 1e-4 && Math.abs(pt.x - xa) < 6) return 'a';
      if (sel.b >= s.t0 - 1e-4 && sel.b <= s.t1 + 1e-4 && Math.abs(pt.x - xb) < 6) return 'b';
      return null;
    },
    onDown(e) {
      if (e.button === 2) return;
      app.focus = 'browser';
      IM.closePopovers();
      const pt = this.pt(e);
      const s = this.segAt(pt);
      if (app.player.sourcePlay) app.player.stopSource();
      if (!s) { IM.setBrowserSelection([]); return; }
      const m = s.m;
      const t = this.timeAt(s, pt.x);
      const existing = app.bsel.find((b) => b.mediaId === m.id && (m.kind === 'image' || (t >= b.a - 1e-3 && t <= b.b + 1e-3)));
      const handle = this.onHandle(s, pt);
      if (handle) { this.dragHandle(e, s, handle); return; }
      if (IM.trailerUI && IM.trailerUI.wantsClick() && m.kind !== 'audio') {
        // trailer: a click fills the selected shot from this point; a drag can drop onto any shot
        const dur = IM.trailerUI.selDur();
        IM.drag(e, () => {
          if (this.dragging) return;
          this.dragging = true;
          this.startDnD(e, [{ mediaId: m.id, a: t, b: m.kind === 'image' ? 0 : Math.min(m.duration, t + dur) }]);
        }, (ev, moved) => { this.dragging = false; if (!moved) IM.trailerUI.fillSelected(m, t); }, { threshold: 4 });
        return;
      }
      if (existing && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // drag the selection to the timeline, or click to reselect whole clip
        IM.drag(e, () => {
          if (this.dragging) return;
          this.dragging = true;
          this.startDnD(e, app.bsel.slice());
        }, (ev, moved) => {
          this.dragging = false;
          if (!moved) {
            IM.setBrowserSelection([{ mediaId: m.id, a: s.d.a, b: m.kind === 'image' ? 0 : s.d.b }]);
            app.player.setSource(m, t);
          }
        }, { threshold: 4 });
        return;
      }
      // new selection: click = whole clip; drag = range
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      const whole = { mediaId: m.id, a: s.d.a, b: m.kind === 'image' ? 0 : s.d.b };
      const base = add ? app.bsel.filter((b) => b.mediaId !== m.id) : [];
      IM.setBrowserSelection(base.concat([whole]));
      if (m.kind === 'image' || m.kind === 'audio' && false) {
        IM.drag(e, () => { if (this.dragging) return; this.dragging = true; this.startDnD(e, app.bsel.slice()); }, () => { this.dragging = false; }, { threshold: 4 });
        return;
      }
      let rangeMode = false;
      IM.drag(e, (dx, dy, ev) => {
        const q = this.pt(ev);
        const s2 = this.segAt(q) || s;
        if (!rangeMode && Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 12) {
          // vertical drag: drag whole clip out
          this.dragging = true;
          this.startDnD(e, app.bsel.slice());
          rangeMode = null;
          return;
        }
        if (rangeMode === null) return;
        rangeMode = true;
        let t2 = s2.m === m ? this.timeAt(s2, q.x) : (q.y > s.y ? s.d.b : s.d.a);
        t2 = clamp(t2, s.d.a, s.d.b);
        const a = Math.min(t, t2), b = Math.max(t, t2);
        IM.setBrowserSelection(base.concat([{ mediaId: m.id, a, b: Math.max(b, a + 0.1) }]));
        app.player.setSource(m, t2);
      }, () => { this.dragging = false; }, { threshold: 3 });
    },
    dragHandle(e, s, which) {
      const idx = app.bsel.findIndex((b) => b.mediaId === s.m.id);
      if (idx < 0) return;
      const sel = Object.assign({}, app.bsel[idx]);
      this.dragging = true;
      IM.drag(e, (dx, dy, ev) => {
        const q = this.pt(ev);
        const s2 = this.segAt(q);
        let t = s2 && s2.m === s.m ? this.timeAt(s2, q.x) : this.timeAt(s, clamp(q.x, s.x, s.x + s.w));
        if (which === 'a') sel.a = clamp(t, s.d.a, sel.b - 0.1);
        else sel.b = clamp(t, sel.a + 0.1, s.d.b);
        const list = app.bsel.slice(); list[idx] = Object.assign({}, sel);
        IM.setBrowserSelection(list);
        app.player.setSource(s.m, which === 'a' ? sel.a : sel.b);
      }, () => { this.dragging = false; }, { threshold: 1 });
    },
    startDnD(e, list) {
      if (!list.length) return;
      const first = IM.lib.get(list[0].mediaId);
      if (!first) return;
      const dur = list.reduce((s, x) => { const m = IM.lib.get(x.mediaId); return s + (m.kind === 'image' ? (IM.prefs.photoDuration || 4) : (x.b - x.a)); }, 0);
      const th = IM.lib.thumbAt(first, list[0].a || 0);
      const ghost = ghostFor(th, 112, 63, first.kind === 'audio' ? first.name : null);
      const audioOnly = list.every((x) => { const m = IM.lib.get(x.mediaId); return m && m.kind === 'audio'; });
      IM.DnD.start(e, { kind: 'media', items: list.map((x) => Object.assign({}, x)), dur, audioOnly }, ghost, list.length);
    },
    onDbl(e) {
      const pt = this.pt(e);
      const s = this.segAt(pt);
      if (!s || s.m.kind === 'image') return;
      const sel = app.bsel.find((b) => b.mediaId === s.m.id);
      app.player.playSource(s.m, this.timeAt(s, pt.x), sel ? sel.b : s.d.b);
    },
    onContext(e) {
      const pt = this.pt(e);
      const s = this.segAt(pt);
      if (!s) { IM.contextMenu(e, [{ label: 'Import Media…', key: 'cmd+i', action: () => IM.run('import') }, { label: 'New Event', action: () => IM.run('newEvent') }]); return; }
      if (!app.bsel.some((b) => b.mediaId === s.m.id)) IM.setBrowserSelection([{ mediaId: s.m.id, a: s.d.a, b: s.m.kind === 'image' ? 0 : s.d.b }]);
      const inEd = app.view === 'editor';
      IM.contextMenu(e, [
        { label: 'Favorite', key: 'f', action: () => IM.run('favorite') },
        { label: 'Reject', key: 'delete', action: () => IM.run('reject') },
        { label: 'Unmark', key: 'u', action: () => IM.run('unmark') },
        { separator: true },
        { label: 'Add to Movie', key: 'e', disabled: !inEd, action: () => IM.run('append') },
        { label: 'Insert', key: 'w', disabled: !inEd, action: () => IM.run('insert') },
        { label: 'Connect', key: 'q', disabled: !inEd, action: () => IM.run('connect') },
        { separator: true },
        { label: 'Rename Clip…', action: () => this.renameClip(s.m) },
        { label: 'Move to Trash', key: 'cmd+delete', action: () => IM.run('moveToTrash') },
      ]);
    },
    async renameClip(m) {
      const name = await IM.prompt({ title: 'Rename Clip', value: m.name, ok: 'Rename' });
      if (name && name.trim()) { m.name = name.trim(); IM.lib.saveMediaMeta(m); this.redraw(); }
    },

    // ------------------------------------------------------------------ commands
    playFocused() {
      const pl = app.player;
      if (this.hover && this.hover.seg.m.kind !== 'image') { const sel = app.bsel.find((b) => b.mediaId === this.hover.seg.m.id); pl.playSource(this.hover.seg.m, this.hover.t, sel ? sel.b : null); return true; }
      if (app.bsel.length) { const s = app.bsel[0]; const m = IM.lib.get(s.mediaId); if (m && m.kind !== 'image') { pl.playSource(m, s.a, s.b); return true; } }
      return false;
    },
    selectAll() {
      const L = this.L || this.layout();
      const list = []; const seen = new Set();
      for (const s of L.segs) { const k = s.m.id + ':' + s.d.a; if (seen.has(k)) continue; seen.add(k); list.push({ mediaId: s.m.id, a: s.d.a, b: s.m.kind === 'image' ? 0 : s.d.b }); }
      IM.setBrowserSelection(list);
    },
    selectEntireClip() {
      const s = this.hover ? this.hover.seg : null;
      if (s) IM.setBrowserSelection([{ mediaId: s.m.id, a: s.d.a, b: s.m.kind === 'image' ? 0 : s.d.b }]);
      else if (app.bsel.length) { const m = IM.lib.get(app.bsel[0].mediaId); IM.setBrowserSelection([{ mediaId: m.id, a: 0, b: m.kind === 'image' ? 0 : m.duration }]); }
    },
    zoom(dir) {
      IM.prefs.browserZoom = clamp((IM.prefs.browserZoom || 0) + dir, 0, ZOOMS.length - 1);
      IM.savePrefs();
      this.redraw();
    },
    reveal(mediaId, a, b) {
      app.tab = 'media'; IM.bus.emit('tab', 'media');
      const m = IM.lib.get(mediaId);
      if (!m) return;
      if (app.view === 'editor') app.libSel = 'project';
      IM.bus.emit('libsel');
      IM.setBrowserSelection([{ mediaId, a: a || 0, b: m.kind === 'image' ? 0 : (b || m.duration) }], { keepTimeline: true });
      setTimeout(() => {
        const L = this.layout();
        const s = L.segs.find((x) => x.m.id === mediaId);
        if (s) this.scroller.scrollTop = Math.max(0, s.y - 20);
      }, 30);
    },
    settings(anchor) {
      const size = IM.slider({ min: 0, max: 2, step: 0.01, value: IM.prefs.browserClipSize == null ? 1 : IM.prefs.browserClipSize, onInput: (v) => { IM.prefs.browserClipSize = v; IM.savePrefs(); this.redraw(); } });
      const zoomLabel = h('span', { style: { width: '34px', textAlign: 'right', color: '#aaa' } });
      const setZL = () => { const z = ZOOMS[IM.prefs.browserZoom || 0]; zoomLabel.textContent = z === 0 ? 'All' : z + 's'; };
      setZL();
      const zoom = IM.slider({ min: 0, max: ZOOMS.length - 1, step: 1, value: IM.prefs.browserZoom || 0, onInput: (v) => { IM.prefs.browserZoom = v; IM.savePrefs(); setZL(); this.redraw(); } });
      const waves = IM.checkbox('Show Waveforms', !!IM.prefs.browserWaveforms, (v) => { IM.prefs.browserWaveforms = v; IM.savePrefs(); this.redraw(); });
      IM.popover(anchor, h('div', { style: { width: '270px' } },
        h('div.pop-row', h('label', { style: { minWidth: '62px' } }, 'Clip Size'), size),
        h('div.pop-row', h('label', { style: { minWidth: '62px' } }, 'Zoom'), zoom, zoomLabel),
        h('div.pop-row', { style: { paddingLeft: '70px' } }, waves)), { side: 'bottom', align: 'right' });
    },
  };
  IM.browserUI = Browser;
})(window.IM = window.IM || {});
