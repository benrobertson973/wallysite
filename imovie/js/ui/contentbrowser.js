/* Content Library browsers: Titles, Backgrounds, Transitions, Audio & Video */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;
  const clamp = IM.clamp;

  // ---------- sample pictures used for thumbnails ----------
  let samples = null;
  function makeSamples() {
    if (samples) return samples;
    const mk = (fn) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; fn(c.getContext('2d'), 320, 180); return c; };
    const A = mk((ctx, W, H) => {
      let g = ctx.createLinearGradient(0, 0, 0, H * 0.6);
      g.addColorStop(0, '#3f86d8'); g.addColorStop(1, '#a9d6f5');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      [[60, 40, 26], [84, 36, 20], [104, 44, 18], [230, 30, 16], [250, 26, 22], [272, 32, 15]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); });
      g = ctx.createLinearGradient(0, H * 0.55, 0, H * 0.75);
      g.addColorStop(0, '#1d6fa8'); g.addColorStop(1, '#2fa3c6');
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.2);
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 12; i++) ctx.fillRect((i * 37) % W, H * 0.6 + (i % 3) * 8, 22, 1.5);
      g = ctx.createLinearGradient(0, H * 0.72, 0, H);
      g.addColorStop(0, '#f1d9a6'); g.addColorStop(1, '#d9b77a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, H * 0.78); ctx.quadraticCurveTo(W * 0.5, H * 0.68, W, H * 0.76); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
      ctx.fillStyle = '#3c6e2e';
      ctx.beginPath(); ctx.moveTo(W * 0.8, H); ctx.lineTo(W * 0.83, H * 0.45); ctx.lineTo(W * 0.845, H); ctx.fill();
      ctx.fillStyle = '#2f8a3e';
      for (let k = 0; k < 6; k++) { ctx.save(); ctx.translate(W * 0.835, H * 0.46); ctx.rotate(-1.4 + k * 0.55); ctx.beginPath(); ctx.ellipse(18, 0, 22, 5, 0, 0, 7); ctx.fill(); ctx.restore(); }
    });
    const B = mk((ctx, W, H) => {
      let g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2b1e4d'); g.addColorStop(0.45, '#d9674a'); g.addColorStop(0.7, '#f4b25e'); g.addColorStop(1, '#f7d08a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffe8a8'; ctx.beginPath(); ctx.arc(W * 0.62, H * 0.58, 22, 0, 7); ctx.fill();
      const ridge = (y0, amp, col, seed) => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y0 - amp * (0.5 + 0.5 * Math.sin(x * 0.03 + seed) * Math.cos(x * 0.011 + seed * 2)));
        ctx.lineTo(W, H); ctx.fill();
      };
      ridge(H * 0.7, 40, '#6b3b6e', 1); ridge(H * 0.8, 30, '#4a2b55', 3); ridge(H * 0.92, 22, '#2b1a33', 5);
    });
    samples = { A, B };
    return samples;
  }
  const sampleLayer = (c, key) => ({ kind: 'media', src: { src: c, key: 'sample:' + key, w: 320, h: 180, stamp: 1 }, rect: { x: 0, y: 0, w: 1, h: 1 }, rot: 0, flip: false, video: Pr.defaultVideo(), filter: 'none', time: 0 });
  IM.sampleLayer = (which) => { const s = makeSamples(); return sampleLayer(which === 'B' ? s.B : s.A, which || 'A'); };

  function renderThumb(spec, canvas) {
    const r = IM.thumbRenderer();
    if (!r) return;
    try { r.render(spec); } catch (e) { console.warn(e); return; }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(r.canvas, 0, 0, canvas.width, canvas.height);
  }
  IM.renderThumb = renderThumb;

  const Content = {
    init(host) {
      this.el = h('div.browser-pane.content-pane.hidden');
      host.appendChild(this.el);
      this.header = h('div.br-header', h('div.br-title'));
      this.body = h('div.br-body');
      this.el.append(this.header, this.body);
      IM.bus.on('tab', () => this.render());
      IM.bus.on('view', () => this.render());
      IM.bus.on('libsel', () => { if (app.tab === 'audio') this.render(); });
      IM.lib.on('changed', () => { if (app.tab === 'audio' && app.libSel === 'audio:music') this.render(); });
    },
    render() {
      const show = app.view === 'editor' && app.tab !== 'media';
      this.el.classList.toggle('hidden', !show);
      if (!show) return;
      IM.clear(this.body);
      const title = this.header.querySelector('.br-title');
      if (app.tab === 'titles') { title.textContent = 'Titles'; this.renderTitles(); }
      else if (app.tab === 'backgrounds') { title.textContent = 'Backgrounds'; this.renderBackgrounds(); }
      else if (app.tab === 'transitions') { title.textContent = 'Transitions'; this.renderTransitions(); }
      else if (app.tab === 'audio') { title.textContent = { 'audio:soundtracks': 'Soundtracks', 'audio:sfx': 'Sound Effects', 'audio:music': 'Music' }[app.libSel] || 'Audio & Video'; this.renderAudio(); }
    },
    grid(cells) {
      const scroll = h('div.cg-scroll');
      const grid = h('div.cg-grid');
      cells.forEach((c) => grid.appendChild(c));
      scroll.appendChild(grid);
      this.body.appendChild(scroll);
      return scroll;
    },
    cell(name, draw, opts) {
      const c = h('canvas', { width: 264, height: 148 });
      const cell = h('div.cg-cell', h('div.cg-thumb', c), h('div.cg-name', name));
      draw(c, null);
      let hovering = false;
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        const f = clamp((e.clientX - r.left) / r.width, 0, 1);
        hovering = true;
        draw(c, f);
        opts.onSkim && opts.onSkim(f);
      });
      c.addEventListener('pointerleave', () => { hovering = false; draw(c, null); opts.onSkim && opts.onSkim(null); });
      c.addEventListener('pointerdown', (e) => {
        IM.$$('.cg-cell.sel', this.body).forEach((x) => x.classList.remove('sel'));
        cell.classList.add('sel');
        IM.drag(e, () => {
          if (this.dragging) return;
          this.dragging = true;
          const ghost = document.createElement('canvas');
          ghost.width = 112; ghost.height = 63;
          ghost.getContext('2d').drawImage(c, 0, 0, 112, 63);
          opts.onSkim && opts.onSkim(null);
          IM.DnD.start(e, opts.payload(), ghost, 1);
        }, () => { this.dragging = false; }, { threshold: 4 });
      });
      c.addEventListener('dblclick', () => opts.onDouble && opts.onDouble());
      c.addEventListener('contextmenu', (e) => { if (opts.menu) IM.contextMenu(e, opts.menu()); });
      void hovering;
      return cell;
    },
    // ------------------------------------------------------------------ titles
    renderTitles() {
      const S = makeSamples();
      const cells = IM.TitleStyles.visible().map((st) => {
        const it = Pr.makeTitle(st.id);
        const dur = Pr.dur(it);
        const draw = (c, f) => {
          const local = f == null ? IM.titleRestTime(it.title, dur) : f * dur;
          const base = sampleLayer(S.A, 'A');
          base.video = Object.assign(Pr.defaultVideo(), { color: Object.assign(Pr.defaultVideo().color, { bright: -0.25 }) });
          renderThumb({ base, overlays: [], titles: [{ title: it.title, local, dur, opacity: 1 }], time: local }, c);
        };
        return this.cell(st.name, draw, {
          payload: () => ({ kind: 'title', style: st.id, dur }),
          onSkim: (f) => { if (app.project && app.project.clips.length) app.player.setPreview(f == null ? null : { kind: 'title', style: st.id, local: f * dur }); },
          onDouble: () => this.addTitleAtPlayhead(st.id),
          menu: () => [{ label: 'Add to Project', action: () => this.addTitleAtPlayhead(st.id) }],
        });
      });
      this.grid(cells);
    },
    addTitleAtPlayhead(style) {
      const p = app.project;
      if (!p) return;
      const it = Pr.makeTitle(style);
      const t = app.player.t;
      if (!p.clips.length) IM.edit('Add Title', (pp) => Pr.append(pp, [it]));
      else IM.edit('Add Title', (pp) => { const L = Pr.layout(pp); Pr.connect(pp, [it], Math.min(t, Math.max(0, L.duration - 0.1)), IM.timelineUI.freeLane(t, Pr.dur(it), 1)); });
      IM.select([it.id]);
      if (IM.viewerUI) setTimeout(() => IM.viewerUI.editTitle(it.id), 30);
    },
    // ------------------------------------------------------------------ backgrounds
    renderBackgrounds() {
      const cells = IM.Backgrounds.list.map((bg) => {
        const it = Pr.makeBackground(bg.id);
        const draw = (c, f) => {
          const time = f == null ? 1.5 : f * 8;
          const e = { item: it, start: 0, end: 4, dur: 4 };
          const layer = IM.Compose.layer(e, time, IM.stillProvider, true);
          layer.time = time;
          renderThumb({ base: layer, overlays: [], titles: [], time }, c);
        };
        return this.cell(bg.name, draw, {
          payload: () => ({ kind: 'bg', bgId: bg.id, dur: 4 }),
          onDouble: () => this.addBackground(bg.id),
          menu: () => [{ label: 'Add to Project', action: () => this.addBackground(bg.id) }],
        });
      });
      this.grid(cells);
    },
    addBackground(bgId) {
      const p = app.project;
      if (!p) return;
      const it = Pr.makeBackground(bgId);
      IM.edit('Add Background', (pp) => Pr.insertAt(pp, app.player.t, [it]));
      IM.select([it.id]);
    },
    // ------------------------------------------------------------------ transitions
    renderTransitions() {
      const S = makeSamples();
      const cells = IM.Transitions.list.map((tr) => {
        const draw = (c, f) => {
          const pr = f == null ? 0.5 : f;
          renderThumb({ base: { kind: 'transition', type: tr.id, p: pr, a: sampleLayer(S.A, 'A'), b: sampleLayer(S.B, 'B') }, overlays: [], titles: [], time: pr }, c);
        };
        return this.cell(tr.name, draw, {
          payload: () => ({ kind: 'transition', type: tr.id, dur: 1 }),
          onDouble: () => this.addTransition(tr.id),
          menu: () => [{ label: 'Add to Project', action: () => this.addTransition(tr.id) }],
        });
      });
      this.grid(cells);
    },
    addTransition(type) {
      const p = app.project;
      if (!p || p.clips.length < 2) return;
      const L = Pr.layout(p);
      const sel = new Set(app.sel.ids);
      IM.edit('Add Transition', (pp) => {
        const d = IM.prefs.transitionDuration || 1;
        let any = false;
        if (sel.size) {
          pp.clips.forEach((c, i) => { if (i < pp.clips.length - 1 && (sel.has(c.id) || sel.has(pp.clips[i + 1].id))) { c.transition = { type, dur: d }; any = true; } });
        }
        if (!any) {
          let best = null, bd = 1e9;
          for (let i = 0; i < L.clips.length - 1; i++) { const dd = Math.abs(L.clips[i].visEnd - app.player.t); if (dd < bd) { bd = dd; best = L.clips[i].item.id; } }
          const c = pp.clips.find((x) => x.id === best);
          if (c) c.transition = { type, dur: d };
        }
      });
    },
    // ------------------------------------------------------------------ audio & video
    renderAudio() {
      const which = app.libSel || 'audio:soundtracks';
      let rows = [];
      if (which === 'audio:soundtracks') rows = IM.AudioGen ? IM.AudioGen.soundtracks.map((s) => ({ id: 'st:' + s.id, name: s.name, info: s.genre, dur: s.duration, builtin: true })) : [];
      else if (which === 'audio:sfx') rows = IM.AudioGen ? IM.AudioGen.sfx.map((s) => ({ id: 'sfx:' + s.id, name: s.name, info: s.category, dur: s.duration, builtin: true })) : [];
      else rows = IM.lib.allUserMedia().filter((m) => m.kind === 'audio' && m.source !== 'voiceover').map((m) => ({ id: m.id, name: m.name, info: IM.lib.eventById(m.eventId) ? IM.lib.eventById(m.eventId).name : '', dur: m.duration }));
      const wrap = h('div.au-wrap');
      const waveCanvas = h('canvas');
      const wave = h('div.au-wave', waveCanvas);
      const list = h('div.au-list');
      const table = h('table.au-table', h('thead', h('tr', h('th', { style: { width: '30px' } }, ''), h('th', 'Name'), h('th', which === 'audio:sfx' ? 'Category' : which === 'audio:music' ? 'Event' : 'Genre'), h('th', { style: { textAlign: 'right' } }, 'Time'))));
      const tbody = h('tbody');
      table.appendChild(tbody);
      list.appendChild(table);
      wrap.append(wave, list);
      this.body.appendChild(wrap);
      let selected = null;
      const drawWave = async (row) => {
        const ctx = waveCanvas.getContext('2d');
        const W = waveCanvas.width = wave.clientWidth * 2, H = waveCanvas.height = wave.clientHeight * 2;
        ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, W, H);
        if (!row) { ctx.fillStyle = '#666'; ctx.font = '24px -apple-system, Helvetica'; ctx.textAlign = 'center'; ctx.fillText(rows.length ? 'Select a sound to preview it' : (which === 'audio:music' ? 'Import audio files to see them here' : ''), W / 2, H / 2 + 8); return; }
        const m = await this.mediaFor(row);
        if (!m || selected !== row) return;
        if (!m.peaks) await new Promise((r) => { const off = IM.lib.on('peaks', (it) => { if (it === m) { off(); r(); } }); setTimeout(r, 4000); });
        if (!m.peaks || selected !== row) return;
        ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#4cb857';
        const pd = m.peaks.data;
        for (let x = 0; x < W; x++) {
          const i0 = Math.floor(x / W * pd.length), i1 = Math.max(i0 + 1, Math.floor((x + 1) / W * pd.length));
          let pk = 0; for (let i = i0; i < i1; i++) if (pd[i] > pk) pk = pd[i];
          const bh = pk / 255 * (H - 10);
          ctx.fillRect(x, H / 2 - bh / 2, 1, Math.max(1, bh));
        }
      };
      rows.forEach((row) => {
        const play = h('button.au-play', IM.icon('play', 9));
        const tr = h('tr', h('td', play), h('td', row.name), h('td', { style: { color: '#9a9a9a' } }, row.info || ''), h('td.dur', IM.fmtTime(row.dur)));
        tr.addEventListener('pointerdown', (e) => {
          IM.$$('tr.sel', tbody).forEach((x) => x.classList.remove('sel'));
          tr.classList.add('sel');
          selected = row;
          app.focus = 'browser';
          drawWave(row);
          if (e.target.closest('.au-play')) return;
          // the drag starts right away; built-in sounds finish generating in the background
          const m0 = this.mediaNow(row);
          IM.drag(e, () => {
            if (this.dragging || !m0) return;
            this.dragging = true;
            const ghost = IM.ghostFor(null, 140, 26, row.name);
            IM.setBrowserSelection([{ mediaId: m0.id, a: 0, b: m0.duration }]);
            IM.DnD.start(e, { kind: 'media', items: [{ mediaId: m0.id, a: 0, b: m0.duration }], dur: m0.duration, audioOnly: true }, ghost, 1);
          }, () => { this.dragging = false; }, { threshold: 4 });
          this.mediaFor(row).then((m) => { if (m && selected === row) IM.setBrowserSelection([{ mediaId: m.id, a: 0, b: m.duration }]); });
        });
        play.addEventListener('click', async (e) => {
          e.stopPropagation();
          const m = await this.mediaFor(row);
          if (!m) return;
          if (app.player.sourcePlay && app.player.sourcePlay.media === m) app.player.stopSource();
          else app.player.playSource(m, 0);
        });
        tr.addEventListener('dblclick', async () => {
          const m = await this.mediaFor(row);
          if (!m || !app.project) return;
          IM.setBrowserSelection([{ mediaId: m.id, a: 0, b: m.duration }]);
          IM.run(which === 'audio:sfx' ? 'connect' : 'append');
        });
        tbody.appendChild(tr);
      });
      requestAnimationFrame(() => drawWave(null));
    },
    /** Media record for a row without waiting for built-in audio to be generated. */
    mediaNow(row) { return row.builtin ? IM.builtinMedia(row.id) : IM.lib.get(row.id); },
    async mediaFor(row) {
      if (!row.builtin) return IM.lib.get(row.id);
      const m = IM.builtinMedia(row.id);
      if (m) await IM.ensureBuiltin(m);
      return m;
    },
  };
  IM.contentUI = Content;
})(window.IM = window.IM || {});
