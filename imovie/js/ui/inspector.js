/* Adjustment panels shown above the viewer (color, crop, volume, speed, filters, overlays, info …) */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;
  const clamp = IM.clamp;

  /** Undoable live update of the selected item(s). */
  function upd(ids, label, fn, coalesce) {
    // continuous (slider) edits must not rebuild the panel under the pointer
    if (coalesce) Inspector.live = true;
    try {
      IM.edit(label, (p) => {
        for (const id of ids) { const f = Pr.findItem(p, id); if (f) fn(f.item, f, p); }
      }, coalesce ? { coalesce: coalesce + ids.join(',') } : undefined);
    } finally { Inspector.live = false; }
  }
  // stabilization analysis in progress (survives panel rebuilds)
  const stabJob = { n: 0, key: '', text: '' };
  const setStabText = (key, text) => {
    if (stabJob.key === key) stabJob.text = text;
    document.querySelectorAll('.stab-status').forEach((el) => { if (el.dataset.key === key) el.textContent = text; });
  };
  const selIds = () => app.sel.ids.slice();
  const grp = (...kids) => h('div.grp', ...kids);
  const lbl = (t) => h('label', t);
  const pct = (v) => Math.round(v * 100) + '%';

  const Inspector = {
    build(tool, cur, panel, viewer) {
      const fn = this[tool];
      if (fn) fn.call(this, cur, panel, viewer);
    },

    // ------------------------------------------------------------------ video overlay
    overlay(cur, panel) {
      const it = cur.item;
      const ov = it.overlay || Pr.defaultOverlay();
      const ids = selIds();
      const mode = IM.popupButton([
        { value: 'cutaway', label: 'Cutaway' }, { value: 'greenscreen', label: 'Green/Blue Screen' },
        { value: 'split', label: 'Split Screen' }, { value: 'pip', label: 'Picture in Picture' },
      ], ov.mode, (v) => upd(ids, 'Change Video Overlay', (x) => { x.overlay = x.overlay || Pr.defaultOverlay(); x.overlay.mode = v; }), { width: 150 });
      panel.append(grp(h('span.adj-title', 'Video Overlay:'), mode));
      if (ov.mode === 'cutaway') {
        const fade = IM.slider({ min: 0, max: 2, step: 0.1, value: ov.fade || 0, width: 110, onInput: (v) => { fadeLbl.textContent = v.toFixed(1) + 's'; upd(ids, 'Change Fade', (x) => { x.overlay.fade = v; }, 'ovfade'); } });
        const fadeLbl = h('span', (ov.fade || 0).toFixed(1) + 's');
        const op = IM.slider({ min: 0, max: 1, step: 0.01, value: ov.opacity == null ? 1 : ov.opacity, width: 110, onInput: (v) => { opLbl.textContent = pct(v); upd(ids, 'Change Opacity', (x) => { x.overlay.opacity = v; }, 'ovop'); } });
        const opLbl = h('span', pct(ov.opacity == null ? 1 : ov.opacity));
        panel.append(grp(lbl('Fade:'), fade, fadeLbl), grp(lbl('Opacity:'), op, opLbl));
      } else if (ov.mode === 'greenscreen') {
        const soft = IM.slider({ min: 0, max: 1, step: 0.01, value: ov.key.softness, width: 110, onInput: (v) => upd(ids, 'Change Softness', (x) => { x.overlay.key.softness = v; }, 'ksoft') });
        const str = IM.slider({ min: 0, max: 1, step: 0.01, value: ov.key.strength == null ? 0.4 : ov.key.strength, width: 90, onInput: (v) => upd(ids, 'Change Key Strength', (x) => { x.overlay.key.strength = v; }, 'kstr') });
        const auto = h('button.btn.small', { on: { click: () => upd(ids, 'Auto Key Color', (x) => { x.overlay.key.color = null; }) } }, 'Auto');
        const well = IM.colorWell(ov.key.color || '#20c040', null, (v) => upd(ids, 'Key Color', (x) => { x.overlay.key.color = v; }));
        panel.append(grp(lbl('Softness:'), soft), grp(lbl('Strength:'), str), grp(lbl('Key:'), well, auto));
      } else if (ov.mode === 'split') {
        const side = IM.popupButton([{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }], ov.split.side, (v) => upd(ids, 'Change Position', (x) => { x.overlay.split.side = v; }), { width: 90 });
        const slide = IM.slider({ min: 0, max: 2, step: 0.1, value: ov.split.slide || 0, width: 110, onInput: (v) => { slLbl.textContent = v.toFixed(1) + 's'; upd(ids, 'Change Slide', (x) => { x.overlay.split.slide = v; }, 'slide'); } });
        const slLbl = h('span', (ov.split.slide || 0).toFixed(1) + 's');
        panel.append(grp(lbl('Position:'), side), grp(lbl('Slide:'), slide, slLbl));
      } else if (ov.mode === 'pip') {
        const pp = ov.pip;
        const style = IM.popupButton([{ value: 'dissolve', label: 'Dissolve' }, { value: 'zoom', label: 'Zoom' }], pp.style, (v) => upd(ids, 'Change Style', (x) => { x.overlay.pip.style = v; }), { width: 90 });
        const border = IM.popupButton([{ value: 'none', label: 'None' }, { value: 'thin', label: 'Thin' }, { value: 'thick', label: 'Thick' }], pp.border, (v) => upd(ids, 'Change Border', (x) => { x.overlay.pip.border = v; }), { width: 72 });
        const bc = IM.colorWell(pp.borderColor || '#ffffff', null, (v) => upd(ids, 'Border Color', (x) => { x.overlay.pip.borderColor = v; }));
        const shadow = IM.checkbox('Shadow', pp.shadow, (v) => upd(ids, 'Shadow', (x) => { x.overlay.pip.shadow = v; }));
        const fade = IM.slider({ min: 0, max: 2, step: 0.1, value: ov.fade || 0, width: 80, onInput: (v) => upd(ids, 'Change Transition', (x) => { x.overlay.fade = v; }, 'pfade') });
        panel.append(grp(lbl('Style:'), style), grp(lbl('Border:'), border, bc), grp(shadow), grp(lbl('Transition:'), fade));
      }
    },

    // ------------------------------------------------------------------ color balance
    balance(cur, panel, viewer) {
      const it = cur.item;
      const ids = selIds();
      const b = it.video.balance || { mode: 'none' };
      const hint = h('span', { style: { color: '#9a9a9a' } });
      const mode = IM.popupButton([
        { value: 'none', label: 'None' }, { value: 'auto', label: 'Auto' }, { value: 'match', label: 'Match Color…' },
        { value: 'wb', label: 'White Balance' }, { value: 'skin', label: 'Skin Tone Balance' },
        { value: 'incandescent', label: 'Incandescent Light' },
      ], b.mode || 'none', (v) => {
        if (v === 'none') upd(ids, 'Color Balance', (x) => { x.video.balance = { mode: 'none', gains: [1, 1, 1] }; });
        else if (v === 'incandescent') upd(ids, 'Fix Incandescent Light', (x) => {
          // each clip is measured on its own: the light (and the camera's own correction) varies from shot to shot
          const m = IM.lib.get(x.mediaId);
          const light = m ? IM.lightTemperature(m, x) : null;
          if (light == null) return;
          const amount = 1;
          x.video.balance = { mode: 'incandescent', light, amount, gains: IM.warmLightGains(light, amount) };
        });
        else if (v === 'auto') upd(ids, 'Auto Color Balance', (x) => {
          const m = IM.lib.get(x.mediaId); const st = m ? IM.frameStats(m, x.type === 'freeze' ? x.frameTime : (x.srcIn + x.srcOut) / 2) : null;
          if (!st) return; const avg = (st.r + st.g + st.b) / 3;
          x.video.balance = { mode: 'auto', gains: [clamp(avg / st.r, 0.7, 1.4), clamp(avg / st.g, 0.7, 1.4), clamp(avg / st.b, 0.7, 1.4)] };
        });
        else if (v === 'wb' || v === 'skin') {
          hint.textContent = v === 'wb' ? 'Click something in the viewer that should be white or gray.' : 'Click on a person’s skin in the viewer.';
          viewer.startPick(v, (rgb) => {
            hint.textContent = '';
            upd(ids, v === 'wb' ? 'White Balance' : 'Skin Tone Balance', (x) => {
              const [r, g, bl] = rgb.map((c) => Math.max(0.02, c));
              let gains;
              if (v === 'wb') { const avg = (r + g + bl) / 3; gains = [avg / r, avg / g, avg / bl]; }
              else { const target = [1, 0.78, 0.64]; const l = (r + g + bl) / 3 / ((target[0] + target[1] + target[2]) / 3); gains = [target[0] * l / r, target[1] * l / g, target[2] * l / bl]; }
              x.video.balance = { mode: v, gains: gains.map((q) => clamp(q, 0.5, 2)) };
            });
          });
        } else if (v === 'match') {
          hint.textContent = 'Skim the timeline and click a clip with the look you want to match.';
          IM.bus.once = IM.bus.once || ((ev, fn) => { const off = IM.bus.on(ev, (...a) => { off(); fn(...a); }); });
          const handler = (e) => {
            const tl = IM.timelineUI;
            if (!tl || !tl.canvas.contains(e.target)) return;
            e.stopPropagation(); e.preventDefault();
            window.removeEventListener('pointerdown', handler, true);
            const pt = tl.toContent(e);
            const t = clamp(tl.xt(pt.x), 0, Pr.duration(app.project));
            const e2 = Pr.primaryAt(app.project, t);
            hint.textContent = '';
            if (!e2 || !e2.item.mediaId) return;
            const ref = IM.frameStats(IM.lib.get(e2.item.mediaId), Pr.srcTime(e2.item, t - e2.start));
            upd(ids, 'Match Color', (x) => {
              const m = IM.lib.get(x.mediaId);
              const st = m ? IM.frameStats(m, (x.srcIn + x.srcOut) / 2) : null;
              if (!st || !ref) return;
              x.video.balance = { mode: 'match', gains: [clamp(ref.r / st.r, 0.5, 2), clamp(ref.g / st.g, 0.5, 2), clamp(ref.b / st.b, 0.5, 2)] };
            });
          };
          window.addEventListener('pointerdown', handler, true);
        }
      }, { width: 150 });
      panel.append(grp(h('span.adj-title', 'Color Balance:'), mode), hint);
      if (b.mode === 'incandescent') {
        const val = h('span', pct(b.amount == null ? 1 : b.amount));
        const amount = IM.slider({
          min: 0, max: 1, step: 0.01, value: b.amount == null ? 1 : b.amount, width: 120,
          onInput: (v) => {
            val.textContent = pct(v);
            upd(ids, 'Incandescent Amount', (x) => {
              const bb = x.video.balance;
              if (bb && bb.mode === 'incandescent') { bb.amount = v; bb.gains = IM.warmLightGains(bb.light, v); }
            }, 'incandescent');
          },
        });
        const note = b.light >= 5000 ? 'This clip’s light isn’t very warm, so there’s little to take out.' : 'Takes the orange of light bulbs out of the picture.';
        panel.append(grp(lbl('Amount:'), amount, val), h('span', { style: { color: '#9a9a9a' } }, note));
      }
    },

    // ------------------------------------------------------------------ color correction
    color(cur, panel) {
      const it = cur.item;
      const ids = selIds();
      const c = it.video.color;
      // multi-slider: shadows | brightness | highlights (+ contrast via the outer handles)
      const ms = h('div.multi-slider', h('div.track'));
      const knobs = [
        { key: 'shadows', cls: '', min: -1, max: 1, pos: (v) => 0.18 + v * 0.14 },
        { key: 'bright', cls: '.mid', min: -1, max: 1, pos: (v) => 0.5 + v * 0.14 },
        { key: 'highlights', cls: '', min: -1, max: 1, pos: (v) => 0.82 + v * 0.14 },
      ];
      const W = 178;
      knobs.forEach((k) => {
        const el = h('div.knob' + k.cls, { 'data-tip': { shadows: 'Shadows', bright: 'Brightness', highlights: 'Highlights' }[k.key] });
        el.style.left = (6 + k.pos(c[k.key] || 0) * W) + 'px';
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const start = c[k.key] || 0;
          IM.drag(e, (dx) => {
            const v = clamp(start + dx / (W * 0.14), -1, 1);
            el.style.left = (6 + k.pos(v) * W) + 'px';
            upd(ids, 'Color Correction', (x) => { x.video.color[k.key] = Math.round(v * 100) / 100; }, 'cc-' + k.key);
          }, null, { threshold: 0 });
        });
        el.addEventListener('dblclick', () => { upd(ids, 'Color Correction', (x) => { x.video.color[k.key] = 0; }); el.style.left = (6 + k.pos(0) * W) + 'px'; });
        ms.appendChild(el);
      });
      const contrast = IM.slider({ min: -0.6, max: 0.8, step: 0.01, value: c.contrast || 0, width: 80, reset: 0, onInput: (v) => upd(ids, 'Contrast', (x) => { x.video.color.contrast = v; }, 'contrast') });
      const sat = IM.slider({ min: 0, max: 2, step: 0.01, value: c.sat == null ? 1 : c.sat, width: 100, reset: 1, centered: true, onInput: (v) => upd(ids, 'Saturation', (x) => { x.video.color.sat = v; }, 'sat') });
      sat.classList.add('sat-track');
      const temp = IM.slider({ min: -1, max: 1, step: 0.01, value: c.temp || 0, width: 100, reset: 0, centered: true, onInput: (v) => upd(ids, 'Color Temperature', (x) => { x.video.color.temp = v; }, 'temp') });
      temp.classList.add('temp-track');
      panel.append(grp(ms), grp(lbl('Contrast'), contrast), grp(lbl('Saturation'), sat), grp(lbl('Temperature'), temp));
    },

    // ------------------------------------------------------------------ crop / ken burns / rotation
    crop(cur, panel, viewer) {
      const it = cur.item;
      const ids = selIds();
      const cr = it.video.crop;
      const m = IM.lib.get(it.mediaId);
      const seg = (mode, label) => h('button.btn' + (cr.mode === mode ? '.primary' : ''), {
        on: {
          click: () => upd(ids, 'Crop', (x) => {
            const mm = IM.lib.get(x.mediaId);
            x.video.crop.mode = mode;
            if (mode === 'fill' && !x.video.crop.fill) x.video.crop.fill = Pr.coverRect(mm, x.video.rotate || 0);
            if (mode === 'kenburns' && (!x.video.crop.kbStart || !x.video.crop.kbEnd)) Pr.defaultKenBurns(x, mm);
          }),
        },
      }, label);
      const rot = (d) => upd(ids, 'Rotate', (x) => {
        x.video.rotate = ((x.video.rotate || 0) + d + 360) % 360;
        const mm = IM.lib.get(x.mediaId);
        x.video.crop.fill = null;
        if (x.video.crop.mode === 'kenburns') Pr.defaultKenBurns(x, mm);
      });
      panel.append(
        grp(h('span.adj-title', 'Style:'), seg('fit', 'Fit'), seg('fill', 'Crop to Fill'), seg('kenburns', 'Ken Burns')),
        grp(h('button.adj-btn', { 'data-tip': 'Rotate counterclockwise', on: { click: () => rot(-90) } }, IM.icon('rotate-left', 16)),
          h('button.adj-btn', { 'data-tip': 'Rotate clockwise', on: { click: () => rot(90) } }, IM.icon('rotate-right', 16))),
        // no Apply button: every change is saved as it's made, and playing or clicking the timeline shows the result
        h('span.crop-note', { style: { marginLeft: 'auto', color: '#9a9a9a' } }, 'Applied automatically'));
      void m; void viewer;
    },

    // ------------------------------------------------------------------ stabilization
    stabilize(cur, panel) {
      const it = cur.item;
      const ids = selIds();
      const v = it.video;
      const S = IM.stabilizer;
      const key = ids.join(',');
      const st = h('span.stab-status', { style: { color: '#9a9a9a', minWidth: '110px' } }, stabJob.key === key ? stabJob.text : '');
      st.dataset.key = key;
      const items = () => ids.map((id) => Pr.findItem(app.project, id)).filter(Boolean).map((f) => f.item).filter((x) => x.type === 'video');
      // analyze every selected clip, then apply `fn` as one undoable edit (unless the user changed their mind)
      const withAnalysis = (label, fn, revert) => {
        const my = ++stabJob.n;
        stabJob.key = key;
        const list = items();
        if (list.every((x) => S.ready(x))) { setStabText(key, ''); upd(ids, label, fn); return; }
        setStabText(key, 'Analyzing…');
        (async () => {
          for (let i = 0; i < list.length; i++) {
            await S.analyze(list[i], (f) => { if (my === stabJob.n) setStabText(key, 'Analyzing… ' + Math.round(((i + f) / list.length) * 100) + '%'); });
          }
        })().then(() => {
          if (my !== stabJob.n) return;
          setStabText(key, '');
          upd(ids, label, fn);
        }, (e) => {
          console.warn(e);
          if (my !== stabJob.n) return;
          setStabText(key, 'Couldn’t analyze this clip');
          if (revert) revert();
        });
      };
      const cancel = () => { stabJob.n++; setStabText(key, ''); };
      const amt = IM.slider({ min: 0.05, max: 1, step: 0.01, value: v.stabilize || 0.5, width: 110, onInput: (x) => { if (v.stabilize) upd(ids, 'Stabilization', (y) => { y.video.stabilize = x; }, 'stab'); } });
      amt.disabled = !v.stabilize;
      amt.setAttribute('data-tip', 'Amount of stabilization');
      const cb = IM.checkbox('Stabilize Shaky Video', !!v.stabilize, (on) => {
        amt.disabled = !on;
        if (on) withAnalysis('Stabilize', (y) => { y.video.stabilize = parseFloat(amt.value) || 0.5; }, () => { cb.querySelector('input').checked = false; amt.disabled = true; });
        else { cancel(); upd(ids, 'Stabilize', (y) => { y.video.stabilize = 0; }); }
      });
      const levels = [{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }, { label: 'Extra High', value: 'extra' }];
      const curLevel = v.rollingShutter === true ? 'medium' : (v.rollingShutter || 'medium');
      const rsOff = () => { rsCb.querySelector('input').checked = false; };
      const pop = IM.popupButton(levels, curLevel, (lv) => {
        if (v.rollingShutter) { upd(ids, 'Rolling Shutter', (y) => { y.video.rollingShutter = lv; }); return; }
        rsCb.querySelector('input').checked = true;
        withAnalysis('Fix Rolling Shutter', (y) => { y.video.rollingShutter = lv; }, rsOff);
      }, { width: 104 });
      const rsCb = IM.checkbox('Fix Rolling Shutter', !!v.rollingShutter, (on) => {
        if (on) withAnalysis('Fix Rolling Shutter', (y) => { y.video.rollingShutter = pop.value || 'medium'; }, rsOff);
        else { cancel(); upd(ids, 'Fix Rolling Shutter', (y) => { y.video.rollingShutter = false; }); }
      });
      panel.append(grp(cb, amt, st), grp(rsCb, pop));
    },

    // ------------------------------------------------------------------ volume
    volume(cur, panel) {
      const it = cur.item;
      const ids = selIds();
      const a = it.audio;
      const muteBtn = h('button.adj-btn', { 'data-tip': a.mute ? 'Unmute' : 'Mute', on: { click: () => upd(ids, a.mute ? 'Unmute' : 'Mute', (x) => { x.audio.mute = !a.mute; }) } }, IM.icon(a.mute ? 'volume-mute' : 'volume', 17));
      const val = h('span', { style: { width: '40px', textAlign: 'right' } }, pct(a.volume));
      const vol = IM.slider({ min: 0, max: 4, step: 0.01, value: a.volume, width: 150, reset: 1, onInput: (v) => { const vv = Math.abs(v - 1) < 0.03 ? 1 : v; val.textContent = pct(vv); upd(ids, 'Adjust Volume', (x) => { x.audio.volume = vv; x.audio.mute = false; }, 'vol'); } });
      const auto = h('button.btn.small', { on: { click: () => this.autoVolume(ids) } }, 'Auto');
      const duckAmt = IM.slider({ min: 0, max: 1, step: 0.01, value: a.duckAmount == null ? 0.75 : a.duckAmount, width: 90, onInput: (v) => upd(ids, 'Lower Volume of Other Clips', (x) => { x.audio.duckAmount = v; }, 'duck') });
      duckAmt.disabled = !a.duck;
      const duck = IM.checkbox('Lower volume of other clips', !!a.duck, (on) => { duckAmt.disabled = !on; upd(ids, 'Lower Volume of Other Clips', (x) => { x.audio.duck = on; }); });
      panel.append(grp(muteBtn, vol, val, auto), grp(duck, duckAmt));
    },
    async autoVolume(ids) {
      const p = app.project;
      const gains = {};
      for (const id of ids) {
        const f = Pr.findItem(p, id);
        if (!f) continue;
        const m = IM.lib.get(f.item.mediaId);
        if (!m || !m.peaks) continue;
        const pd = m.peaks.data, r = m.peaks.rate;
        let sum = 0, n = 0, mx = 0;
        for (let i = Math.floor(f.item.srcIn * r); i < Math.min(pd.length, f.item.srcOut * r); i++) { sum += pd[i] * pd[i]; n++; if (pd[i] > mx) mx = pd[i]; }
        const rms = Math.sqrt(sum / Math.max(1, n)) / 255;
        gains[id] = clamp(Math.min(0.35 / Math.max(0.01, rms), 0.95 / Math.max(0.01, mx / 255)), 0.1, 4);
      }
      upd(ids, 'Auto Volume', (x) => { if (gains[x.id] != null) x.audio.volume = Math.round(gains[x.id] * 100) / 100; });
    },

    // ------------------------------------------------------------------ noise reduction & equalizer
    eq(cur, panel) {
      const it = cur.item;
      const ids = selIds();
      const a = it.audio;
      const nrVal = h('span', pct(a.nr || 0.5));
      const nr = IM.slider({ min: 0, max: 1, step: 0.01, value: a.nr || 0.5, width: 120, onInput: (v) => { nrVal.textContent = pct(v); upd(ids, 'Reduce Background Noise', (x) => { x.audio.nr = v; }, 'nr'); } });
      nr.disabled = !a.nr;
      const cb = IM.checkbox('Reduce background noise by:', !!a.nr, (on) => { nr.disabled = !on; upd(ids, 'Reduce Background Noise', (x) => { x.audio.nr = on ? (parseFloat(nr.value) || 0.5) : 0; }); });
      const eq = IM.popupButton(IM.EQPresets.list.map((e) => ({ value: e.id, label: e.name })), a.eq || 'flat', (v) => upd(ids, 'Equalizer', (x) => { x.audio.eq = v; }), { width: 140 });
      panel.append(grp(cb, nr, nrVal), grp(lbl('Equalizer:'), eq));
    },

    // ------------------------------------------------------------------ speed
    speed(cur, panel) {
      const it = cur.item;
      const ids = selIds();
      const sp = it.speed || 1;
      const kind = sp < 1 ? 'slow' : sp > 1 ? 'fast' : 'normal';
      const setSpeed = (v) => IM.edit('Speed', (p) => { for (const id of ids) Pr.setSpeed(p, id, v); });
      const speedMenu = IM.popupButton([
        { value: 'normal', label: 'Normal' }, { value: 'slow', label: 'Slow' }, { value: 'fast', label: 'Fast' },
        { value: 'freeze', label: 'Freeze Frame' }, { value: 'custom', label: 'Custom' },
      ], Math.abs(sp - [0.5, 0.25, 0.1, 2, 4, 8, 20, 1].find((x) => Math.abs(x - sp) < 1e-3) || 0) < 1e-3 ? kind : 'custom', (v) => {
        if (v === 'normal') setSpeed(1);
        else if (v === 'slow') setSpeed(0.5);
        else if (v === 'fast') setSpeed(2);
        else if (v === 'freeze') IM.run('freezeFrame');
        else if (v === 'custom') this.speed(cur, IM.clear(panel), null, true);
      }, { width: 110 });
      panel.append(grp(h('span.adj-title', 'Speed:'), speedMenu));
      if (kind === 'slow' || kind === 'fast') {
        const opts = kind === 'slow' ? [0.5, 0.25, 0.1] : [2, 4, 8, 20];
        panel.append(grp(...opts.map((o) => h('button.btn.small' + (Math.abs(o - sp) < 1e-3 ? '.primary' : ''), { on: { click: () => setSpeed(o) } }, o < 1 ? Math.round(o * 100) + '%' : o + 'x'))));
      }
      const field = h('input.text-field', { type: 'text', value: String(Math.round(sp * 100)), style: { width: '52px', textAlign: 'right' } });
      field.addEventListener('change', () => { const v = parseFloat(field.value); if (isFinite(v) && v > 0) setSpeed(clamp(v / 100, 0.05, 20)); });
      field.addEventListener('keydown', (e) => e.stopPropagation());
      panel.append(grp(lbl('Custom:'), field, h('span', '%')));
      panel.append(grp(IM.checkbox('Reverse', !!it.reverse, (on) => upd(ids, 'Reverse', (x) => { x.reverse = on; }))));
      panel.append(grp(IM.checkbox('Preserve pitch', it.preservePitch !== false, (on) => upd(ids, 'Preserve Pitch', (x) => { x.preservePitch = on; }))));
      panel.append(h('button.link-btn.reset-link', { on: { click: () => { setSpeed(1); upd(ids, 'Reset Speed', (x) => { x.reverse = false; }); } } }, 'Reset'));
    },

    // ------------------------------------------------------------------ clip filter & audio effects
    filter(cur, panel) {
      const it = cur.item;
      const f = (IM.Filters.get((it.video && it.video.filter) || 'none') || IM.Filters.get('none')).name;
      const af = (IM.AudioEffects.get((it.audio && it.audio.effect) || 'none') || IM.AudioEffects.get('none')).name;
      const hasV = it.type !== 'audio';
      const hasA = it.type === 'audio' || (it.type === 'video' && !it.audio.detached);
      const fb = h('button.popup-btn', { style: { width: '130px' }, on: { click: (e) => this.filterChooser(e.currentTarget, cur) } }, f);
      const ab = h('button.popup-btn', { style: { width: '130px' }, on: { click: (e) => this.audioFxChooser(e.currentTarget, cur) } }, af);
      if (!hasV) fb.disabled = true;
      if (!hasA) ab.disabled = true;
      panel.append(grp(lbl('Clip Filter:'), fb), grp(lbl('Audio Effect:'), ab));
    },
    filterChooser(anchor, cur, projectWide) {
      const p = app.project;
      const it = cur ? cur.item : null;
      const ids = selIds();
      const grid = h('div.fx-grid');
      const e = it ? Pr.layout(p).byId.get(it.id) : null;
      const t = e ? clamp(app.player.t, e.start, e.end - 0.01) : app.player.t;
      const baseSpec = () => {
        if (projectWide || !it) return IM.Compose.frame(p, app.player.t, IM.stillProvider, { noStabRequest: true });
        const layer = IM.Compose.layer(e, t, IM.stillProvider, true, {});
        return { base: layer, overlays: [], titles: [], time: t };
      };
      const current = projectWide ? p.settings.filter || 'none' : (it.video.filter || 'none');
      for (const fl of IM.Filters.list) {
        const c = h('canvas', { width: 208, height: 116 });
        const spec = baseSpec();
        if (projectWide) spec.projectFilter = fl.id;
        else if (spec.base && spec.base.kind === 'media') { spec.base.filter = fl.id; spec.base.flip = fl.id === 'flipped'; }
        else if (spec.base) spec.base.filter = fl.id;
        IM.renderThumb(spec, c);
        const cell = h('div.fx-cell' + (fl.id === current ? '.sel' : ''), c, h('div', fl.name));
        cell.addEventListener('pointerenter', () => { if (!projectWide && it) app.player.setPreview({ kind: 'filter', id: it.id, filter: fl.id }); });
        cell.addEventListener('pointerleave', () => app.player.setPreview(null));
        cell.addEventListener('click', () => {
          app.player.setPreview(null);
          if (projectWide) IM.edit('Project Filter', (pp) => { pp.settings.filter = fl.id; });
          else upd(ids, 'Clip Filter', (x) => { if (x.video) x.video.filter = fl.id; });
          IM.closePopovers();
        });
        grid.appendChild(cell);
      }
      IM.popover(anchor, h('div', h('h4', projectWide ? 'Project Filter' : 'Clip Filter'), grid), { side: 'bottom', onClose: () => app.player.setPreview(null) });
    },
    projectFilterChooser(anchor) { this.filterChooser(anchor, null, true); },
    audioFxChooser(anchor, cur) {
      const it = cur.item;
      const ids = selIds();
      const grid = h('div.fx-grid.audio');
      for (const fx of IM.AudioEffects.list) {
        const cell = h('div.fx-cell' + ((it.audio.effect || 'none') === fx.id ? '.sel' : ''), h('div.aud-ic', IM.icon(fx.id === 'none' ? 'waveform' : 'volume', 22)), h('div', fx.name));
        cell.addEventListener('click', () => { upd(ids, 'Audio Effect', (x) => { x.audio.effect = fx.id; }); IM.closePopovers(); });
        grid.appendChild(cell);
      }
      IM.popover(anchor, h('div', h('h4', 'Audio Effects'), grid), { side: 'bottom' });
    },

    // ------------------------------------------------------------------ clip info
    info(cur, panel) {
      const it = cur.item;
      const p = app.project;
      const e = Pr.layout(p).byId.get(it.id);
      const m = it.mediaId ? IM.lib.get(it.mediaId) : null;
      const rows = [];
      const add = (k, v) => { rows.push(h('div.k', k), h('div.v', v)); };
      add('Name', it.name || (m && m.name) || (it.type === 'title' ? IM.TitleStyles.get(it.title.style).name : it.type === 'bg' ? (IM.Backgrounds.get(it.bgId) || {}).name : 'Clip'));
      add('Duration', e ? IM.fmtDur(e.dur) + '  (' + e.durF + ' frames)' : '');
      if (m) {
        if (m.kind !== 'image') add('Source Range', IM.fmtTime(it.srcIn, true) + ' – ' + IM.fmtTime(it.srcOut, true));
        if (m.width) add('Resolution', m.width + ' × ' + m.height);
        if (m.fps) add('Frame Rate', m.fps + ' fps');
        add('Size', IM.fmtBytes(m.size || 0));
        add('Imported', IM.fmtDate(m.created));
      }
      if ((it.speed || 1) !== 1) add('Speed', Math.round((it.speed || 1) * 100) + '%' + (it.reverse ? ' (reversed)' : ''));
      const name = h('input.text-field', { type: 'text', value: it.name || (m && m.name) || '', style: { width: '160px' } });
      name.addEventListener('change', () => upd([it.id], 'Rename Clip', (x) => { x.name = name.value.trim() || null; }));
      name.addEventListener('keydown', (ev) => ev.stopPropagation());
      panel.append(grp(lbl('Clip Name:'), name), h('div.info-grid', rows));
    },

    // ------------------------------------------------------------------ background colors (solid / gradient backgrounds)
    bgcolor(cur, panel) {
      const it = cur.item;
      const bg = IM.Backgrounds.get(it.bgId);
      if (!bg || !bg.editable) { panel.classList.add('hidden'); return; }
      const ids = [it.id];
      const c1 = IM.colorWell((it.bg && it.bg.color1) || bg.color1, (v) => { it.bg.color1 = v; app.player.invalidate(); }, (v) => upd(ids, 'Background Color', (x) => { x.bg.color1 = v; }));
      panel.append(grp(h('span.adj-title', bg.editable > 1 ? 'Colors:' : 'Color:'), c1));
      if (bg.editable > 1) {
        const c2 = IM.colorWell((it.bg && it.bg.color2) || bg.color2, (v) => { it.bg.color2 = v; app.player.invalidate(); }, (v) => upd(ids, 'Background Color', (x) => { x.bg.color2 = v; }));
        panel.append(c2);
      }
    },
  };
  IM.inspector = Inspector;
})(window.IM = window.IM || {});
