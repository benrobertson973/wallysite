/* iMovie for the web — shared utilities */
(function (IM) {
  'use strict';

  IM.isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  /** The desktop app's bridge (desktop/preload.js), or null in a browser. */
  IM.desktop = window.imovieDesktop || null;

  // ---------- DOM helpers ----------
  IM.$ = (sel, root) => (root || document).querySelector(sel);
  IM.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /**
   * Hyperscript: h('div.cls#id', {attrs, style, on:{click}}, children...)
   */
  IM.h = function h(tag, attrs, ...children) {
    let tagName = 'div';
    const classes = [];
    let id = null;
    tag.replace(/([.#]?)([\w-]+)/g, (m, p, name) => {
      if (p === '.') classes.push(name);
      else if (p === '#') id = name;
      else tagName = name;
    });
    const isSvg = tagName === 'svg' || tagName === 'path' || tagName === 'circle' || tagName === 'rect' || tagName === 'g';
    const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tagName) : document.createElement(tagName);
    if (id) el.id = id;
    if (classes.length) el.setAttribute('class', classes.join(' '));
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'on') { for (const ev in v) el.addEventListener(ev, v[ev]); }
        else if (k === 'class' || k === 'className') el.setAttribute('class', (el.getAttribute('class') ? el.getAttribute('class') + ' ' : '') + v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && !isSvg && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    appendChildren(el, children);
    return el;
  };
  function appendChildren(el, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) appendChildren(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }

  IM.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  // ---------- math ----------
  IM.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  IM.lerp = (a, b, t) => a + (b - a) * t;
  IM.smoothstep = (a, b, x) => { const t = IM.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  IM.ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => t * (2 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    inCubic: (t) => t * t * t,
    outCubic: (t) => (--t) * t * t + 1,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: (t) => { if (t === 0 || t === 1) return t; return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
    outBounce: (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  };
  // deterministic pseudo random
  IM.rand = function (seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };
  IM.hash = function (n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------- ids ----------
  let idCounter = 0;
  IM.uid = (prefix) => (prefix || 'id') + '_' + Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- deep clone ----------
  IM.clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  // ---------- time formatting ----------
  IM.prefs = IM.prefs || { timecodeFrames: false };
  IM.FPS = 30;
  /** iMovie viewer/timeline time display: "0:05" or "1:02:03", or with frames HH:MM:SS:FF */
  IM.fmtTime = function (sec, forceFrames) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    if (forceFrames || IM.prefs.timecodeFrames) {
      const totalFrames = Math.round(sec * IM.FPS);
      const f = totalFrames % IM.FPS;
      const s = Math.floor(totalFrames / IM.FPS);
      const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
      const p = (n) => String(n).padStart(2, '0');
      return p(hh) + ':' + p(mm) + ':' + p(ss) + ':' + p(f);
    }
    const s = Math.floor(sec + 1e-6);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    if (hh > 0) return hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    return mm + ':' + String(ss).padStart(2, '0');
  };
  /** Clip duration badge, e.g. "4.2s", "1m 12s" */
  IM.fmtDur = function (sec) {
    if (!isFinite(sec)) return '';
    if (sec < 60) {
      const r = Math.round(sec * 10) / 10;
      return (r % 1 === 0 ? r.toFixed(1) : r.toFixed(1)) + 's';
    }
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (m >= 60) { const h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; }
    return m + 'm ' + s + 's';
  };
  IM.fmtBytes = function (b) {
    if (b < 1024) return b + ' bytes';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };
  IM.fmtDate = function (ts, style) {
    const d = new Date(ts);
    if (style === 'long') return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (style === 'event') return (d.getMonth() + 1) + '-' + d.getDate() + '-' + String(d.getFullYear()).slice(2);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // ---------- events ----------
  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); return () => this.off(ev, fn); }
    off(ev, fn) { const a = this._h[ev]; if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    emit(ev, ...args) { const a = this._h[ev]; if (!a) return; for (const fn of a.slice()) { try { fn(...args); } catch (e) { console.error(e); } } }
  }
  IM.Emitter = Emitter;
  IM.bus = new Emitter();

  IM.debounce = function (fn, ms) {
    let t = null;
    const d = function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
    d.flush = () => { if (t) { clearTimeout(t); t = null; fn(); } };
    return d;
  };
  IM.rafThrottle = function (fn) {
    let pending = false, lastArgs = null;
    return function (...args) {
      lastArgs = args;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; fn(...lastArgs); });
    };
  };
  IM.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  IM.nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // ---------- pointer drag helper ----------
  /** Calls onMove(dx, dy, e) and onUp(e, moved). Returns nothing. */
  IM.drag = function (downEvent, onMove, onUp, opts) {
    opts = opts || {};
    const sx = downEvent.clientX, sy = downEvent.clientY;
    let moved = false;
    const threshold = opts.threshold == null ? 3 : opts.threshold;
    const target = downEvent.target;
    const pid = downEvent.pointerId;
    try { if (pid != null && target.setPointerCapture && !opts.noCapture) target.setPointerCapture(pid); } catch (e) { /* ignore */ }
    function move(e) {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      moved = true;
      onMove && onMove(dx, dy, e);
    }
    function up(e) {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      try { if (pid != null && target.releasePointerCapture) target.releasePointerCapture(pid); } catch (err) { /* ignore */ }
      onUp && onUp(e, moved);
    }
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };

  // ---------- keyboard ----------
  IM.cmd = (e) => (IM.isMac ? e.metaKey : e.ctrlKey);
  IM.isTyping = function (e) {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  };

  // ---------- files ----------
  IM.mediaTypeOf = function (file) {
    const t = (file.type || '').toLowerCase();
    const n = (file.name || '').toLowerCase();
    if (t.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp|mts|m2ts|hevc)$/.test(n)) return 'video';
    if (t.startsWith('audio/') || /\.(mp3|m4a|aac|wav|aif|aiff|ogg|oga|flac|opus|caf)$/.test(n)) return 'audio';
    if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?|avif|svg)$/.test(n)) return 'image';
    return null;
  };
  IM.baseName = (name) => String(name || '').replace(/\.[^.]+$/, '');

  IM.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // ---------- colors ----------
  IM.hexToRgb = function (hex) {
    hex = String(hex || '#000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  IM.rgbToHex = function (r, g, b) {
    const c = (v) => Math.round(IM.clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  };

  // ---------- misc ----------
  IM.plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
  IM.escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Wait for a media element event with timeout. */
  IM.once = function (target, ev, timeout) {
    return new Promise((resolve, reject) => {
      let to = null;
      const done = (e) => { clearTimeout(to); target.removeEventListener(ev, done); target.removeEventListener('error', fail); resolve(e); };
      const fail = (e) => { clearTimeout(to); target.removeEventListener(ev, done); target.removeEventListener('error', fail); reject(e || new Error('media error')); };
      target.addEventListener(ev, done);
      target.addEventListener('error', fail);
      if (timeout) to = setTimeout(() => { target.removeEventListener(ev, done); target.removeEventListener('error', fail); resolve(null); }, timeout);
    });
  };

  /** Seek a media element and resolve when the frame is ready. */
  IM.seekMedia = function (el, t, timeout) {
    return new Promise((resolve) => {
      if (Math.abs(el.currentTime - t) < 0.001 && el.readyState >= 2) { resolve(true); return; }
      let finished = false;
      const done = () => {
        if (finished) return; finished = true;
        el.removeEventListener('seeked', done);
        clearTimeout(to);
        resolve(true);
      };
      const to = setTimeout(done, timeout || 3000);
      el.addEventListener('seeked', done);
      try { el.currentTime = t; } catch (e) { done(); }
    });
  };

  // Simple global audio context (created lazily; resumed on gesture)
  IM.audioCtx = function () {
    if (!IM._actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      IM._actx = new AC({ latencyHint: 'interactive' });
    }
    return IM._actx;
  };
  IM.resumeAudio = function () {
    const c = IM.audioCtx();
    if (c.state === 'suspended') c.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', () => { if (IM._actx) IM.resumeAudio(); }, true);
  window.addEventListener('keydown', () => { if (IM._actx) IM.resumeAudio(); }, true);
})(window.IM = window.IM || {});
