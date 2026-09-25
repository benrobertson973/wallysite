/* Movie project model: primary storyline, connected clips (anchored), background music well, editing ops */
(function (IM) {
  'use strict';
  const EPS = 1e-4;
  const MIN_DUR = 0.1;
  const clamp = IM.clamp;

  IM.OUT_ASPECT = 16 / 9;

  // ---------- defaults ----------
  function defaultAudio() {
    return { volume: 1, mute: false, fadeIn: 0, fadeOut: 0, detached: false, effect: 'none', eq: 'flat', nr: 0, duck: false, duckAmount: 0.75, enhance: false };
  }
  function defaultVideo() {
    return {
      crop: { mode: 'fit', fill: null, kbStart: null, kbEnd: null },
      rotate: 0,
      balance: { mode: 'none', gains: [1, 1, 1] },
      color: { shadows: 0, bright: 0, highlights: 0, contrast: 0, sat: 1, temp: 0 },
      filter: 'none', stabilize: 0, rollingShutter: false, enhance: false,
    };
  }
  function defaultOverlay() {
    return {
      mode: 'cutaway', opacity: 1, fade: 0,
      pip: { x: 0.67, y: 0.06, scale: 0.3, style: 'dissolve', border: 'thin', borderColor: '#ffffff', shadow: true, trans: 0.5 },
      split: { side: 'left', slide: 0 },
      key: { softness: 0.5, color: null, strength: 0.4 },
    };
  }

  function newItem(type, props) {
    const it = {
      id: IM.uid('c'), type, mediaId: null, bgId: null, name: null,
      srcIn: 0, srcOut: 4, speed: 1, reverse: false, preservePitch: true, frameTime: 0,
      audio: defaultAudio(), video: defaultVideo(),
      transition: null,
      anchorId: null, offset: 0, lane: 1,
      overlay: null, title: null, bg: null,
    };
    return Object.assign(it, props || {});
  }

  const Project = {
    defaultAudio, defaultVideo, defaultOverlay, newItem,
    create(name, eventId) {
      return {
        id: IM.uid('p'), name: name || 'My Movie', eventId: eventId || null,
        created: Date.now(), modified: Date.now(), kind: 'movie',
        clips: [], connected: [], music: [],
        settings: { filter: 'none', theme: null, themeMusic: false, fadeIn: false, fadeOut: false, zoom: 40, clipSize: 0.3, waveforms: true },
        fps: 30, playhead: 0, version: 1,
      };
    },
    upgrade(p) {
      p.clips = p.clips || []; p.connected = p.connected || []; p.music = p.music || [];
      p.settings = Object.assign({ filter: 'none', theme: null, themeMusic: false, fadeIn: false, fadeOut: false, zoom: 40, clipSize: 0.3, waveforms: true }, p.settings || {});
      const fix = (it) => {
        it.audio = Object.assign(defaultAudio(), it.audio || {});
        const dv = defaultVideo();
        it.video = Object.assign(dv, it.video || {});
        it.video.crop = Object.assign(defaultVideo().crop, it.video.crop || {});
        it.video.color = Object.assign(defaultVideo().color, it.video.color || {});
        it.video.balance = Object.assign(defaultVideo().balance, it.video.balance || {});
        if (it.overlay) {
          const d = defaultOverlay();
          it.overlay = Object.assign(d, it.overlay);
          it.overlay.pip = Object.assign(defaultOverlay().pip, it.overlay.pip || {});
          it.overlay.split = Object.assign(defaultOverlay().split, it.overlay.split || {});
          it.overlay.key = Object.assign(defaultOverlay().key, it.overlay.key || {});
        }
        if (it.speed == null) it.speed = 1;
      };
      p.clips.forEach(fix); p.connected.forEach(fix); p.music.forEach(fix);
      return p;
    },
    forEachItem(p, fn) {
      p.clips.forEach((c) => fn(c, 'primary'));
      p.connected.forEach((c) => fn(c, 'connected'));
      p.music.forEach((c) => fn(c, 'music'));
    },
    findItem(p, id) {
      let r = null;
      Project.forEachItem(p, (it, where) => { if (!r && it.id === id) r = { item: it, where }; });
      return r;
    },

    // ---------- timing ----------
    isTimed(it) { return it.type === 'video' || it.type === 'audio'; },
    dur(it) {
      if (it.type === 'video' || it.type === 'audio') return Math.max(MIN_DUR / 4, (it.srcOut - it.srcIn) / (it.speed || 1));
      return Math.max(MIN_DUR / 4, it.srcOut - it.srcIn);
    },
    /** Source media time for a local timeline time within the item. */
    srcTime(it, local) {
      if (it.type === 'freeze') return it.frameTime;
      if (it.type === 'video' || it.type === 'audio') {
        const sp = it.speed || 1;
        if (it.reverse) return clamp(it.srcOut - local * sp, it.srcIn, it.srcOut);
        return clamp(it.srcIn + local * sp, it.srcIn, it.srcOut);
      }
      return local;
    },
    /**
     * Source time at which to sample a frame for display/export: the frame on screen at the
     * exact source time ("floor" semantics), with a 1.5 ms guard so frame boundaries resolve
     * identically in the <video> preview and the WebCodecs export even when containers store
     * millisecond-rounded timestamps.
     */
    sampleTime(it, local, m) {
      const base = it.type === 'freeze' ? it.frameTime : Project.srcTime(it, local);
      const maxT = m && m.duration ? Math.max(0, m.duration - 1e-3) : base + 0.0015;
      return clamp(base + 0.0015, 0, maxT);
    },
    hasAudio(it) {
      if (it.type === 'audio') return true;
      if (it.type !== 'video') return false;
      const m = IM.lib.get(it.mediaId);
      return !!(m && m.hasAudio !== false);
    },
    isVisual(it) { return it.type !== 'audio'; },

    // ---------- frame timing ----------
    fps(p) { return (p && p.fps) || 30; },
    /** Snap a time to the project's frame grid. */
    snap(p, t) { const f = Project.fps(p); return Math.round(t * f) / f; },
    /** Length of a duration in whole frames (at least one frame). */
    frames(p, sec) { return Math.max(1, Math.round(sec * Project.fps(p) - 1e-6)); },
    /** Standard frame rates iMovie projects use. */
    standardFps(f) {
      if (!f || !isFinite(f)) return 30;
      const std = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
      let best = 30, bd = 1e9;
      for (const s of std) { const d = Math.abs(s - f); if (d < bd) { bd = d; best = s; } }
      return bd < 1.5 ? best : 30;
    },
    /** The project takes the frame rate of the first video clip added (like iMovie). */
    adoptFps(p, items) {
      if (p.fpsLocked || p.clips.length) return;
      const v = items.find((it) => it.type === 'video');
      if (!v) return;
      const m = IM.lib.get(v.mediaId);
      p.fps = Project.standardFps(m && m.fps);
      p.fpsLocked = true;
    },

    // ---------- layout (integer frames: preview and export agree exactly) ----------
    layout(p) {
      if (p._layout && p._layout.version === p.version) return p._layout;
      const fps = Project.fps(p);
      const L = { version: p.version, fps, clips: [], byId: new Map(), connected: [], music: [], duration: 0, durationF: 0, above: 0, below: 0 };
      const n = p.clips.length;
      const durF = p.clips.map((c) => Project.frames(p, Project.dur(c)));
      let f = 0, prevTrF = 0;
      for (let i = 0; i < n; i++) {
        const c = p.clips[i];
        const dF = durF[i];
        let trF = 0;
        if (i < n - 1 && c.transition) {
          trF = Math.round(c.transition.dur * fps);
          trF = Math.max(0, Math.min(trF, Math.floor(dF / 2), Math.floor(durF[i + 1] / 2)));
          if (trF < 2) trF = 0;
        }
        const e = {
          item: c, index: i, where: 'primary', startF: f, endF: f + dF, durF: dF, trInF: prevTrF, trOutF: trF,
        };
        e.start = e.startF / fps; e.end = e.endF / fps; e.dur = dF / fps;
        e.trIn = prevTrF / fps; e.trOut = trF / fps;
        e.visStart = (e.startF + prevTrF / 2) / fps;
        e.visEnd = (e.endF - trF / 2) / fps;
        L.clips.push(e);
        L.byId.set(c.id, e);
        f = e.endF - trF;
        prevTrF = trF;
      }
      L.durationF = n ? L.clips[n - 1].endF : 0;
      L.duration = L.durationF / fps;
      // connected items (anchored to a primary clip at a frame offset)
      const above = [], below = [];
      for (const it of p.connected) {
        const a = L.byId.get(it.anchorId);
        if (!a) continue;
        const startF = a.startF + Math.max(0, Math.round((it.offset || 0) * fps));
        const dF = Project.frames(p, Project.dur(it));
        const e = { item: it, where: 'connected', startF, endF: startF + dF, durF: dF, anchor: a, lane: 0 };
        e.start = startF / fps; e.end = e.endF / fps; e.dur = dF / fps;
        L.byId.set(it.id, e);
        L.connected.push(e);
        if (it.type === 'audio') below.push(e); else above.push(e);
      }
      L.above = packLanes(above, 1);
      L.below = packLanes(below, -1);
      // background music well: songs always start at the beginning of the movie and play back-to-back
      let mf = 0;
      p.music.forEach((it, i) => {
        const dF = Project.frames(p, Project.dur(it));
        const e = { item: it, index: i, where: 'music', startF: mf, endF: mf + dF, durF: dF, lane: 0 };
        e.start = mf / fps; e.end = e.endF / fps; e.dur = dF / fps;
        L.byId.set(it.id, e);
        L.music.push(e);
        mf += dF;
      });
      L.totalEnd = Math.max(L.duration, ...L.connected.map((e) => e.end), ...L.music.map((e) => e.end), 0);
      p._layout = L;
      return L;
    },
    invalidate(p) { p.version = (p.version || 0) + 1; p._layout = null; },
    duration(p) { return Project.layout(p).duration; },
    /** Frame index shown at time t. */
    frameAt(p, t) { return Math.floor(t * Project.fps(p) + 1e-6); },

    /** Primary clip entry at timeline time t (by visual boundaries). */
    primaryAt(p, t) {
      const L = Project.layout(p);
      for (const e of L.clips) if (t >= e.visStart - EPS && t < e.visEnd - EPS) return e;
      if (L.clips.length && t >= L.duration - EPS) return L.clips[L.clips.length - 1];
      return null;
    },
    /** Everything active at time t (frame-exact). */
    activeAt(p, t) {
      const L = Project.layout(p);
      const f = Math.floor(t * L.fps + 1e-6);
      const inF = (e) => f >= e.startF && f < e.endF;
      return { prim: L.clips.filter(inF), conn: L.connected.filter(inF), music: L.music.filter(inF), frame: f };
    },

    // ---------- creation helpers ----------
    itemFromMedia(m, a, b, prefs) {
      prefs = prefs || IM.prefs || {};
      if (m.kind === 'image') {
        const it = newItem('image', { mediaId: m.id, srcIn: 0, srcOut: prefs.photoDuration || 4, name: m.name });
        const mode = prefs.photoPlacement || 'kenburns';
        it.video.crop.mode = mode;
        if (mode === 'kenburns') Project.defaultKenBurns(it, m);
        return it;
      }
      if (m.kind === 'audio') {
        return newItem('audio', { mediaId: m.id, srcIn: a || 0, srcOut: b == null ? m.duration : b, name: m.name });
      }
      const it = newItem('video', { mediaId: m.id, srcIn: a || 0, srcOut: b == null ? m.duration : b, name: m.name });
      return it;
    },
    makeTitle(styleId, overrides) {
      const st = IM.TitleStyles ? IM.TitleStyles.get(styleId) : null;
      const it = newItem('title', { srcIn: 0, srcOut: (st && st.duration) || 4, name: st ? st.name : 'Title' });
      it.title = Object.assign({
        style: styleId,
        text: st ? st.defaults.slice() : ['Title Text Here'],
        font: st ? st.font : 'Helvetica Neue',
        size: 1, color: st ? st.color : '#ffffff', align: st ? st.align : 'center',
        bold: false, italic: false, outline: false, outlineColor: '#000000',
      }, overrides || {});
      it.audio = defaultAudio();
      return it;
    },
    makeBackground(bgId) {
      const bg = IM.Backgrounds ? IM.Backgrounds.get(bgId) : null;
      const it = newItem('bg', { bgId, srcIn: 0, srcOut: 4, name: bg ? bg.name : 'Background' });
      it.bg = { color1: bg ? bg.color1 : '#000000', color2: bg ? bg.color2 : '#000000' };
      return it;
    },
    /** Default Ken Burns: start slightly zoomed out (full cover), end zoomed in 25% toward centre. */
    defaultKenBurns(it, m) {
      const full = Project.coverRect(m, it.video.rotate);
      const z = 0.78;
      const w = full.w * z, h = full.h * z;
      const cx = full.x + full.w * (0.5 + (IM.hash(m.width + m.height + (m.name || '').length) - 0.5) * 0.12);
      const cy = full.y + full.h * 0.46;
      it.video.crop.kbStart = full;
      it.video.crop.kbEnd = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
    },
    srcDims(m, rotate) {
      let W = (m && m.width) || 1920, H = (m && m.height) || 1080;
      if (rotate === 90 || rotate === 270) { const t = W; W = H; H = t; }
      return { W, H };
    },
    coverRect(m, rotate) {
      const { W, H } = Project.srcDims(m, rotate);
      const sa = W / H, oa = IM.OUT_ASPECT;
      if (sa > oa) { const w = oa / sa; return { x: (1 - w) / 2, y: 0, w, h: 1 }; }
      const h = sa / oa; return { x: 0, y: (1 - h) / 2, w: 1, h };
    },
    fitRect(m, rotate) {
      const { W, H } = Project.srcDims(m, rotate);
      const sa = W / H, oa = IM.OUT_ASPECT;
      if (sa > oa) { const h = sa / oa; return { x: 0, y: (1 - h) / 2, w: 1, h }; }
      const w = oa / sa; return { x: (1 - w) / 2, y: 0, w, h: 1 };
    },
    /** The source rect (normalized, rotated space) visible at local time. */
    cropRectAt(it, m, local, dur) {
      const c = it.video.crop;
      if (c.mode === 'fill') return c.fill || Project.coverRect(m, it.video.rotate);
      if (c.mode === 'kenburns') {
        const a = c.kbStart || Project.coverRect(m, it.video.rotate);
        const b = c.kbEnd || a;
        const k = IM.ease.inOutSine(clamp(dur > 0 ? local / dur : 0, 0, 1));
        return { x: IM.lerp(a.x, b.x, k), y: IM.lerp(a.y, b.y, k), w: IM.lerp(a.w, b.w, k), h: IM.lerp(a.h, b.h, k) };
      }
      return Project.fitRect(m, it.video.rotate);
    },

    // ---------- editing primitives (mutate p; caller handles undo/save) ----------
    /** Split a primary clip at timeline time t. Returns index where new content would be inserted (clip boundary). */
    splitPrimaryAt(p, t) {
      t = Project.snap(p, t);
      const L = Project.layout(p);
      if (!L.clips.length) return 0;
      if (t <= EPS) return 0;
      if (t >= L.duration - EPS) return L.clips.length;
      const e = Project.primaryAt(p, t);
      if (!e) return L.clips.length;
      const fps = Project.fps(p);
      if (Math.abs(t - e.visStart) < 1.5 / fps) return e.index;
      if (Math.abs(t - e.visEnd) < 1.5 / fps) return e.index + 1;
      const local = (Math.round(t * fps) - e.startF) / fps;
      const pair = Project.splitItem(e.item, local);
      if (!pair) return e.index + 1;
      const [A, B] = pair;
      p.clips.splice(e.index, 1, A, B);
      // re-anchor connected items that start after the split point
      for (const c of p.connected) {
        if (c.anchorId !== e.item.id) continue;
        if (c.offset >= local - EPS) { c.anchorId = B.id; c.offset -= local; } else c.anchorId = A.id;
      }
      Project.invalidate(p);
      return e.index + 1;
    },
    /** Split an item at local time; returns [A, B] new objects (A reuses id). */
    splitItem(it, local) {
      const d = Project.dur(it);
      if (local < MIN_DUR / 2 || local > d - MIN_DUR / 2) return null;
      const A = IM.clone(it), B = IM.clone(it);
      B.id = IM.uid('c');
      if (it.type === 'video' || it.type === 'audio') {
        const mid = Project.srcTime(it, local);
        if (it.reverse) { A.srcIn = mid; B.srcOut = mid; } else { A.srcOut = mid; B.srcIn = mid; }
      } else {
        A.srcOut = A.srcIn + local;
        B.srcIn = 0; B.srcOut = d - local;
        if (it.video && it.video.crop.mode === 'kenburns' && it.video.crop.kbStart && it.video.crop.kbEnd) {
          const m = IM.lib.get(it.mediaId);
          const mid = Project.cropRectAt(it, m, local, d);
          A.video.crop.kbEnd = mid; B.video.crop.kbStart = Object.assign({}, mid);
        }
      }
      A.audio.fadeOut = 0; B.audio.fadeIn = 0;
      A.transition = null;
      return [A, B];
    },
    insertPrimary(p, index, items) {
      Project.adoptFps(p, items);
      p.clips.splice(clamp(index, 0, p.clips.length), 0, ...items);
      Project.invalidate(p);
    },
    /** Insert items at time t (splitting if needed). */
    insertAt(p, t, items) {
      const idx = Project.splitPrimaryAt(p, t);
      Project.insertPrimary(p, idx, items);
      return idx;
    },
    append(p, items) { Project.insertPrimary(p, p.clips.length, items); },
    /** Connect items at absolute time t; anchored to the clip under t. */
    connect(p, items, t, lane) {
      const L = Project.layout(p);
      if (!L.clips.length) return false;
      t = Project.snap(p, clamp(t, 0, Math.max(0, L.duration - 1 / L.fps)));
      let offT = t;
      for (const it of items) {
        const e = Project.primaryAt(p, offT) || L.clips[L.clips.length - 1];
        it.anchorId = e.item.id;
        it.offset = Math.max(0, Project.snap(p, offT - e.start));
        it.lane = lane != null ? lane : (it.type === 'audio' ? -1 : 1);
        if (it.type !== 'audio' && !it.overlay && it.type !== 'title') it.overlay = defaultOverlay();
        p.connected.push(it);
        offT += Project.frames(p, Project.dur(it)) / L.fps;
        if (offT > L.duration - 1 / L.fps) offT = L.duration - 1 / L.fps;
      }
      Project.invalidate(p);
      return true;
    },
    /** Move a connected item to absolute time t (re-anchoring) and lane. */
    moveConnected(p, id, t, lane) {
      const it = p.connected.find((c) => c.id === id);
      if (!it) return;
      const L = Project.layout(p);
      if (!L.clips.length) return;
      t = Project.snap(p, clamp(t, 0, Math.max(0, L.duration - 1 / L.fps)));
      const e = Project.primaryAt(p, t) || L.clips[L.clips.length - 1];
      it.anchorId = e.item.id;
      it.offset = Math.max(0, Project.snap(p, t - e.start));
      if (lane != null) it.lane = lane;
      Project.invalidate(p);
    },
    /** Reorder a background-music item to position index. */
    moveMusic(p, id, index) {
      const i = p.music.findIndex((c) => c.id === id);
      if (i < 0) return;
      const [it] = p.music.splice(i, 1);
      if (index > i) index--;
      p.music.splice(IM.clamp(index, 0, p.music.length), 0, it);
      Project.invalidate(p);
    },
    /** Add songs to the background music well at index (default: after the last song). */
    addMusic(p, items, index) {
      if (index == null) index = p.music.length;
      for (const it of items) { it.offset = 0; it.anchorId = null; it.lane = 0; }
      p.music.splice(IM.clamp(index, 0, p.music.length), 0, ...items);
      Project.invalidate(p);
    },
    musicEnd(p) {
      let end = 0;
      for (const m of p.music) end += Project.dur(m);
      return end;
    },
    /** Index in the music well for a drop at time t. */
    musicIndexAt(p, t) {
      const L = Project.layout(p);
      for (const e of L.music) if (t < (e.start + e.end) / 2) return e.index;
      return L.music.length;
    },
    moveClip(p, id, newIndex) {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i < 0) return;
      const [c] = p.clips.splice(i, 1);
      if (newIndex > i) newIndex--;
      p.clips.splice(clamp(newIndex, 0, p.clips.length), 0, c);
      Project.invalidate(p);
    },
    moveClips(p, ids, newIndex) {
      const moving = p.clips.filter((c) => ids.includes(c.id));
      if (!moving.length) return;
      let idx = newIndex;
      for (let i = 0; i < newIndex && i < p.clips.length; i++) if (ids.includes(p.clips[i].id)) idx--;
      p.clips = p.clips.filter((c) => !ids.includes(c.id));
      p.clips.splice(clamp(idx, 0, p.clips.length), 0, ...moving);
      Project.invalidate(p);
    },
    deleteItems(p, ids) {
      const set = new Set(ids);
      const removedPrimary = p.clips.filter((c) => set.has(c.id)).map((c) => c.id);
      // connected anchored to deleted primary clips are deleted as well
      const rp = new Set(removedPrimary);
      p.connected = p.connected.filter((c) => !set.has(c.id) && !rp.has(c.anchorId));
      p.clips = p.clips.filter((c) => !set.has(c.id));
      p.music = p.music.filter((c) => !set.has(c.id));
      Project.invalidate(p);
    },
    removeTransition(p, clipId) {
      const c = p.clips.find((x) => x.id === clipId);
      if (c) { c.transition = null; Project.invalidate(p); }
    },
    setTransition(p, clipId, type, dur) {
      const i = p.clips.findIndex((x) => x.id === clipId);
      if (i < 0 || i >= p.clips.length - 1) return false;
      p.clips[i].transition = { type, dur: dur || (IM.prefs.transitionDuration || 1) };
      Project.invalidate(p);
      return true;
    },
    /** Trim edge of an item by delta seconds of timeline time (positive = move edge right). */
    trim(p, id, edge, delta) {
      const f = Project.findItem(p, id);
      if (!f) return;
      delta = Project.snap(p, delta);
      const it = f.item;
      const m = it.mediaId ? IM.lib.get(it.mediaId) : null;
      const d0 = Project.dur(it);
      if (it.type === 'video' || it.type === 'audio') {
        const sp = it.speed || 1;
        const maxSrc = m ? m.duration : it.srcOut;
        const ds = delta * sp;
        if (!it.reverse) {
          if (edge === 'start') it.srcIn = clamp(it.srcIn + ds, 0, it.srcOut - MIN_DUR * sp);
          else it.srcOut = clamp(it.srcOut + ds, it.srcIn + MIN_DUR * sp, maxSrc);
        } else {
          if (edge === 'start') it.srcOut = clamp(it.srcOut - ds, it.srcIn + MIN_DUR * sp, maxSrc);
          else it.srcIn = clamp(it.srcIn - ds, 0, it.srcOut - MIN_DUR * sp);
        }
      } else {
        const nd = Math.max(MIN_DUR, d0 + (edge === 'start' ? -delta : delta));
        it.srcOut = it.srcIn + nd;
      }
      const d1 = Project.dur(it);
      const applied = edge === 'start' ? d0 - d1 : d1 - d0;
      if (edge === 'start') {
        if (f.where === 'primary') {
          // keep connected items with their content
          for (const c of p.connected) if (c.anchorId === it.id) c.offset = Math.max(0, c.offset - applied);
        } else if (f.where === 'connected') {
          it.offset = Math.max(0, it.offset + applied);
        }
      }
      Project.invalidate(p);
      return applied;
    },
    setSpeed(p, id, speed) {
      const f = Project.findItem(p, id);
      if (!f) return;
      const it = f.item;
      if (it.type !== 'video' && it.type !== 'audio') return;
      const old = it.speed || 1;
      it.speed = clamp(speed, 0.05, 20);
      if (f.where === 'primary') {
        for (const c of p.connected) if (c.anchorId === it.id) c.offset = c.offset * old / it.speed;
      }
      Project.invalidate(p);
    },
    detachAudio(p, id) {
      const f = Project.findItem(p, id);
      if (!f) return null;
      const it = f.item;
      if (it.type !== 'video' || it.audio.detached || !Project.hasAudio(it)) return null;
      const a = newItem('audio', {
        mediaId: it.mediaId, srcIn: it.srcIn, srcOut: it.srcOut, speed: it.speed, reverse: it.reverse,
        preservePitch: it.preservePitch, name: it.name, audio: IM.clone(it.audio), lane: -1,
      });
      a.audio.detached = false;
      if (f.where === 'primary') { a.anchorId = it.id; a.offset = 0; }
      else { a.anchorId = it.anchorId; a.offset = it.offset; }
      it.audio.detached = true;
      p.connected.push(a);
      Project.invalidate(p);
      return a;
    },
    addFreezeFrame(p, t) {
      t = Project.snap(p, t);
      const e = Project.primaryAt(p, t);
      if (!e || e.item.type !== 'video') return null;
      const src = Project.srcTime(e.item, t - e.start);
      const fz = newItem('freeze', {
        mediaId: e.item.mediaId, frameTime: src, srcIn: 0, srcOut: IM.prefs.freezeDuration || 3,
        name: (e.item.name || 'Clip') + ' (Freeze Frame)', video: IM.clone(e.item.video),
      });
      if (fz.video.crop.mode === 'kenburns') fz.video.crop.mode = 'fill';
      const idx = Project.splitPrimaryAt(p, t);
      Project.insertPrimary(p, idx, [fz]);
      return fz;
    },
    joinClips(p, ids) {
      let joined = 0;
      for (let i = 0; i < p.clips.length - 1; i++) {
        const a = p.clips[i], b = p.clips[i + 1];
        if (!ids.includes(a.id) && !ids.includes(b.id)) continue;
        if (a.type !== 'video' || b.type !== 'video' || a.mediaId !== b.mediaId) continue;
        if (a.reverse || b.reverse || Math.abs((a.speed || 1) - (b.speed || 1)) > 1e-3) continue;
        if (Math.abs(a.srcOut - b.srcIn) > 0.05 || a.transition) continue;
        a.srcOut = b.srcOut;
        a.audio.fadeOut = b.audio.fadeOut;
        a.transition = b.transition;
        const aDur = Project.dur(a) - (b.srcOut - b.srcIn) / (a.speed || 1);
        for (const c of p.connected) if (c.anchorId === b.id) { c.anchorId = a.id; c.offset += aDur; }
        p.clips.splice(i + 1, 1);
        i--;
        joined++;
      }
      if (joined) Project.invalidate(p);
      return joined;
    },
    /** Replace clip id with new item according to mode. */
    replaceClip(p, id, newIt, mode) {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i < 0) return;
      const old = p.clips[i];
      const oldDur = Project.dur(old);
      if ((mode === 'start' || mode === 'end') && (newIt.type === 'video' || newIt.type === 'audio')) {
        const avail = (newIt.srcOut - newIt.srcIn);
        const need = oldDur * (newIt.speed || 1);
        if (avail > need) {
          if (mode === 'start') newIt.srcOut = newIt.srcIn + need;
          else newIt.srcIn = newIt.srcOut - need;
        }
      } else if ((mode === 'start' || mode === 'end') && newIt.type !== 'video') {
        newIt.srcOut = newIt.srcIn + oldDur;
      }
      newIt.transition = old.transition;
      for (const c of p.connected) if (c.anchorId === old.id) c.anchorId = newIt.id;
      p.clips.splice(i, 1, newIt);
      Project.invalidate(p);
    },
    /** Duplicate range with slow motion right after the clip (Instant Replay). */
    instantReplay(p, id, rate) {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i < 0) return;
      const c = p.clips[i];
      if (c.type !== 'video') return;
      const r = IM.clone(c);
      r.id = IM.uid('c');
      r.speed = (c.speed || 1) * rate;
      r.transition = null;
      p.clips.splice(i + 1, 0, r);
      Project.invalidate(p);
      const title = Project.makeTitle('standard-lower', { text: ['Instant Replay', ''] });
      title.srcOut = Math.min(Project.dur(r), 4);
      Project.connect(p, [title], Project.layout(p).byId.get(r.id).start + 0.01, 2);
      return r;
    },
    rewind(p, id, rate) {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i < 0) return;
      const c = p.clips[i];
      if (c.type !== 'video') return;
      const back = IM.clone(c); back.id = IM.uid('c'); back.reverse = !c.reverse; back.speed = rate; back.transition = null;
      back.audio.mute = false;
      const again = IM.clone(c); again.id = IM.uid('c'); again.transition = c.transition; c.transition = null;
      p.clips.splice(i + 1, 0, back, again);
      Project.invalidate(p);
    },
    /** Items (deep clones, fresh ids) for clipboard pasting. */
    cloneForPaste(items) {
      return items.map((it) => { const c = IM.clone(it); c.id = IM.uid('c'); return c; });
    },
    usedRanges(p, mediaId) {
      const out = [];
      Project.forEachItem(p, (it) => {
        if (it.mediaId !== mediaId) return;
        if (it.type === 'video' || it.type === 'audio') out.push([it.srcIn, it.srcOut]);
        else if (it.type === 'freeze') out.push([it.frameTime, it.frameTime + 0.1]);
        else if (it.type === 'image') out.push([0, 1e9]);
      });
      return out;
    },
    /** Snap points (clip boundaries) for skimming/snapping */
    snapPoints(p) {
      const L = Project.layout(p);
      const pts = [0, L.duration];
      for (const e of L.clips) pts.push(e.visStart, e.visEnd);
      for (const e of L.connected) pts.push(e.start, e.end);
      for (const e of L.music) pts.push(e.start, e.end);
      return pts;
    },
    posterFrameTime(p) {
      const L = Project.layout(p);
      if (!L.clips.length) return 0;
      return Math.min(L.duration * 0.25, L.clips[0].end - 0.01);
    },
  };

  /** Greedy lane packing preserving preferred lanes. sign: +1 above, -1 below */
  function packLanes(entries, sign) {
    entries.sort((a, b) => a.start - b.start || Math.abs(a.item.lane || 1) - Math.abs(b.item.lane || 1));
    const lanes = []; // lanes[k] = array of [start,end]
    let maxLane = 0;
    for (const e of entries) {
      let want = Math.max(1, Math.abs(e.item.lane || 1));
      let lane = want;
      for (;;) {
        const occ = lanes[lane] || (lanes[lane] = []);
        if (!occ.some(([s, en]) => s < e.end - EPS && en > e.start + EPS)) { occ.push([e.start, e.end]); break; }
        lane++;
      }
      e.lane = lane * sign;
      maxLane = Math.max(maxLane, lane);
    }
    return maxLane;
  }

  IM.Project = Project;
})(window.IM = window.IM || {});
