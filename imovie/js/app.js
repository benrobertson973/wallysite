/* Application state, selection, undo/redo and view management */
(function (IM) {
  'use strict';

  const PREF_KEY = 'imovie.prefs';
  const defaults = {
    timecodeFrames: false, photoPlacement: 'kenburns', photoDuration: 4, transitionDuration: 1, freezeDuration: 3,
    titleDuration: 4, showLibraries: true, browserClipSize: 1, browserZoom: 0, browserWaveforms: false,
    snapping: true, skimming: true, audioSkimming: false, loop: false, meters: false, splitRatio: 0.5, browserFilter: 'all',
    upperHeight: null, viewerWidth: null, sidebarWidth: 206,
  };
  try { IM.prefs = Object.assign({}, defaults, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { IM.prefs = Object.assign({}, defaults); }
  IM.savePrefs = IM.debounce(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(IM.prefs)); } catch (e) { /* ignore */ } }, 200);

  const app = {
    view: 'projects',
    project: null,
    tab: 'media',
    libSel: null,       // 'project' | 'photos' | event id | 'audio:*'
    focus: 'timeline',  // which pane has keyboard focus: 'timeline' | 'browser'
    sel: { ids: [], transition: null },
    bsel: [],           // browser selection: [{mediaId, a, b}]
    clipboard: null,
    player: null,
    hist: new Map(),    // projectId -> {undo:[], redo:[]}
  };
  IM.app = app;

  // ---------- views ----------
  IM.setView = function (view, opts) {
    opts = opts || {};
    if (view === 'editor' && !app.project) return;
    if (app.player) app.player.pause();
    app.view = view;
    IM.closePopovers();
    IM.bus.emit('view', view, opts);
  };
  IM.openProject = function (p) {
    IM.lib.projects.set(p.id, p);
    app.project = p;
    app.sel = { ids: [], transition: null };
    app.bsel = [];
    app.libSel = 'project';
    app.tab = 'media';
    if (!app.hist.has(p.id)) app.hist.set(p.id, { undo: [], redo: [] });
    if (!p.eventId || !IM.lib.eventById(p.eventId)) {
      const ev = IM.lib.createEvent(p.name, true);
      p.eventId = ev.id;
      IM.lib.saveProject(p);
    }
    app.player.setProject(p);
    IM.setView('editor');
    IM.bus.emit('project-opened', p);
  };
  IM.closeProject = function () {
    const p = app.project;
    if (p) { IM.updatePoster(p); IM.lib.saveProjectNow(p); }
    app.player.pause();
    IM.setView('projects');
  };
  IM.newMovie = async function () {
    const name = IM.lib.uniqueProjectName('My Movie');
    const ev = IM.lib.createEvent(name, true);
    const p = IM.Project.create(name, ev.id);
    IM.lib.addProject(p);
    IM.openProject(p);
    return p;
  };

  // ---------- selection ----------
  IM.select = function (ids, opts) {
    opts = opts || {};
    const prev = app.sel;
    if (opts.toggle) {
      const set = new Set(prev.ids);
      ids.forEach((id) => (set.has(id) ? set.delete(id) : set.add(id)));
      app.sel = { ids: Array.from(set), transition: null };
    } else if (opts.add) {
      app.sel = { ids: Array.from(new Set(prev.ids.concat(ids))), transition: null };
    } else app.sel = { ids: ids.slice(), transition: null };
    if (app.sel.ids.length) { app.focus = 'timeline'; app.bsel = []; IM.bus.emit('bselection'); }
    IM.bus.emit('selection', app.sel);
  };
  IM.selectTransition = function (clipId) {
    app.sel = { ids: [], transition: clipId };
    app.focus = 'timeline';
    IM.bus.emit('selection', app.sel);
  };
  IM.clearSelection = function () {
    if (!app.sel.ids.length && !app.sel.transition) return;
    app.sel = { ids: [], transition: null };
    IM.bus.emit('selection', app.sel);
  };
  IM.selectedItems = function () {
    const p = app.project;
    if (!p) return [];
    const out = [];
    for (const id of app.sel.ids) { const f = IM.Project.findItem(p, id); if (f) out.push(f); }
    return out;
  };
  /** The single "current" item for adjustments: selection, else the clip under the playhead. */
  IM.currentItem = function () {
    const s = IM.selectedItems();
    if (s.length) return s[0];
    return null;
  };
  IM.setBrowserSelection = function (list, opts) {
    app.bsel = list;
    if (list.length) {
      app.focus = 'browser';
      if (!(opts && opts.keepTimeline)) { app.sel = { ids: [], transition: null }; IM.bus.emit('selection', app.sel); }
    }
    IM.bus.emit('bselection', list);
  };

  // ---------- undo / redo ----------
  function snap(p) {
    return JSON.stringify({ clips: p.clips, connected: p.connected, music: p.music, settings: p.settings, name: p.name });
  }
  function restore(p, s) {
    const o = JSON.parse(s);
    p.clips = o.clips; p.connected = o.connected; p.music = o.music; p.settings = o.settings; p.name = o.name;
    IM.Project.upgrade(p);
    IM.Project.invalidate(p);
  }
  function hist() {
    const p = app.project;
    if (!p) return null;
    let h = app.hist.get(p.id);
    if (!h) { h = { undo: [], redo: [] }; app.hist.set(p.id, h); }
    return h;
  }
  /**
   * Perform an undoable edit on the current project.
   * fn(p) may return false to cancel. opts.coalesce: key to merge rapid repeated edits (e.g. slider drags).
   */
  IM.edit = function (label, fn, opts) {
    opts = opts || {};
    const p = app.project;
    if (!p) return;
    const before = snap(p);
    let r;
    try { r = fn(p); } catch (e) { console.error(e); restore(p, before); IM.bus.emit('project-changed', p); return; }
    if (r === false) { restore(p, before); return r; }
    IM.Project.invalidate(p);
    const after = snap(p);
    if (after === before) return r;
    const h = hist();
    const now = performance.now();
    const last = h.undo[h.undo.length - 1];
    if (opts.coalesce && last && last.coalesce === opts.coalesce && now - last.time < 1500) {
      last.time = now;
    } else {
      h.undo.push({ label, state: before, coalesce: opts.coalesce, time: now, sel: app.sel.ids.slice() });
      if (h.undo.length > 150) h.undo.shift();
    }
    h.redo = [];
    IM.lib.saveProject(p);
    validateSelection();
    IM.bus.emit('project-changed', p, label);
    app.player.invalidate();
    return r;
  };
  /** Begin a live (non-committed) change; call commit() once when finished (e.g. drag end). */
  IM.beginLive = function (label) {
    const p = app.project;
    if (!p) return null;
    const before = snap(p);
    return {
      update(fn) { fn(p); IM.Project.invalidate(p); IM.bus.emit('project-live', p); app.player.invalidate(); },
      commit() {
        IM.Project.invalidate(p);
        if (snap(p) === before) return;
        const h = hist();
        h.undo.push({ label, state: before, time: performance.now(), sel: app.sel.ids.slice() });
        h.redo = [];
        IM.lib.saveProject(p);
        validateSelection();
        IM.bus.emit('project-changed', p, label);
        app.player.invalidate();
      },
      cancel() { restore(p, before); IM.bus.emit('project-changed', p); app.player.invalidate(); },
    };
  };
  IM.undo = function () {
    const h = hist();
    if (!h || !h.undo.length) return;
    const p = app.project;
    const e = h.undo.pop();
    h.redo.push({ label: e.label, state: snap(p), sel: app.sel.ids.slice() });
    restore(p, e.state);
    app.sel = { ids: (e.sel || []).filter((id) => IM.Project.findItem(p, id)), transition: null };
    IM.lib.saveProject(p);
    IM.bus.emit('project-changed', p, 'undo');
    IM.bus.emit('selection', app.sel);
    app.player.seek(Math.min(app.player.t, IM.Project.duration(p)));
  };
  IM.redo = function () {
    const h = hist();
    if (!h || !h.redo.length) return;
    const p = app.project;
    const e = h.redo.pop();
    h.undo.push({ label: e.label, state: snap(p), sel: app.sel.ids.slice() });
    restore(p, e.state);
    app.sel = { ids: (e.sel || []).filter((id) => IM.Project.findItem(p, id)), transition: null };
    IM.lib.saveProject(p);
    IM.bus.emit('project-changed', p, 'redo');
    IM.bus.emit('selection', app.sel);
    app.player.seek(Math.min(app.player.t, IM.Project.duration(p)));
  };
  IM.undoLabel = () => { const h = hist(); return h && h.undo.length ? h.undo[h.undo.length - 1].label : null; };
  IM.redoLabel = () => { const h = hist(); return h && h.redo.length ? h.redo[h.redo.length - 1].label : null; };
  function validateSelection() {
    const p = app.project;
    const ids = app.sel.ids.filter((id) => IM.Project.findItem(p, id));
    let tr = app.sel.transition;
    if (tr) { const c = p.clips.find((x) => x.id === tr); if (!c || !c.transition) tr = null; }
    if (ids.length !== app.sel.ids.length || tr !== app.sel.transition) {
      app.sel = { ids, transition: tr };
      IM.bus.emit('selection', app.sel);
    }
  }
  IM.validateSelection = validateSelection;

  // ---------- project poster ----------
  IM.updatePoster = function (p) {
    try {
      const r = IM.thumbRenderer && IM.thumbRenderer();
      if (!r || !p.clips.length) { p.poster = null; return; }
      const t = IM.Project.posterFrameTime(p);
      const spec = IM.Compose.frame(p, t, IM.stillProvider, {});
      r.render(spec);
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      c.getContext('2d').drawImage(r.canvas, 0, 0, 320, 180);
      p.poster = c.toDataURL('image/jpeg', 0.75);
    } catch (e) { console.warn('poster failed', e); }
  };

  // Renderer used for thumbnails/previews (small, preserveDrawingBuffer)
  let thumbR = null;
  IM.thumbRenderer = function () {
    if (!thumbR) {
      const c = document.createElement('canvas');
      try { thumbR = new IM.Renderer(c, { width: 320, height: 180, preserve: true }); } catch (e) { return null; }
    }
    return thumbR;
  };
  /** Frame provider for still thumbnails: uses the library thumbnail sprite for video frames. */
  IM.stillProvider = {
    video(it, srcTime, e, m) {
      const th = IM.lib.thumbAt(m, srcTime);
      if (!th) return null;
      if (!m._thumbCanvas) { m._thumbCanvas = document.createElement('canvas'); }
      const c = m._thumbCanvas;
      c.width = th.sw; c.height = th.sh;
      c.getContext('2d').drawImage(th.img, th.sx, th.sy, th.sw, th.sh, 0, 0, th.sw, th.sh);
      return { src: c, key: 'thumb:' + m.id, w: th.sw, h: th.sh, stamp: null };
    },
    image(it, m) { return m.image ? { src: m.image, key: 'img:' + m.id, w: m.width, h: m.height, stamp: 1 } : null; },
  };
})(window.IM = window.IM || {});
