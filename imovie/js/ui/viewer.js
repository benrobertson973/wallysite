/* Viewer: preview canvas, adjustments bar, transport controls, on-canvas editing (titles, crop, PiP) */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;
  const clamp = IM.clamp;

  const TOOLS = [
    ['overlay', 'overlay', 'Video Overlay Settings'],
    ['balance', 'color-balance', 'Color Balance'],
    ['color', 'color-correction', 'Color Correction'],
    ['crop', 'crop', 'Cropping'],
    ['stabilize', 'stabilize', 'Stabilization'],
    ['volume', 'volume', 'Volume'],
    ['eq', 'equalizer', 'Noise Reduction and Equalizer'],
    ['speed', 'speed', 'Speed'],
    ['filter', 'filter', 'Clip Filter and Audio Effects'],
    ['info', 'info', 'Clip Information'],
  ];

  const Viewer = {
    init(host) {
      this.el = h('div.viewer-pane');
      host.appendChild(this.el);
      this.bar = h('div.adj-bar');
      this.panel = h('div.adj-panel.hidden');
      this.canvas = h('canvas.viewer-canvas');
      this.overlay = h('div.viewer-overlay');
      this.status = h('div.viewer-status.hidden', 'Analyzing for stabilization…');
      this.stage = h('div.viewer-stage', this.canvas, this.overlay, this.status);
      this.playBtn = h('button.tp-btn.play', { 'data-tip': 'Play (Space)', on: { click: () => IM.run('play') } }, IM.icon('play', 18));
      const back = h('button.tp-btn', { 'data-tip': 'Go to previous clip', on: { click: () => IM.run('prevEdit') } }, IM.icon('back-end', 15));
      const fwd = h('button.tp-btn', { 'data-tip': 'Go to next clip', on: { click: () => IM.run('nextEdit') } }, IM.icon('forward-end', 15));
      this.micBtn = h('button.tp-btn', { 'data-tip': 'Record voiceover', on: { click: () => IM.run('voiceover') } }, IM.icon('mic', 16));
      this.fsBtn = h('button.tp-btn', { 'data-tip': 'Play full screen', on: { click: () => this.fullscreen(!this.isFullscreen()) } }, IM.icon('fullscreen', 15));
      this.transport = h('div.transport', h('div.tp-left', this.micBtn), back, this.playBtn, fwd, h('div.tp-right', this.fsBtn));
      this.meters = h('div.meters.hidden', h('div.m', h('i')), h('div.m', h('i')));
      this.el.append(this.bar, this.panel, this.stage, this.transport, this.meters);
      this.tool = null;
      this.renderer = new IM.Renderer(this.canvas, { width: 960, height: 540 });
      app.player.setRenderer(this.renderer);
      new ResizeObserver(() => this.layout()).observe(this.stage);
      app.player.on('play', (on) => this.updatePlay(on));
      app.player.on('rendered', () => this.syncOverlay());
      app.player.on('levels', (lv) => this.updateMeters(lv));
      IM.bus.on('selection', () => this.onSelection());
      IM.bus.on('bselection', () => this.onSelection());
      IM.bus.on('project-changed', () => { this.buildBar(); if (this.tool && !(IM.inspector && IM.inspector.live)) this.buildPanel(); this.syncOverlay(); });
      IM.bus.on('project-live', () => this.syncOverlay());
      IM.bus.on('stab-progress', (st) => this.status.classList.toggle('hidden', !st.active));
      IM.bus.on('view', () => { this.closeTool(); this.buildBar(); });
      IM.bus.on('meters', () => this.showMeters());
      app.player.on('time', () => { if (this.tool === 'crop' || this.editingTitle) this.syncOverlay(); });
      this.stage.addEventListener('pointerdown', (e) => this.onStageDown(e));
      this.stage.addEventListener('dblclick', (e) => this.onStageDbl(e));
      document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.el.classList.contains('fs')) this.fullscreen(false, true); });
      this.buildBar();
      this.showMeters();
    },
    layout() {
      const W = this.stage.clientWidth - 16, H = this.stage.clientHeight - 16;
      if (W <= 0 || H <= 0) return;
      let w = W, hh = W * 9 / 16;
      if (hh > H) { hh = H; w = H * 16 / 9; }
      this.canvas.style.width = Math.round(w) + 'px';
      this.canvas.style.height = Math.round(hh) + 'px';
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let rw = Math.round(w * dpr), rh = Math.round(hh * dpr);
      if (rw > 1280) { rw = 1280; rh = 720; }
      this.renderer.setSize(rw, rh);
      const r = this.canvas.getBoundingClientRect(), sr = this.stage.getBoundingClientRect();
      Object.assign(this.overlay.style, { left: (r.left - sr.left) + 'px', top: (r.top - sr.top) + 'px', width: r.width + 'px', height: r.height + 'px' });
      app.player.invalidate();
      this.syncOverlay();
    },
    updatePlay(on) {
      IM.clear(this.playBtn).appendChild(IM.icon(on ? 'pause' : 'play', 18));
      this.playBtn.setAttribute('data-tip', on ? 'Pause (Space)' : 'Play (Space)');
      if (on && this.editingTitle) this.stopTitleEdit();
      // crops apply as they're made: playing shows the result instead of the crop frame
      if (on && this.tool === 'crop') this.closeTool();
    },
    isFullscreen() { return this.el.classList.contains('fs'); },
    fullscreen(on, fromEvent) {
      if (on) {
        this.el.classList.add('fs');
        document.body.classList.remove('native-fullscreen');
        if (this.el.requestFullscreen) this.el.requestFullscreen().catch(() => {});
        IM.clear(this.fsBtn).appendChild(IM.icon('fullscreen-exit', 15));
        setTimeout(() => this.layout(), 60);
        if (!app.player.isPlaying()) app.player.play();
      } else {
        this.el.classList.remove('fs');
        if (!fromEvent && document.fullscreenElement) document.exitFullscreen().catch(() => {});
        IM.clear(this.fsBtn).appendChild(IM.icon('fullscreen', 15));
        setTimeout(() => this.layout(), 60);
      }
    },
    showMeters() {
      this.meters.classList.toggle('hidden', !IM.prefs.meters);
      app.player.metersOn = !!IM.prefs.meters;
      this.stage.style.marginRight = IM.prefs.meters ? '20px' : '0';
      this.transport.style.marginRight = IM.prefs.meters ? '20px' : '0';
      app.player.invalidate();
    },
    updateMeters(lv) {
      if (!IM.prefs.meters) return;
      const bars = this.meters.querySelectorAll('i');
      lv.forEach((v, i) => {
        const db = v > 0 ? 20 * Math.log10(v) : -80;
        const f = clamp((db + 60) / 60, 0, 1);
        bars[i].style.height = (f * 100) + '%';
        bars[i].style.backgroundSize = '100% ' + (100 / Math.max(0.01, f)) + '%';
        bars[i].style.backgroundPosition = 'bottom';
      });
    },

    // ------------------------------------------------------------------ adjustments bar
    current() {
      const s = IM.selectedItems();
      if (s.length === 1) return s[0];
      if (s.length > 1) return s[0];
      return null;
    },
    onSelection() {
      const cur = this.current();
      if (this.editingTitle && (!cur || cur.item.id !== this.editingTitle)) this.stopTitleEdit();
      if (this.tool && !this.toolAvailable(this.tool)) this.closeTool();
      if (this.tool === 'crop') this.exitCropPreview();
      this.buildBar();
      if (this.tool) this.buildPanel();
      if (cur && cur.item.type === 'bg' && !this.tool) this.buildPanel('bgcolor');
      this.syncOverlay();
    },
    toolAvailable(tool) {
      const cur = this.current();
      if (!cur) return false;
      const it = cur.item;
      const visual = it.type === 'video' || it.type === 'image' || it.type === 'freeze' || it.type === 'bg';
      const audible = it.type === 'audio' || (it.type === 'video' && !it.audio.detached);
      switch (tool) {
        case 'overlay': return cur.where === 'connected' && visual;
        case 'balance': case 'color': return visual && it.type !== 'bg' || it.type === 'bg';
        case 'crop': return (it.type === 'video' || it.type === 'image' || it.type === 'freeze');
        case 'stabilize': return it.type === 'video';
        case 'volume': case 'eq': return audible;
        case 'speed': return it.type === 'video' || it.type === 'audio';
        case 'filter': return visual || audible;
        case 'info': return true;
        default: return false;
      }
    },
    buildBar() {
      const bar = IM.clear(this.bar);
      const cur = this.current();
      // trailer cards are styled by the template
      if (cur && cur.item.type === 'title' && app.project && app.project.kind === 'trailer') return;
      if (cur && cur.item.type === 'title' && app.view === 'editor') { this.buildTitleBar(cur.item); return; }
      const wand = h('button.adj-btn', { 'data-tip': 'Enhance', on: { click: () => IM.run('enhance') } }, IM.icon('wand', 17));
      if (!IM.can('enhance')) wand.disabled = true;
      bar.appendChild(wand);
      bar.appendChild(h('div.adj-sep'));
      for (const [id, icon, tip] of TOOLS) {
        const b = h('button.adj-btn' + (this.tool === id ? '.active' : ''), { 'data-tip': tip, on: { click: () => this.toggleTool(id) } }, IM.icon(icon, 17));
        if (!this.toolAvailable(id)) b.disabled = true;
        if (cur && this.toolIsModified(id, cur.item)) b.classList.add('on');
        bar.appendChild(b);
      }
      if (this.tool) bar.appendChild(h('button.link-btn.adj-reset', { on: { click: () => this.resetAll() } }, 'Reset All'));
    },
    toolIsModified(tool, it) {
      const v = it.video || {}, a = it.audio || {};
      switch (tool) {
        case 'balance': return v.balance && v.balance.mode !== 'none';
        case 'color': { const c = v.color || {}; return !!(c.shadows || c.bright || c.highlights || c.contrast || (c.sat != null && c.sat !== 1) || c.temp); }
        case 'crop': return it.type === 'video' && v.crop && v.crop.mode !== 'fit' || !!v.rotate;
        case 'stabilize': return !!v.stabilize || !!v.rollingShutter;
        case 'volume': return a.volume !== 1 || a.mute || a.duck;
        case 'eq': return (a.eq && a.eq !== 'flat') || a.nr > 0;
        case 'speed': return (it.speed || 1) !== 1 || it.reverse;
        case 'filter': return (v.filter && v.filter !== 'none') || (a.effect && a.effect !== 'none');
        default: return false;
      }
    },
    toggleTool(id) {
      if (this.tool === id) { this.closeTool(); return; }
      if (this.tool === 'crop') this.exitCropPreview();
      this.tool = id;
      this.buildBar();
      this.buildPanel();
      this.syncOverlay();
    },
    closeTool() {
      if (this.tool === 'crop') this.exitCropPreview();
      this.tool = null;
      this.panel.classList.add('hidden');
      IM.clear(this.panel);
      this.buildBar();
      this.syncOverlay();
      setTimeout(() => this.layout(), 0);
    },
    buildPanel(force) {
      const cur = this.current();
      const tool = force || this.tool;
      if (!cur || !tool || !IM.inspector) { this.panel.classList.add('hidden'); setTimeout(() => this.layout(), 0); return; }
      IM.clear(this.panel);
      this.panel.classList.remove('hidden');
      IM.inspector.build(tool, cur, this.panel, this);
      setTimeout(() => this.layout(), 0);
    },
    resetAll() {
      const cur = this.current();
      if (!cur) return;
      IM.edit('Reset All', (p) => {
        const f = Pr.findItem(p, cur.item.id);
        if (!f) return false;
        const it = f.item;
        if (it.type !== 'title') {
          const keepCrop = it.type === 'image' ? it.video.crop : null;
          it.video = Pr.defaultVideo();
          if (keepCrop) it.video.crop = keepCrop;
        }
        it.audio = Object.assign(Pr.defaultAudio(), { detached: it.audio.detached, fadeIn: it.audio.fadeIn, fadeOut: it.audio.fadeOut });
        if (it.type === 'video' || it.type === 'audio') { Pr.setSpeed(p, it.id, 1); it.reverse = false; }
        if (f.where === 'connected' && it.overlay) it.overlay = Pr.defaultOverlay();
      });
    },

    // ------------------------------------------------------------------ title font bar
    buildTitleBar(it) {
      const bar = this.bar;
      const t = it.title;
      const upd = (label, fn) => IM.edit(label, (p) => { const f = Pr.findItem(p, it.id); if (f) fn(f.item.title); }, { coalesce: 'title-' + it.id + label });
      const fontBtn = IM.popupButton(IM.FONTS.map((f) => ({ value: f, label: f })), t.font, (v) => upd('Change Font', (tt) => { tt.font = v; }), { width: 140 });
      const sizes = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5];
      const sizeBtn = IM.popupButton(sizes.map((s) => ({ value: s, label: String(Math.round(s * 100) / 100 * 48 | 0) })), sizes.reduce((a, b) => (Math.abs(b - t.size) < Math.abs(a - t.size) ? b : a)), (v) => upd('Change Size', (tt) => { tt.size = v; }), { width: 60 });
      const alignBtn = (al, icon) => h('button.adj-btn' + (t.align === al ? '.active' : ''), { 'data-tip': 'Align ' + al, on: { click: () => upd('Change Alignment', (tt) => { tt.align = al; }) } }, IM.icon(icon, 15));
      const tog = (key, icon, tip) => h('button.adj-btn' + (t[key] ? '.active' : ''), { 'data-tip': tip, on: { click: () => upd('Change Style', (tt) => { tt[key] = !tt[key]; }) } }, IM.icon(icon, 15));
      const color = IM.colorWell(t.color || '#ffffff', (v) => { const live = Pr.findItem(app.project, it.id); if (live) { live.item.title.color = v; app.player.invalidate(); } }, (v) => upd('Change Color', (tt) => { tt.color = v; }));
      const outlineColor = IM.colorWell(t.outlineColor || '#000000', null, (v) => upd('Change Outline Color', (tt) => { tt.outlineColor = v; }));
      bar.append(
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          fontBtn, sizeBtn, h('div.adj-sep'),
          alignBtn('left', 'align-left'), alignBtn('center', 'align-center'), alignBtn('right', 'align-right'), alignBtn('justify', 'align-justify'),
          h('div.adj-sep'), tog('bold', 'bold', 'Bold'), tog('italic', 'italic', 'Italic'), tog('outline', 'outline-text', 'Outline'),
          h('div.adj-sep'), color, t.outline ? outlineColor : null),
        h('button.link-btn.adj-reset', {
          on: {
            click: () => upd('Reset Title', (tt) => {
              const st = IM.TitleStyles.get(tt.style);
              Object.assign(tt, { font: st.font, size: 1, color: st.color, align: st.align, bold: false, italic: false, outline: false });
            }),
          },
        }, 'Reset All'));
    },

    // ------------------------------------------------------------------ overlays (title editing, crop, pip)
    syncOverlay() {
      const ov = this.overlay;
      if (this._overlayLock) return;
      const cur = this.current();
      let kind = null;
      if (cur && app.view === 'editor') {
        if (this.tool === 'crop' && this.toolAvailable('crop')) kind = 'crop';
        else if (this.tool === 'overlay' && cur.item.overlay && cur.item.overlay.mode === 'pip') kind = 'pip';
        else if (this.editingTitle === cur.item.id) kind = 'title';
      }
      // title fields are updated in place, so typing keeps its focus and selection
      if (kind === 'title') { this._overlaySig = null; this.titleOverlay(cur); return; }
      this._titleEds = null;
      // this runs after every frame the viewer draws: rebuild only when something the overlay shows has changed
      const it = kind && cur.item;
      const sig = kind && JSON.stringify([kind, it.id, kind === 'crop' ? [it.video.crop, it.video.rotate] : it.overlay,
        ov.clientWidth, ov.clientHeight, this.visibleNow(it.id)]);
      if (sig && sig === this._overlaySig) {
        // the crop view shows the whole picture: keep it that way if anything else previewed in between
        if (kind === 'crop') app.player.setPreview({ kind: 'cropEdit', id: it.id, mediaId: it.mediaId });
        return;
      }
      this._overlaySig = sig;
      IM.clear(ov);
      if (kind === 'crop') this.cropOverlay(cur);
      else if (kind === 'pip') this.pipOverlay(cur);
    },
    visibleNow(itemId) {
      const p = app.project;
      const L = Pr.layout(p);
      const e = L.byId.get(itemId);
      const t = app.player.displayTime;
      return e && t >= e.start - 1e-3 && t <= e.end + 1e-3;
    },
    // --- titles ---
    editTitle(id) {
      const p = app.project;
      const L = Pr.layout(p);
      const e = L.byId.get(id);
      if (!e) return;
      if (app.player.isPlaying()) app.player.pause();
      const t = app.player.t;
      if (t < e.start || t > e.end) app.player.seek(e.start + Math.min(e.dur / 2, IM.titleRestTime(e.item.title, e.dur)));
      this.editingTitle = id;
      this._titleOpenedAt = performance.now();
      this.buildBar();
      this.syncOverlay();
      setTimeout(() => { const ta = this.overlay.querySelector('.title-editor'); if (ta && document.activeElement !== ta) { ta.focus(); ta.select(); } }, 30);
    },
    stopTitleEdit() {
      this.editingTitle = null;
      this._titleEds = null;
      this._overlaySig = null;
      app.player.setPreview(null);
      IM.clear(this.overlay);
    },
    titleOverlay(cur) {
      const it = cur.item;
      const e = Pr.layout(app.project).byId.get(it.id);
      if (!e) return;
      const rest = IM.titleRestTime(it.title, e.dur);
      const W = this.renderer.W, H = this.renderer.H;
      const boxes = [];
      const tmp = this._measureCanvas || (this._measureCanvas = document.createElement('canvas'));
      tmp.width = W; tmp.height = H;
      IM.renderTitle(tmp.getContext('2d'), W, H, it.title, rest, e.dur, { boxes, static: true });
      const st = IM.TitleStyles.get(it.title.style);
      const scale = this.overlay.clientWidth / W;
      const fields = st.fields || 2;
      app.player.setPreview({ kind: 'titleStatic', id: it.id, local: rest });
      // the same title keeps its text fields (rebuilding them would lose the cursor while typing)
      let eds = this._titleEds;
      if (!eds || eds.id !== it.id || eds.fields.length !== fields || eds.fields.some((ta) => !ta.isConnected)) {
        IM.clear(this.overlay);
        eds = this._titleEds = { id: it.id, fields: [] };
        for (let i = 0; i < fields; i++) {
          const ta = this.titleField(it.id, i, !!(st.multiline && st.multiline[i]));
          eds.fields.push(ta);
          this.overlay.appendChild(ta);
        }
      }
      for (let i = 0; i < fields; i++) {
        const ta = eds.fields[i];
        let b = boxes[i];
        if (!b) {
          // empty line: place below the previous one
          const prev = boxes[i - 1] || boxes[0];
          if (!prev) { ta.style.display = 'none'; continue; }
          b = { x: prev.x, y: prev.y + prev.h * 1.4, w: Math.max(prev.w * 0.6, 120), h: prev.h * 0.7, align: prev.align, font: prev.font, cx: prev.cx };
        }
        const multi = ta.rows > 1;
        const px = parseFloat((b.font || '40px').match(/(\d+(?:\.\d+)?)px/)[1]) * scale;
        Object.assign(ta.style, {
          display: '',
          left: (b.x * scale - 6) + 'px', top: (b.y * scale - 4) + 'px', width: (Math.max(b.w, 60) * scale + 12) + 'px',
          height: (multi ? Math.min(this.overlay.clientHeight * 0.7, b.h * scale + 10) : (b.h * scale + 10)) + 'px',
          fontSize: px + 'px', lineHeight: multi ? '1.35' : (b.h * scale + 2) + 'px', textAlign: b.align === 'justify' ? 'left' : b.align,
        });
        // show changes made elsewhere (undo, another field), but never overwrite the field being typed in
        const text = (it.title.text[i] || '').replace(/\t/g, '    ');
        if (document.activeElement !== ta && ta.value !== text) ta.value = text;
      }
    },
    /** One line (or block) of a title's text, edited in place over the viewer. */
    titleField(id, i, multi) {
      const ta = h('textarea.title-editor', { spellcheck: false, rows: multi ? 6 : 1 });
      ta.addEventListener('input', () => {
        const v = multi ? ta.value.replace(/ {4}/g, '\t') : ta.value.replace(/\n/g, ' ');
        IM.edit('Edit Title', (p) => { const f = Pr.findItem(p, id); if (f) f.item.title.text[i] = v; }, { coalesce: 'title-text-' + id });
      });
      ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        const all = () => this.overlay.querySelectorAll('.title-editor');
        if (ev.key === 'Escape') { ta.blur(); this.stopTitleEdit(); }
        if (ev.key === 'Enter' && !multi) { ev.preventDefault(); const next = all()[i + 1]; if (next && next.style.display !== 'none') next.focus(); else ta.blur(); }
        if (ev.key === 'Tab') { ev.preventDefault(); const a = all(); const n = a[(i + (ev.shiftKey ? -1 : 1) + a.length) % a.length]; if (n) n.focus(); }
      });
      ta.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      // double-clicking a title opens it with its text selected, ready to type over; later double-clicks select a word
      ta.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        if (performance.now() - (this._titleOpenedAt || 0) < 800) ta.select();
      });
      return ta;
    },
    onStageDown(e) {
      if (e.target !== this.canvas && e.target !== this.stage && e.target !== this.overlay) return;
      const cur = this.current();
      // click on a visible title in the viewer to edit it
      if (app.view === 'editor' && app.project && !app.player.isPlaying()) {
        const hit = this.titleAtPoint(e);
        if (hit) { IM.select([hit]); this.editTitle(hit); return; }
      }
      if (this.editingTitle) this.stopTitleEdit();
      if (this.pickMode) { this.pickColor(e); return; }
      void cur;
    },
    onStageDbl(e) {
      if (app.view !== 'editor') return;
      // double-click a title to edit it (the first click has usually opened it already); anywhere else plays
      const hit = app.project && this.titleAtPoint(e);
      if (hit) {
        if (this.editingTitle !== hit) { IM.select([hit]); this.editTitle(hit); }
        const ta = this.overlay.querySelector('.title-editor');
        if (ta) { ta.focus(); ta.select(); }
        return;
      }
      if (this.editingTitle) return;
      IM.run('play');
    },
    titleAtPoint(e) {
      const p = app.project;
      if (!p || p.kind === 'trailer') return null;
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * this.renderer.W, y = (e.clientY - r.top) / r.height * this.renderer.H;
      const t = app.player.t;
      const L = Pr.layout(p);
      const cands = L.connected.filter((c) => c.item.type === 'title' && t >= c.start && t <= c.end).concat(L.clips.filter((c) => c.item.type === 'title' && t >= c.start && t <= c.end));
      for (const e2 of cands) {
        const boxes = [];
        const tmp = this._measureCanvas || (this._measureCanvas = document.createElement('canvas'));
        tmp.width = this.renderer.W; tmp.height = this.renderer.H;
        IM.renderTitle(tmp.getContext('2d'), this.renderer.W, this.renderer.H, e2.item.title, IM.titleRestTime(e2.item.title, e2.dur), e2.dur, { boxes, static: true });
        if (boxes.some((b) => b && x >= b.x - 10 && x <= b.x + b.w + 10 && y >= b.y - 10 && y <= b.y + b.h + 10)) return e2.item.id;
      }
      return null;
    },
    // --- color picking (white balance / skin tone) ---
    startPick(kind, cb) {
      this.pickMode = { kind, cb };
      this.stage.style.cursor = 'crosshair';
    },
    pickColor(e) {
      const pm = this.pickMode;
      this.pickMode = null;
      this.stage.style.cursor = '';
      const r = this.canvas.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
      const snap = this.renderer.snapshot(160, 90);
      const d = snap.getContext('2d').getImageData(Math.floor(x * 159), Math.floor(y * 89), 1, 1).data;
      pm.cb([d[0] / 255, d[1] / 255, d[2] / 255]);
    },
    // --- crop / ken burns ---
    exitCropPreview() { this._overlaySig = null; app.player.setPreview(null); },
    cropOverlay(cur) {
      const it = cur.item;
      const m = IM.lib.get(it.mediaId);
      if (!m) return;
      const e = Pr.layout(app.project).byId.get(it.id);
      if (!e) return;
      if (!this.visibleNow(it.id)) { app.player.seek(e.start + Math.min(0.5, e.dur / 2)); }
      app.player.setPreview({ kind: 'cropEdit', id: it.id, mediaId: it.mediaId });
      const ow = this.overlay.clientWidth, oh = this.overlay.clientHeight;
      const fit = Pr.fitRect(m, it.video.rotate || 0);
      // map source-normalized rect -> overlay px
      const toPx = (r) => ({ x: (r.x - fit.x) / fit.w * ow, y: (r.y - fit.y) / fit.h * oh, w: r.w / fit.w * ow, h: r.h / fit.h * oh });
      const fromPx = (q) => ({ x: fit.x + q.x / ow * fit.w, y: fit.y + q.y / oh * fit.h, w: q.w / ow * fit.w, h: q.h / oh * fit.h });
      const crop = it.video.crop;
      const mk = (key, cls, label) => {
        const rect = crop[key] || Pr.coverRect(m, it.video.rotate || 0);
        const q = toPx(rect);
        const box = h('div.crop-box.' + cls, h('div.lbl', label || ''), h('div.hd.nw'), h('div.hd.ne'), h('div.hd.sw'), h('div.hd.se'));
        Object.assign(box.style, { left: q.x + 'px', top: q.y + 'px', width: q.w + 'px', height: q.h + 'px' });
        box.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          const handle = ev.target.classList.contains('hd') ? ev.target.className.split(' ')[1] : null;
          const start = Object.assign({}, q);
          const live = IM.beginLive('Crop');
          this._overlayLock = true;
          IM.drag(ev, (dx, dy) => {
            let n = Object.assign({}, start);
            const aspect = start.w / start.h;
            if (!handle) { n.x = start.x + dx; n.y = start.y + dy; }
            else {
              let w = start.w + (handle.includes('e') ? dx : -dx);
              w = clamp(w, 40, ow * 1.0);
              const hh = w / aspect;
              if (handle.includes('w')) n.x = start.x + start.w - w;
              if (handle.includes('n')) n.y = start.y + start.h - hh;
              n.w = w; n.h = hh;
            }
            // keep inside the picture
            n.w = Math.min(n.w, ow); n.h = Math.min(n.h, oh);
            n.x = clamp(n.x, 0, ow - n.w); n.y = clamp(n.y, 0, oh - n.h);
            Object.assign(box.style, { left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px' });
            const nr = fromPx(n);
            live.update((p) => { const f = Pr.findItem(p, it.id); if (f) f.item.video.crop[key] = nr; });
          }, (ev2, moved) => { this._overlayLock = false; if (moved) live.commit(); this.syncOverlay(); }, { threshold: 1 });
        });
        this.overlay.appendChild(box);
        return q;
      };
      if (crop.mode === 'fill') mk('fill', 'fill', '');
      else if (crop.mode === 'kenburns') {
        if (!crop.kbStart || !crop.kbEnd) Pr.defaultKenBurns(it, m);
        const a = mk('kbStart', 'kb-start', 'Start');
        const b = mk('kbEnd', 'kb-end', 'End');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'kb-arrow');
        svg.setAttribute('width', ow); svg.setAttribute('height', oh);
        svg.style.left = '0'; svg.style.top = '0';
        const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2, x2 = b.x + b.w / 2, y2 = b.y + b.h / 2;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/>` +
          `<path d="M${x2} ${y2} L${x2 - 10 * Math.cos(ang - 0.4)} ${y2 - 10 * Math.sin(ang - 0.4)} L${x2 - 10 * Math.cos(ang + 0.4)} ${y2 - 10 * Math.sin(ang + 0.4)} Z" fill="#fff"/>`;
        this.overlay.insertBefore(svg, this.overlay.firstChild);
        const swap = h('button.btn.small.kb-swap', { 'data-tip': 'Swap the start and end', on: { click: (ev) => { ev.stopPropagation(); IM.edit('Swap Ken Burns', (p) => { const f = Pr.findItem(p, it.id); const c = f.item.video.crop; const t2 = c.kbStart; c.kbStart = c.kbEnd; c.kbEnd = t2; }); } } }, '⇄');
        Object.assign(swap.style, { left: '8px', top: '8px' });
        this.overlay.appendChild(swap);
      } else {
        // fit: nothing to drag, show the frame
        const q = toPx(fit);
        const box = h('div.crop-box', { style: { left: q.x + 'px', top: q.y + 'px', width: q.w + 'px', height: q.h + 'px', boxShadow: 'none', borderStyle: 'dashed', cursor: 'default', borderColor: 'rgba(255,255,255,.5)' } });
        this.overlay.appendChild(box);
      }
    },
    // --- picture in picture ---
    pipOverlay(cur) {
      const it = cur.item;
      if (!this.visibleNow(it.id)) return;
      const ow = this.overlay.clientWidth, oh = this.overlay.clientHeight;
      const pp = it.overlay.pip;
      const box = h('div.pip-box', h('div.hd'));
      const place = (x, y, s) => Object.assign(box.style, { left: x * ow + 'px', top: y * oh + 'px', width: s * ow + 'px', height: s * oh + 'px' });
      place(pp.x, pp.y, pp.scale);
      box.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        const resize = ev.target.classList.contains('hd');
        const s0 = { x: pp.x, y: pp.y, s: pp.scale };
        const live = IM.beginLive('Move Picture in Picture');
        this._overlayLock = true;
        IM.drag(ev, (dx, dy) => {
          let x = s0.x, y = s0.y, s = s0.s;
          if (resize) s = clamp(s0.s + dx / ow, 0.1, 0.9);
          else { x = clamp(s0.x + dx / ow, 0, 1 - s); y = clamp(s0.y + dy / oh, 0, 1 - s); }
          place(x, y, s);
          live.update((p) => { const f = Pr.findItem(p, it.id); if (f) Object.assign(f.item.overlay.pip, { x, y, scale: s }); });
        }, (ev2, moved) => { this._overlayLock = false; if (moved) live.commit(); }, { threshold: 1 });
      });
      this.overlay.appendChild(box);
    },
  };
  IM.viewerUI = Viewer;
})(window.IM = window.IM || {});
