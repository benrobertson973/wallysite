/* Commands: shared by menus, keyboard shortcuts, buttons and context menus */
(function (IM) {
  'use strict';
  const app = IM.app;
  const Pr = IM.Project;
  const C = {};
  IM.commands = C;
  function def(id, o) { C[id] = o; }
  IM.run = function (id, ...args) {
    const c = C[id];
    if (!c) { console.warn('no command', id); return; }
    if (c.enabled && !c.enabled()) return;
    return c.run(...args);
  };
  IM.can = (id) => { const c = C[id]; return !!c && (!c.enabled || !!c.enabled()); };

  const inEditor = () => app.view === 'editor' && !!app.project;
  const hasSel = () => inEditor() && app.sel.ids.length > 0;
  const hasBSel = () => (app.view === 'editor' || app.view === 'media') && app.bsel.length > 0;
  const playhead = () => app.player.t;
  const selItems = () => IM.selectedItems();
  const primarySel = () => selItems().filter((f) => f.where === 'primary');

  // ------------------------------------------------------------------ app / file / window
  def('about', { run: () => IM.showAbout && IM.showAbout() });
  def('prefs', { run: () => IM.prefsUI && IM.prefsUI.open() });
  def('hide', { run: () => { IM.$('#window').classList.add('minimized'); setTimeout(() => IM.$('#window').classList.remove('minimized'), 1400); } });
  def('quit', { run: () => IM.alert({ title: 'Quit iMovie?', message: 'Your library is saved automatically in this browser. Close the tab to quit.', buttons: [{ label: 'OK', primary: true }] }) });
  def('newMovie', { run: () => IM.newMovie() });
  def('newTrailer', { run: () => IM.trailers.chooser() });
  def('convertTrailer', {
    enabled: () => !!(app.project && app.project.kind === 'trailer' && app.view === 'editor'),
    run: () => { IM.edit('Convert Trailer to Movie', (p) => { IM.trailers.toMovie(p); }); IM.bus.emit('project-opened', app.project); },
  });
  def('newEvent', {
    enabled: () => app.view !== 'projects',
    run: () => {
      const ev = IM.lib.createEvent('New Event');
      app.libSel = ev.id;
      IM.bus.emit('libsel');
      setTimeout(() => IM.sidebarUI && IM.sidebarUI.rename(ev.id), 50);
    },
  });
  def('import', { run: () => IM.importer && IM.importer.open() });
  def('share:email', { enabled: () => !!app.project && app.project.clips.length > 0, run: () => IM.share.open('email') });
  def('share:youtube', { enabled: () => !!app.project && app.project.clips.length > 0, run: () => IM.share.open('youtube') });
  def('share:image', { enabled: () => !!app.project && app.project.clips.length > 0, run: () => IM.share.open('image') });
  def('share:file', { enabled: () => !!app.project && app.project.clips.length > 0, run: () => IM.share.open('file') });
  def('moveToTrash', {
    enabled: () => (app.view === 'projects' && IM.projectsUI && IM.projectsUI.selected) || hasBSel(),
    run: async () => {
      if (app.view === 'projects') { IM.projectsUI.deleteSelected(); return; }
      const ids = Array.from(new Set(app.bsel.map((s) => s.mediaId)));
      const items = ids.map((id) => IM.lib.get(id)).filter((m) => m && !m.builtin);
      if (!items.length) return;
      const used = items.filter((m) => IM.lib.usageCount(m.id) > 0);
      if (used.length) {
        await IM.alert({ title: 'Some clips can’t be deleted', message: 'Clips that are used in a project can’t be moved to the Trash. Remove them from your projects first.' });
        return;
      }
      const r = await IM.alert({ title: `Move ${items.length === 1 ? '“' + items[0].name + '”' : items.length + ' clips'} to the Trash?`, message: 'The media will be deleted from your iMovie library.', buttons: [{ label: 'Cancel', cancel: true }, { label: 'Move to Trash', primary: true }] });
      if (r !== 1) return;
      for (const m of items) { app.player.vpool.forgetMedia(m.id); await IM.lib.deleteMedia(m.id, true); }
      IM.setBrowserSelection([]);
      IM.lib.emit('changed');
    },
  });
  def('minimize', { run: () => C.hide.run() });
  def('zoomWindow', { run: () => IM.run('enterFullScreen') });
  def('goProjects', { enabled: () => app.view !== 'projects', run: () => { if (app.view === 'editor') IM.closeProject(); else IM.setView('projects'); } });
  def('goMedia', { enabled: () => app.view !== 'media', run: () => { if (app.view === 'editor') IM.closeProject(); app.libSel = app.libSel && app.libSel !== 'project' ? app.libSel : (IM.lib.events[0] && IM.lib.events[0].id); IM.setView('media'); } });
  def('enterFullScreen', {
    label: () => (document.fullscreenElement ? 'Exit Full Screen' : 'Enter Full Screen'),
    run: () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    },
  });
  def('toggleLibraries', {
    label: () => (IM.prefs.showLibraries ? 'Hide Libraries' : 'Show Libraries'),
    enabled: () => app.view !== 'projects',
    run: () => { IM.prefs.showLibraries = !IM.prefs.showLibraries; IM.savePrefs(); IM.bus.emit('layout'); },
  });
  ['media', 'audio', 'titles', 'backgrounds', 'transitions'].forEach((tab) => {
    def('tab:' + tab, { enabled: inEditor, checked: () => app.tab === tab, run: () => { app.tab = tab; IM.bus.emit('tab', tab); } });
  });
  def('help', { run: () => IM.showHelp && IM.showHelp() });
  def('shortcuts', { run: () => IM.showShortcuts && IM.showShortcuts() });

  // ------------------------------------------------------------------ edit
  def('undo', { enabled: () => inEditor() && !!IM.undoLabel(), label: () => (IM.undoLabel() ? 'Undo ' + IM.undoLabel() : 'Undo'), run: () => IM.undo() });
  def('redo', { enabled: () => inEditor() && !!IM.redoLabel(), label: () => (IM.redoLabel() ? 'Redo ' + IM.redoLabel() : 'Redo'), run: () => IM.redo() });
  def('copy', {
    enabled: () => hasSel() || hasBSel(),
    run: () => {
      if (app.focus === 'browser' && app.bsel.length) { app.clipboard = { kind: 'browser', items: app.bsel.map((s) => Object.assign({}, s)) }; return; }
      const p = app.project; const L = Pr.layout(p);
      const items = selItems();
      if (!items.length) return;
      const minStart = Math.min(...items.map((f) => L.byId.get(f.item.id).start));
      app.clipboard = {
        kind: 'timeline',
        items: items.map((f) => ({ where: f.where, item: IM.clone(f.item), rel: L.byId.get(f.item.id).start - minStart, lane: L.byId.get(f.item.id).lane })),
      };
    },
  });
  def('cut', { enabled: hasSel, run: () => { C.copy.run(); IM.edit('Cut', (p) => Pr.deleteItems(p, app.sel.ids)); IM.clearSelection(); } });
  def('paste', {
    enabled: () => inEditor() && !!app.clipboard,
    run: () => {
      const cb = app.clipboard;
      if (cb.kind === 'browser') { insertBrowserItems(cb.items, 'insert'); return; }
      const t = playhead();
      IM.edit('Paste', (p) => {
        const prim = cb.items.filter((x) => x.where === 'primary').map((x) => Object.assign(IM.clone(x.item), { id: IM.uid('c') }));
        const conn = cb.items.filter((x) => x.where === 'connected');
        const mus = cb.items.filter((x) => x.where === 'music');
        if (prim.length) Pr.insertAt(p, t, prim);
        if (conn.length && p.clips.length) {
          for (const x of conn) {
            const it = Object.assign(IM.clone(x.item), { id: IM.uid('c') });
            Pr.connect(p, [it], t + x.rel, x.item.lane);
          }
        }
        if (mus.length) Pr.addMusic(p, mus.map((x) => Object.assign(IM.clone(x.item), { id: IM.uid('c') })));
      });
    },
  });
  def('delete', {
    enabled: () => (inEditor() && (app.sel.ids.length > 0 || !!app.sel.transition)) || hasBSel(),
    run: () => {
      if (app.focus === 'browser' && app.bsel.length && !app.sel.ids.length && !app.sel.transition) { C.reject.run(); return; }
      if (app.sel.transition) {
        const id = app.sel.transition;
        IM.edit('Delete Transition', (p) => Pr.removeTransition(p, id));
        IM.clearSelection();
        return;
      }
      if (IM.timelineUI && IM.timelineUI.range) { IM.timelineUI.deleteRange(); return; }
      const ids = app.sel.ids.slice();
      IM.edit('Delete', (p) => Pr.deleteItems(p, ids));
      IM.clearSelection();
      app.player.seek(Math.min(app.player.t, Pr.duration(app.project)));
    },
  });
  def('selectAll', {
    enabled: () => app.view !== 'projects',
    run: () => {
      if (app.focus === 'browser' && IM.browserUI) { IM.browserUI.selectAll(); return; }
      const p = app.project; if (!p) return;
      const ids = [];
      Pr.forEachItem(p, (it) => ids.push(it.id));
      IM.select(ids);
    },
  });
  def('deselectAll', { run: () => { IM.clearSelection(); IM.setBrowserSelection([]); } });
  function pasteAdj(kind) {
    return {
      enabled: () => hasSel() && app.clipboard && app.clipboard.kind === 'timeline' && app.clipboard.items.length > 0,
      run: () => {
        const src = app.clipboard.items[0].item;
        IM.edit('Paste Adjustments', () => {
          for (const f of selItems()) {
            const it = f.item;
            if (it.id === src.id) continue;
            const all = kind === 'all';
            if ((all || kind === 'color') && it.video && src.video) { it.video.color = IM.clone(src.video.color); it.video.balance = IM.clone(src.video.balance); }
            if ((all || kind === 'crop') && it.video && src.video && it.type !== 'title') { it.video.crop = IM.clone(src.video.crop); it.video.rotate = src.video.rotate; }
            if ((all || kind === 'filter') && it.video && src.video) it.video.filter = src.video.filter;
            if ((all || kind === 'stabilization') && it.video && src.video) { it.video.stabilize = src.video.stabilize; it.video.rollingShutter = src.video.rollingShutter; }
            if ((all || kind === 'volume') && it.audio && src.audio) { it.audio.volume = src.audio.volume; it.audio.mute = src.audio.mute; it.audio.duck = src.audio.duck; it.audio.duckAmount = src.audio.duckAmount; }
            if ((all || kind === 'audioEffect') && it.audio && src.audio) { it.audio.effect = src.audio.effect; it.audio.eq = src.audio.eq; it.audio.nr = src.audio.nr; }
            if ((all || kind === 'speed') && (it.type === 'video' || it.type === 'audio') && (src.type === 'video' || src.type === 'audio')) { it.speed = src.speed; it.reverse = src.reverse; it.preservePitch = src.preservePitch; }
            if ((all || kind === 'overlay') && f.where === 'connected' && src.overlay) it.overlay = IM.clone(src.overlay);
            if ((all || kind === 'titles') && it.type === 'title' && src.type === 'title') { const txt = it.title.text; it.title = IM.clone(src.title); it.title.text = txt; }
          }
        });
      },
    };
  }
  ['all', 'filter', 'audioEffect', 'volume', 'speed', 'crop', 'color', 'stabilization', 'overlay', 'titles'].forEach((k) => def('pasteAdj:' + k, pasteAdj(k)));
  def('addCrossDissolve', {
    enabled: () => inEditor() && app.project.clips.length > 1,
    run: () => {
      const p = app.project;
      const sel = new Set(primarySel().map((f) => f.item.id));
      IM.edit('Add Cross Dissolve', () => {
        const d = IM.prefs.transitionDuration || 1;
        if (sel.size) {
          p.clips.forEach((c, i) => {
            if (i >= p.clips.length - 1) return;
            const next = p.clips[i + 1];
            if (sel.has(c.id) || sel.has(next.id)) c.transition = { type: 'cross-dissolve', dur: d };
          });
        } else {
          // nearest edit point to the playhead
          const L = Pr.layout(p);
          let best = null, bd = 1e9;
          for (let i = 0; i < L.clips.length - 1; i++) {
            const d0 = Math.abs(L.clips[i].visEnd - playhead());
            if (d0 < bd) { bd = d0; best = L.clips[i].item; }
          }
          if (best) best.transition = { type: 'cross-dissolve', dur: d };
        }
      });
    },
  });

  // ------------------------------------------------------------------ mark
  function markRanges(kind) {
    const list = app.focus === 'browser' && app.bsel.length ? app.bsel : selItems().filter((f) => f.item.mediaId && (f.item.type === 'video' || f.item.type === 'audio')).map((f) => ({ mediaId: f.item.mediaId, a: f.item.srcIn, b: f.item.srcOut }));
    for (const s of list) {
      const m = IM.lib.get(s.mediaId);
      if (!m) continue;
      const a = s.a == null ? 0 : s.a, b = s.b == null ? (m.duration || 1e9) : s.b;
      IM.lib.markRange(m, a, m.kind === 'image' ? 1e9 : b, kind);
    }
    IM.bus.emit('marks');
  }
  def('favorite', { enabled: () => hasBSel() || hasSel(), run: () => markRanges('favorite') });
  def('unmark', { enabled: () => hasBSel() || hasSel(), run: () => markRanges('unmark') });
  def('reject', {
    enabled: hasBSel,
    run: () => { markRanges('reject'); if (IM.prefs.browserFilter === 'hide-rejected' || IM.prefs.browserFilter === 'favorites') IM.setBrowserSelection([]); },
  });
  def('selectClipRange', {
    enabled: () => app.view !== 'projects',
    run: () => {
      if (app.focus === 'browser' && IM.browserUI) { IM.browserUI.selectEntireClip(); return; }
      const e = app.project && Pr.primaryAt(app.project, app.player.skimT != null ? app.player.skimT : playhead());
      if (e) IM.select([e.item.id]);
    },
  });
  def('clearRanges', { run: () => { IM.setBrowserSelection([]); if (IM.timelineUI) IM.timelineUI.clearRange(); } });

  // ------------------------------------------------------------------ modify
  def('enhance', {
    enabled: () => hasSel(),
    run: () => IM.edit('Enhance', () => { for (const f of selItems()) IM.autoEnhance(f.item, f.where); }),
  });
  function splitTargets() {
    const t = playhead();
    const p = app.project;
    const L = Pr.layout(p);
    let targets = selItems().filter((f) => { const e = L.byId.get(f.item.id); return e && t > e.start + 0.05 && t < e.end - 0.05; });
    // nothing selected under the playhead: split the movie's clip where the playhead is
    if (!targets.length) {
      const e = Pr.primaryAt(p, t);
      if (e && t > e.visStart + 0.05 && t < e.visEnd - 0.05) targets = [{ item: e.item, where: 'primary' }];
    }
    return targets;
  }
  def('split', {
    enabled: () => inEditor() && splitTargets().length > 0,
    run: () => {
      const t = playhead();
      const targets = splitTargets();
      let lastB = null;
      IM.edit('Split Clip', (p) => {
        const L = Pr.layout(p);
        for (const f of targets) {
          const e = L.byId.get(f.item.id);
          if (!e) continue;
          if (f.where === 'primary') {
            Pr.splitPrimaryAt(p, t);
            const idx = p.clips.findIndex((c) => c.id === f.item.id);
            lastB = p.clips[idx + 1] ? p.clips[idx + 1].id : null;
          } else {
            const pair = Pr.splitItem(f.item, t - e.start);
            if (!pair) continue;
            const [A, B] = pair;
            if (f.where === 'connected') {
              const i = p.connected.findIndex((c) => c.id === f.item.id);
              B.offset = f.item.offset + (t - e.start);
              p.connected.splice(i, 1, A, B);
              lastB = B.id;
            } else {
              const i = p.music.findIndex((c) => c.id === f.item.id);
              p.music.splice(i, 1, A, B);
              lastB = B.id;
            }
          }
          Pr.invalidate(p);
        }
      });
      if (lastB) IM.select([lastB]);
    },
  });
  def('join', {
    enabled: () => hasSel(),
    run: () => IM.edit('Join Clip', (p) => (Pr.joinClips(p, app.sel.ids) ? undefined : false)),
  });
  def('detachAudio', {
    enabled: () => hasSel() && selItems().some((f) => f.item.type === 'video' && !f.item.audio.detached && Pr.hasAudio(f.item)),
    run: () => {
      let made = [];
      IM.edit('Detach Audio', (p) => { for (const f of selItems()) { const a = Pr.detachAudio(p, f.item.id); if (a) made.push(a.id); } });
      if (made.length) IM.select(made);
    },
  });
  def('freezeFrame', {
    enabled: () => { if (!inEditor()) return false; const e = Pr.primaryAt(app.project, playhead()); return !!e && e.item.type === 'video'; },
    run: () => {
      let fz = null;
      IM.edit('Add Freeze Frame', (p) => { fz = Pr.addFreezeFrame(p, playhead()); return fz ? undefined : false; });
      if (fz) IM.select([fz.id]);
    },
  });
  def('trimToPlayhead', {
    enabled: () => inEditor(),
    run: () => {
      const t = playhead();
      const p = app.project;
      const L = Pr.layout(p);
      let targets = selItems();
      if (!targets.length) { const e = Pr.primaryAt(p, t); if (e) targets = [{ item: e.item, where: 'primary' }]; }
      IM.edit('Trim to Playhead', () => {
        for (const f of targets) {
          const e = Pr.layout(p).byId.get(f.item.id);
          if (!e || t <= e.start + 0.05 || t >= e.end - 0.05) continue;
          if (t - e.start < e.end - t) Pr.trim(p, f.item.id, 'start', t - e.start);
          else Pr.trim(p, f.item.id, 'end', t - e.end);
        }
      });
      app.player.seek(Math.min(app.player.t, Pr.duration(p)));
    },
  });
  function speedCmd(v, label) {
    return {
      enabled: () => hasSel() && selItems().some((f) => f.item.type === 'video' || f.item.type === 'audio'),
      run: () => IM.edit(label, (p) => { for (const f of selItems()) if (f.item.type === 'video' || f.item.type === 'audio') Pr.setSpeed(p, f.item.id, v); }),
    };
  }
  [0.5, 0.25, 0.1].forEach((v) => def('slow:' + v, speedCmd(v, 'Slow Down')));
  [2, 4, 8, 20].forEach((v) => def('fast:' + v, speedCmd(v, 'Speed Up')));
  def('resetSpeed', speedCmd(1, 'Reset Speed'));
  def('reverse', {
    enabled: () => hasSel() && selItems().some((f) => f.item.type === 'video'),
    checked: () => selItems().some((f) => f.item.reverse),
    run: () => IM.edit('Reverse', () => { const on = !selItems().some((f) => f.item.reverse); for (const f of selItems()) if (f.item.type === 'video' || f.item.type === 'audio') f.item.reverse = on; }),
  });
  [0.5, 0.25, 0.1].forEach((v) => def('replay:' + v, {
    enabled: () => primarySel().some((f) => f.item.type === 'video'),
    run: () => IM.edit('Instant Replay', (p) => { const f = primarySel().find((x) => x.item.type === 'video'); Pr.instantReplay(p, f.item.id, v); }),
  }));
  [1, 2, 4].forEach((v) => def('rewind:' + v, {
    enabled: () => primarySel().some((f) => f.item.type === 'video'),
    run: () => IM.edit('Rewind', (p) => { const f = primarySel().find((x) => x.item.type === 'video'); Pr.rewind(p, f.item.id, v); }),
  }));

  // ------------------------------------------------------------------ add from browser
  function mediaItemsFromSelection(list) {
    const out = [];
    for (const s of list) {
      const m = IM.lib.get(s.mediaId);
      if (!m) continue;
      const a = s.a == null ? 0 : s.a, b = s.b == null ? m.duration : s.b;
      out.push(Pr.itemFromMedia(m, a, b, IM.prefs));
    }
    return out;
  }
  IM.mediaItemsFromSelection = mediaItemsFromSelection;
  function insertBrowserItems(list, mode) {
    const items = mediaItemsFromSelection(list);
    if (!items.length) return;
    const audio = items.filter((it) => it.type === 'audio');
    const vis = items.filter((it) => it.type !== 'audio');
    const t = playhead();
    let added = [];
    IM.edit(mode === 'append' ? 'Add to Movie' : mode === 'connect' ? 'Connect' : 'Insert', (p) => {
      if (vis.length) {
        if (mode === 'append') Pr.append(p, vis);
        else if (mode === 'connect' && p.clips.length) Pr.connect(p, vis, t, 1);
        else if (mode === 'connect') Pr.append(p, vis);
        else Pr.insertAt(p, t, vis);
        added = added.concat(vis.map((x) => x.id));
      }
      if (audio.length) {
        if (mode === 'append' || !p.clips.length) Pr.addMusic(p, audio);
        else Pr.connect(p, audio, t, -1);
        added = added.concat(audio.map((x) => x.id));
      }
    });
    if (mode === 'append' && vis.length) {
      const L = Pr.layout(app.project);
      const e = L.byId.get(vis[0].id);
      if (e) app.player.seek(e.start);
    }
    IM.bus.emit('added', added);
  }
  IM.insertBrowserItems = insertBrowserItems;
  def('append', { enabled: () => inEditor() && app.bsel.length > 0, run: () => insertBrowserItems(app.bsel, 'append') });
  def('connect', { enabled: () => inEditor() && app.bsel.length > 0, run: () => insertBrowserItems(app.bsel, 'connect') });
  def('insert', { enabled: () => inEditor() && app.bsel.length > 0, run: () => insertBrowserItems(app.bsel, 'insert') });

  // ------------------------------------------------------------------ playback
  const P = () => app.player;
  def('play', {
    enabled: () => app.view !== 'projects',
    label: () => (P().isPlaying() ? 'Pause' : 'Play'),
    run: () => {
      const pl = P();
      if (pl.isPlaying()) { pl.pause(); return; }
      if (app.focus === 'browser' && IM.browserUI && IM.browserUI.playFocused()) return;
      if (app.view === 'editor') pl.play({ fromSkimmer: IM.timelineUI && IM.timelineUI.hovering });
    },
  });
  def('playSelection', {
    enabled: () => app.view !== 'projects',
    run: () => {
      const pl = P();
      if (app.focus === 'browser' && app.bsel.length) { const s = app.bsel[0]; pl.playSource(IM.lib.get(s.mediaId), s.a, s.b); return; }
      if (!app.project) return;
      const L = Pr.layout(app.project);
      const es = app.sel.ids.map((id) => L.byId.get(id)).filter(Boolean);
      if (IM.timelineUI && IM.timelineUI.range) { const r = IM.timelineUI.range; pl.play({ range: [r.t0, r.t1] }); return; }
      if (!es.length) { pl.play(); return; }
      pl.play({ range: [Math.min(...es.map((e) => e.start)), Math.min(L.duration, Math.max(...es.map((e) => e.end)))] });
    },
  });
  def('playFromBeginning', { enabled: inEditor, run: () => P().play({ from: 0 }) });
  def('playFullScreen', { enabled: () => app.view !== 'projects', run: () => IM.viewerUI && IM.viewerUI.fullscreen(true) });
  def('loop', { checked: () => IM.prefs.loop, run: () => { IM.prefs.loop = !IM.prefs.loop; P().loop = IM.prefs.loop; IM.savePrefs(); } });
  def('shuttleJ', { enabled: inEditor, run: () => P().shuttle(-1) });
  def('shuttleK', { enabled: inEditor, run: () => P().shuttle(0) });
  def('shuttleL', { enabled: inEditor, run: () => P().shuttle(1) });
  def('prevFrame', { enabled: inEditor, run: () => P().step(-1) });
  def('nextFrame', { enabled: inEditor, run: () => P().step(1) });
  def('prevFrames', { enabled: inEditor, run: () => P().step(-10) });
  def('nextFrames', { enabled: inEditor, run: () => P().step(10) });
  function editPoints() {
    const pts = new Set([0]);
    const L = Pr.layout(app.project);
    for (const e of L.clips) { pts.add(+e.visStart.toFixed(4)); pts.add(+e.visEnd.toFixed(4)); }
    return Array.from(pts).sort((a, b) => a - b);
  }
  def('prevEdit', { enabled: inEditor, run: () => { P().pause(); const t = P().t; const pts = editPoints().filter((x) => x < t - 1e-3); P().seek(pts.length ? pts[pts.length - 1] : 0); } });
  def('nextEdit', { enabled: inEditor, run: () => { P().pause(); const t = P().t; const pts = editPoints().filter((x) => x > t + 1e-3); P().seek(pts.length ? pts[0] : Pr.duration(app.project)); } });
  def('goStart', { enabled: inEditor, run: () => { P().pause(); P().seek(0); } });
  def('goEnd', { enabled: inEditor, run: () => { P().pause(); P().seek(Pr.duration(app.project)); } });
  def('escape', {
    run: () => {
      if (IM.viewerUI && IM.viewerUI.isFullscreen()) { IM.viewerUI.fullscreen(false); return; }
      if (IM.viewerUI && IM.viewerUI.tool === 'crop') { IM.viewerUI.closeTool(); return; }
      if (P().isPlaying()) { P().pause(); return; }
      if (IM.timelineUI && IM.timelineUI.range) { IM.timelineUI.clearRange(); return; }
    },
  });

  // ------------------------------------------------------------------ view
  def('snapping', { checked: () => IM.prefs.snapping, run: () => { IM.prefs.snapping = !IM.prefs.snapping; IM.savePrefs(); IM.bus.emit('prefs'); } });
  def('skimming', { checked: () => IM.prefs.skimming, run: () => { IM.prefs.skimming = !IM.prefs.skimming; P().skimming = IM.prefs.skimming; if (!IM.prefs.skimming) P().setSkim(null); IM.savePrefs(); IM.bus.emit('prefs'); } });
  def('audioSkimming', { checked: () => IM.prefs.audioSkimming, run: () => { IM.prefs.audioSkimming = !IM.prefs.audioSkimming; P().audioSkimming = IM.prefs.audioSkimming; IM.savePrefs(); IM.bus.emit('prefs'); } });
  def('zoomIn', { enabled: () => app.view !== 'projects', run: () => (app.focus === 'browser' && IM.browserUI ? IM.browserUI.zoom(1) : IM.timelineUI && IM.timelineUI.zoomBy(1.5)) });
  def('zoomOut', { enabled: () => app.view !== 'projects', run: () => (app.focus === 'browser' && IM.browserUI ? IM.browserUI.zoom(-1) : IM.timelineUI && IM.timelineUI.zoomBy(1 / 1.5)) });
  def('zoomFit', { enabled: inEditor, run: () => IM.timelineUI && IM.timelineUI.zoomToFit() });
  // the whole interface: + and − make everything bigger or smaller (see IM.uiZoom)
  def('uiZoomIn', { run: () => IM.uiZoom('in') });
  def('uiZoomOut', { run: () => IM.uiZoom('out') });
  def('uiZoomReset', { run: () => IM.uiZoom('reset') });
  def('meters', { checked: () => IM.prefs.meters, label: () => (IM.prefs.meters ? 'Hide Audio Meters' : 'Show Audio Meters'), run: () => { IM.prefs.meters = !IM.prefs.meters; IM.savePrefs(); IM.bus.emit('meters'); } });
  def('clipTrimmer', {
    enabled: () => inEditor() && (IM.clipTrimmer && (IM.clipTrimmer.isOpen() || selItems().some((f) => f.item.type === 'video' || f.item.type === 'audio'))),
    label: () => (IM.clipTrimmer && IM.clipTrimmer.isOpen() ? 'Hide Clip Trimmer' : 'Show Clip Trimmer'),
    run: () => IM.clipTrimmer.toggle(),
  });
  def('precisionEditor', {
    enabled: () => inEditor() && app.project.clips.length > 1,
    label: () => (IM.precisionEditor && IM.precisionEditor.isOpen() ? 'Hide Precision Editor' : 'Show Precision Editor'),
    run: () => IM.precisionEditor && IM.precisionEditor.toggle(),
  });
  def('voiceover', { enabled: inEditor, run: () => IM.voiceover && IM.voiceover.toggle() });

  // ------------------------------------------------------------------ enhance helper
  /** Auto color balance + auto levels + enable audio enhancement for an item. */
  IM.autoEnhance = function (it) {
    if (it.video && (it.type === 'video' || it.type === 'image' || it.type === 'freeze')) {
      const m = IM.lib.get(it.mediaId);
      const stats = m ? frameStats(m, it.type === 'freeze' ? it.frameTime : (it.srcIn + it.srcOut) / 2) : null;
      if (stats) {
        const avg = (stats.r + stats.g + stats.b) / 3;
        it.video.balance = { mode: 'auto', gains: [IM.clamp(avg / stats.r, 0.75, 1.35), IM.clamp(avg / stats.g, 0.75, 1.35), IM.clamp(avg / stats.b, 0.75, 1.35)] };
        const c = it.video.color;
        c.shadows = IM.clamp((0.06 - stats.lo) * 3, -0.4, 0.4);
        c.highlights = IM.clamp((0.94 - stats.hi) * 3, -0.4, 0.6);
        c.sat = Math.max(c.sat || 1, 1.12);
      }
      it.video.enhance = true;
    }
    if (it.audio && (it.type === 'video' || it.type === 'audio')) {
      it.audio.enhance = true;
      if (!it.audio.nr) it.audio.nr = 0.25;
    }
  };
  function frameStats(m, t) {
    const th = IM.lib.thumbAt(m, t);
    if (!th) return null;
    const c = document.createElement('canvas');
    c.width = 48; c.height = 27;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(th.img, th.sx, th.sy, th.sw, th.sh, 0, 0, 48, 27);
    const d = ctx.getImageData(0, 0, 48, 27).data;
    let r = 0, g = 0, b = 0, n = 0;
    const ls = [];
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      ls.push((d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255);
    }
    ls.sort((a, z) => a - z);
    return { r: r / n / 255 + 1e-3, g: g / n / 255 + 1e-3, b: b / n / 255 + 1e-3, lo: ls[Math.floor(ls.length * 0.02)], hi: ls[Math.floor(ls.length * 0.98)] };
  }
  IM.frameStats = frameStats;

  // ------------------------------------------------------------------ incandescent light
  // Light bulbs are much warmer than daylight, so footage shot under them comes out orange. The fix measures how
  // warm the light in a clip was and takes that warmth out along the warm–cool line of light colours only (never
  // adding green or magenta), as colour-balance gains, so the viewer and every export show the same result.
  const XYZ_TO_RGB = [[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]];
  /** Linear sRGB colour of light at temperature T (kelvin, on the black-body line), scaled to green = 1. */
  function lightColor(T) {
    T = IM.clamp(T, 1667, 25000);
    const x = T <= 4000 ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.179910
      : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.240390;
    const y = T <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
      : T <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
    const X = x / y, Z = (1 - x - y) / y;
    const rgb = XYZ_TO_RGB.map((r) => r[0] * X + r[1] + r[2] * Z);
    return rgb.map((v) => Math.max(1e-4, v) / rgb[1]);
  }
  const DAYLIGHT = 6500;
  /**
   * The colour temperature of the light a clip was shot in (kelvin), from frames across it: the average colour of
   * its well-exposed pixels, placed on the warm–cool line. Null without pictures to measure.
   */
  function lightTemperature(m, it) {
    const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const times = [];
    if (m.kind === 'image') times.push(0);
    else if (it.type === 'freeze') times.push(it.frameTime || 0);
    else for (let i = 0; i < 7; i++) times.push(it.srcIn + (it.srcOut - it.srcIn) * (i + 0.5) / 7);
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const px = [];  // linear r, g, b, weight
    for (const t of times) {
      const th = IM.lib.thumbAt(m, t);
      if (!th) continue;
      ctx.drawImage(th.img, th.sx, th.sy, th.sw, th.sh, 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        // skip the murky and the blown-out (a clipped highlight turns white whatever the light)
        if (Math.max(r, g, b) > 0.97 || 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.06) continue;
        const lr = lin(r), lg = lin(g), lb = lin(b);
        px.push(lr, lg, lb, 0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
      }
    }
    if (!px.length) return null;
    // the temperature whose light has the blue-to-red balance of the chosen pixels
    const qOf = (T) => { const k = lightColor(T); return Math.log(k[2] / k[0]); };
    const fit = (keep) => {
      let R = 0, B = 0, W = 0;
      for (let i = 0; i < px.length; i += 4) if (keep(i)) { R += px[i] * px[i + 3]; B += px[i + 2] * px[i + 3]; W += px[i + 3]; }
      if (W <= 0) return null;
      const q = Math.log((B + 1e-6) / (R + 1e-6));
      let lo = 1667, hi = 12000;
      if (q <= qOf(lo)) return { T: lo, W };
      if (q >= qOf(hi)) return { T: hi, W };
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (qOf(mid) < q) lo = mid; else hi = mid; }
      return { T: (lo + hi) / 2, W };
    };
    // first guess: everything averages out to gray. Then again from just the grayest quarter of the picture under
    // that light (walls, white or gray things), where the light's own colour shows: coloured things (skin, grass,
    // sky) would otherwise pull the guess
    const all = fit(() => true);
    if (!all) return null;
    let T = all.T;
    const n = px.length / 4, order = new Array(n), dist = new Float64Array(n);
    for (let round = 0; round < 5; round++) {
      const k = lightColor(T);
      for (let j = 0; j < n; j++) {
        const i = j * 4;
        const lr = Math.log((px[i] / k[0] + 1e-6) / (px[i + 1] + 1e-6)), lb = Math.log((px[i + 2] / k[2] + 1e-6) / (px[i + 1] + 1e-6));
        dist[j] = lr * lr + lb * lb;
        order[j] = j;
      }
      order.sort((a, b) => dist[a] - dist[b]);
      const keep = new Uint8Array(n);
      let w = 0;
      for (const j of order) { keep[j] = 1; w += px[j * 4 + 3]; if (w >= all.W * 0.25) break; }
      const next = fit((i) => keep[i / 4] === 1);
      if (!next) break;
      const done = Math.abs(next.T - T) < 10;
      T = next.T;
      if (done) break;
    }
    return Math.round(T);
  }
  /**
   * Colour-balance gains (applied to the picture as encoded) that take light of temperature T towards daylight.
   * amount 0–1: how much of the warmth to take out. Light that isn't warmer than daylight is left alone.
   */
  function warmLightGains(T, amount) {
    // a clip measuring near daylight isn't bulb-lit (its contents are just warm): leave it, easing in below 5500 K
    if (!T || T >= 5500) return [1, 1, 1];
    const ease = IM.clamp((5500 - T) / 1000, 0, 1);
    const from = 1e6 / T, day = 1e6 / DAYLIGHT;       // in mired, where equal steps look equally warmer
    const target = 1e6 / (from + IM.clamp(amount, 0, 1) * ease * (day - from));
    const src = lightColor(T), dst = lightColor(target);
    let g = [dst[0] / src[0], 1, dst[2] / src[2]];
    // things lit by the bulb keep their brightness
    const Y = (k) => 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
    const keep = Y(src) / Y(src.map((v, i) => v * g[i]));
    g = g.map((v) => v * keep);
    return g.map((v) => IM.clamp(Math.pow(v, 1 / 2.2), 0.4, 2.5));
  }
  IM.lightTemperature = lightTemperature;
  IM.warmLightGains = warmLightGains;
})(window.IM = window.IM || {});
