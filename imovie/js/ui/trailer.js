/* Trailer chooser and the trailer editor (Outline, Storyboard, Shot List) */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;
  const TR = () => IM.trailers;

  // ------------------------------------------------------------------ small canvases
  /** Draw a title-style frame (card, placeholder…) into canvas c at time t. */
  function drawStyle(c, title, t, dur) {
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    IM.renderTitle(ctx, c.width, c.height, title, t, dur);
  }
  function wellThumb(c, p, sg) {
    const fill = p.trailer.fills[sg.index];
    const m = fill && IM.lib.get(fill.mediaId);
    const ctx = c.getContext('2d');
    if (m) {
      const th = m.kind === 'image' ? null : IM.lib.thumbAt(m, (fill.srcIn || 0) + Math.min(sg.d / 2, 0.5));
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
      if (th) {
        const ta = c.width / c.height, sa = th.sw / th.sh;
        let sx = th.sx, sy = th.sy, sw = th.sw, sh = th.sh;
        if (sa > ta) { sw = th.sh * ta; sx += (th.sw - sw) / 2; } else { sh = th.sw / ta; sy += (th.sh - sh) / 2; }
        ctx.drawImage(th.img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      } else if (m.image) {
        const ta = c.width / c.height, sa = m.width / m.height;
        let sw = m.width, sh = m.height, sx = 0, sy = 0;
        if (sa > ta) { sw = m.height * ta; sx = (m.width - sw) / 2; } else { sh = m.width / ta; sy = (m.height - sh) / 2; }
        ctx.drawImage(m.image, sx, sy, sw, sh, 0, 0, c.width, c.height);
      }
      return;
    }
    drawStyle(c, { style: 'trailer-placeholder', text: [TR().SHOTS[sg.k], sg.cast != null ? TR().castName(p, sg.cast) : '', sg.k] }, 0.5, 1);
  }

  // ------------------------------------------------------------------ chooser
  function chooser() {
    const list = TR().TEMPLATES;
    let sel = list[1].id;
    const grid = h('div.trc-grid');
    const info = h('div.trc-info');
    const cells = list.map((T) => {
      const c = h('canvas', { width: 256, height: 144 });
      const title = { style: 'trailer-title:' + T.id, text: [T.name], font: T.font, color: T.color };
      drawStyle(c, title, 1.2, 2.4);
      let raf = 0, t0 = 0;
      const loop = (now) => { if (!t0) t0 = now; drawStyle(c, title, ((now - t0) / 1000) % 2.4, 2.4); raf = requestAnimationFrame(loop); };
      const cell = h('div.trc-cell' + (T.id === sel ? '.sel' : ''), c, h('div.trc-name', T.name));
      cell.addEventListener('pointerenter', () => { cancelAnimationFrame(raf); t0 = 0; raf = requestAnimationFrame(loop); });
      cell.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); drawStyle(c, title, 1.2, 2.4); });
      cell.addEventListener('click', () => { sel = T.id; cells.forEach((x) => x.classList.toggle('sel', x === cell)); showInfo(); });
      cell.addEventListener('dblclick', () => { sel = T.id; create(); });
      grid.appendChild(cell);
      return cell;
    });
    const showInfo = () => {
      const T = TR().get(sel);
      const n = T.cast[0] === T.cast[1] ? String(T.cast[0]) : T.cast[0] + '–' + T.cast[1];
      IM.clear(info).append(h('b', T.name), h('span', 'Cast members: ' + n), h('span', 'Duration: ' + IM.fmtTime(TR().duration(T))));
    };
    showInfo();
    let s;
    const create = () => { s.close(); IM.newTrailer(sel); };
    s = IM.sheet(h('div.trc',
      h('div.trc-head', 'Trailers'),
      grid,
      h('div.sheet-footer', info, h('div', { style: { flex: 1 } }), h('button.btn', { on: { click: () => s.close() } }, 'Cancel'), h('button.btn.primary', { on: { click: create } }, 'Create'))), { width: 860 });
  }

  // ------------------------------------------------------------------ editor pane
  const UI = {
    el: null, tab: 'outline', sel: null,
    init(host) {
      this.el = h('div.trailer-pane.hidden');
      this.tabs = IM.segmented([{ value: 'outline', label: 'Outline' }, { value: 'storyboard', label: 'Storyboard' }, { value: 'shots', label: 'Shot List' }], this.tab, (v) => { this.tab = v; this.render(); });
      this.body = h('div.tr-body');
      this.el.append(h('div.tr-top', this.tabs), this.body);
      host.appendChild(this.el);
      IM.bus.on('project-opened', () => this.sync(true));
      IM.bus.on('view', () => this.sync(true));
      IM.bus.on('project-changed', () => this.sync(false));
      IM.lib.on('thumbs', () => { if (this.active() && this.tab !== 'outline') this.refreshWells(); });
    },
    active() { return !!(app.project && app.project.kind === 'trailer' && app.view === 'editor'); },
    sync(full) {
      const on = this.active();
      this.el.classList.toggle('hidden', !on);
      if (IM.timelineUI && IM.timelineUI.el) IM.timelineUI.el.classList.toggle('hidden', on);
      if (!on) return;
      if (full) { this.sel = null; this.render(); return; }
      // keep typing undisturbed; refresh wells and labels
      if (this.tab === 'outline') { if (!this.el.contains(document.activeElement)) this.render(); }
      else this.render(true);
    },
    edit(label, fn, key) { IM.edit(label, (p) => { fn(p.trailer, p); }, key ? { coalesce: 'trailer-' + key } : undefined); },
    render(keepScroll) {
      const p = app.project;
      if (!p || p.kind !== 'trailer') return;
      const st = this.body.scrollTop;
      IM.clear(this.body);
      this.tabs.setValue(this.tab);
      if (this.tab === 'outline') this.renderOutline(p);
      else if (this.tab === 'storyboard') this.renderStoryboard(p);
      else this.renderShots(p);
      if (keepScroll) this.body.scrollTop = st;
    },
    field(label, value, onInput, o) {
      const inp = h('input.text-field', { type: 'text', value: value || '', placeholder: (o && o.placeholder) || '' });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inp.addEventListener('input', () => onInput(inp.value));
      return h('div.tr-row', h('label', label), inp);
    },
    renderOutline(p) {
      const tr = p.trailer, T = TR().get(tr.template);
      const sec = (title, ...rows) => h('div.tr-sec', h('div.tr-sec-title', title), h('div.tr-sec-body', ...rows));
      const castRows = tr.cast.map((c, i) => {
        const g = IM.popupButton([{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }], c.gender || 'male', (v) => this.edit('Change Cast', (t) => { t.cast[i].gender = v; }));
        const row = this.field('Cast Member ' + (i + 1) + ':', c.name, (v) => this.edit('Change Cast', (t) => { t.cast[i].name = v; }, 'cast' + i));
        row.appendChild(g);
        return row;
      });
      const plus = h('button.btn.small', { on: { click: () => this.edit('Add Cast Member', (t) => { if (t.cast.length < T.cast[1]) t.cast.push({ name: 'Cast Member ' + (t.cast.length + 1), gender: 'male' }); }) } }, '+');
      const minus = h('button.btn.small', { on: { click: () => this.edit('Remove Cast Member', (t) => { if (t.cast.length > T.cast[0]) t.cast.pop(); }) } }, '−');
      if (tr.cast.length >= T.cast[1]) plus.disabled = true;
      if (tr.cast.length <= T.cast[0]) minus.disabled = true;
      const logo = IM.popupButton(TR().LOGOS.map((l) => ({ value: l.id, label: l.name })), tr.logo || T.logo, (v) => this.edit('Change Logo', (t) => { t.logo = v; }), { width: 150 });
      this.body.append(h('div.tr-outline',
        sec('Name and Date',
          this.field('Movie Name:', tr.title, (v) => this.edit('Change Movie Name', (t) => { t.title = v; }, 'title')),
          this.field('Release Date:', tr.date, (v) => this.edit('Change Release Date', (t) => { t.date = v; }, 'date'))),
        sec('Cast', ...castRows, h('div.tr-row', h('label', ''), h('div.tr-pm', minus, plus))),
        sec('Studio',
          this.field('Studio Name:', tr.studio, (v) => this.edit('Change Studio', (t) => { t.studio = v; }, 'studio')),
          h('div.tr-row', h('label', 'Logo Style:'), logo)),
        sec('Credits', ...TR().CREDITS.map(([k, label]) => this.field(label + ':', tr.credits[k], (v) => this.edit('Change Credits', (t) => { t.credits[k] = v; }, 'cr-' + k))))));
    },
    /** Shot well for segment sg. */
    well(p, sg) {
      const fill = p.trailer.fills[sg.index];
      const c = h('canvas', { width: 192, height: 108 });
      wellThumb(c, p, sg);
      const label = TR().SHOTS[sg.k] + (sg.cast != null && TR().castName(p, sg.cast) ? ' – ' + TR().castName(p, sg.cast) : '');
      const w = h('div.tr-well' + (this.sel === sg.index ? '.sel' : '') + (fill ? '.filled' : ''), c,
        h('div.tr-well-label', h('span', label), h('span.tr-dur', sg.d.toFixed(1) + 's')));
      w._seg = sg;
      w.addEventListener('click', () => this.select(sg.index));
      if (fill) {
        const clear = h('button.tr-x', { 'data-tip': 'Remove clip', on: { click: (e) => { e.stopPropagation(); this.edit('Remove Clip', (t) => { delete t.fills[sg.index]; }); } } }, '×');
        const on = fill.volume > 0;
        const snd = h('button.tr-snd' + (on ? '.on' : ''), { 'data-tip': on ? 'Mute clip audio' : 'Play clip audio', on: { click: (e) => { e.stopPropagation(); this.edit(on ? 'Mute Clip' : 'Unmute Clip', (t) => { t.fills[sg.index].volume = on ? 0 : 1; }); } } }, IM.icon(on ? 'volume' : 'volume-mute', 12));
        w.append(clear, snd);
      }
      return w;
    },
    renderStoryboard(p) {
      const segs = TR().segmentsOf(p);
      const box = h('div.tr-board');
      let row = null;
      for (const sg of segs) {
        if (sg.t === 'shot') {
          if (!row) { row = h('div.tr-wells'); box.appendChild(row); }
          row.appendChild(this.well(p, sg));
          continue;
        }
        row = null;
        if (sg.t === 'card') {
          const inp = h('input.tr-card', { type: 'text', value: TR().cardTextOf(p, sg.index) });
          inp.addEventListener('keydown', (e) => e.stopPropagation());
          inp.addEventListener('focus', () => this.seekTo(sg));
          inp.addEventListener('input', () => this.edit('Change Text', (t) => { t.cards[sg.index] = inp.value; }, 'card' + sg.index));
          box.appendChild(h('div.tr-cardrow', inp));
        } else if (sg.t === 'castcard') {
          box.appendChild(h('div.tr-cardrow', h('div.tr-card.static', TR().castName(p, sg.cast).toUpperCase())));
        }
      }
      this.body.append(box);
    },
    renderShots(p) {
      const segs = TR().segmentsOf(p).filter((s) => s.t === 'shot');
      const kinds = Object.keys(TR().SHOTS).filter((k) => segs.some((s) => s.k === k));
      const box = h('div.tr-board');
      for (const k of kinds) {
        box.appendChild(h('div.tr-group-title', TR().SHOTS[k]));
        const row = h('div.tr-wells');
        segs.filter((s) => s.k === k).forEach((sg) => row.appendChild(this.well(p, sg)));
        box.appendChild(row);
      }
      this.body.append(box);
    },
    refreshWells() {
      const p = app.project;
      this.body.querySelectorAll('.tr-well').forEach((w) => wellThumb(w.querySelector('canvas'), p, w._seg));
    },
    seekTo(sg) {
      const L = Pr.layout(app.project);
      const e = L.byId.get('trl-' + sg.index);
      if (e) app.player.seek(e.start + Math.min(0.4, e.dur / 2));
    },
    select(index) {
      this.sel = this.sel === index ? null : index;
      this.body.querySelectorAll('.tr-well').forEach((w) => w.classList.toggle('sel', w._seg.index === this.sel));
      // a filled shot can be adjusted with the tools above the viewer
      const filled = this.sel != null && app.project.trailer.fills[this.sel];
      IM.select(filled ? ['trl-' + this.sel] : []);
      const sg = this.sel != null ? TR().segmentsOf(app.project).find((s) => s.index === this.sel) : null;
      if (sg) this.seekTo(sg);
    },
    /** A browser click fills the selected shot (and moves on to the next empty one). */
    wantsClick() { return this.active() && this.sel != null; },
    selDur() { const sg = TR().segmentsOf(app.project).find((s) => s.index === this.sel); return sg ? sg.d : 1; },
    fillSelected(m, t) { return this.fill(this.sel, m, t); },
    fill(index, m, t) {
      if (index == null || !m || m.kind === 'audio') return false;
      this.edit('Add Clip', (tr) => {
        const prev = tr.fills[index];
        tr.fills[index] = { mediaId: m.id, srcIn: m.kind === 'image' ? 0 : Math.max(0, t || 0), volume: prev && prev.mediaId === m.id ? prev.volume : 0 };
      });
      // advance to the next empty well
      const segs = TR().segmentsOf(app.project).filter((s) => s.t === 'shot');
      const i = segs.findIndex((s) => s.index === index);
      const next = segs.slice(i + 1).concat(segs.slice(0, i)).find((s) => !app.project.trailer.fills[s.index]);
      this.sel = next ? next.index : null;
      this.render(true);
      if (next) this.seekTo(next);
      return true;
    },
    // drag & drop from the browser onto wells
    dragOver(payload, x, y) {
      this.body.querySelectorAll('.tr-well.drop').forEach((w) => w.classList.remove('drop'));
      if (payload.kind !== 'media') return false;
      const el = document.elementFromPoint(x, y);
      const w = el && el.closest && el.closest('.tr-well');
      if (!w || !this.el.contains(w)) return false;
      w.classList.add('drop');
      return true;
    },
    drop(payload, x, y) {
      const el = document.elementFromPoint(x, y);
      const w = el && el.closest && el.closest('.tr-well');
      this.body.querySelectorAll('.tr-well.drop').forEach((q) => q.classList.remove('drop'));
      if (!w || payload.kind !== 'media' || !payload.items.length) return false;
      const s = payload.items[0];
      return this.fill(w._seg.index, IM.lib.get(s.mediaId), s.a || 0);
    },
    dragLeave() { this.body.querySelectorAll('.tr-well.drop').forEach((q) => q.classList.remove('drop')); },
  };

  IM.trailerUI = UI;
  IM.trailers = Object.assign(IM.trailers || {}, { chooser });
  IM.newTrailer = function (templateId) {
    const T = TR().get(templateId);
    const name = IM.lib.uniqueProjectName(T ? T.name : 'My Trailer');
    const ev = IM.lib.createEvent(name, true);
    const p = TR().create(templateId, name);
    p.eventId = ev.id;
    IM.lib.addProject(p);
    IM.openProject(p);
    UI.tab = 'outline';
    UI.render();
    return p;
  };
})(window.IM = window.IM || {});
