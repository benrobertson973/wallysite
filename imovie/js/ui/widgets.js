/* UI primitives: menus, popovers, sheets, alerts, tooltips, notifications, controls */
(function (IM) {
  'use strict';
  const h = IM.h;

  // ---------- keyboard shortcut helpers ----------
  const KEY_GLYPH = {
    delete: '⌫', backspace: '⌫', fwddelete: '⌦', space: 'Space', left: '←', right: '→', up: '↑', down: '↓',
    return: '↩', enter: '↩', esc: '⎋', escape: '⎋', home: '↖', end: '↘', tab: '⇥', pageup: '⇞', pagedown: '⇟',
  };
  /** 'shift+cmd+f' -> '⇧⌘F' */
  IM.shortcutGlyph = function (spec) {
    if (!spec) return '';
    const parts = spec.toLowerCase().split('+');
    let key = parts.pop();
    if (key === '' && spec.endsWith('+')) key = '+';
    const mods = new Set(parts);
    let s = '';
    if (mods.has('ctrl')) s += '⌃';
    if (mods.has('alt')) s += '⌥';
    if (mods.has('shift')) s += '⇧';
    if (mods.has('cmd')) s += '⌘';
    s += KEY_GLYPH[key] || key.toUpperCase();
    return s;
  };
  const CODE_KEY = {
    Slash: '/', Backslash: '\\', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.',
    Semicolon: ';', Quote: "'", Backquote: '`', Space: 'space', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    Backspace: 'delete', Delete: 'fwddelete', Enter: 'return', NumpadEnter: 'return', Escape: 'esc', Home: 'home', End: 'end', Tab: 'tab',
    PageUp: 'pageup', PageDown: 'pagedown', NumpadAdd: '=', NumpadSubtract: '-',
  };
  IM.eventKey = function (e) {
    const code = e.code || '';
    if (code.startsWith('Key')) return code.slice(3).toLowerCase();
    if (code.startsWith('Digit')) return code.slice(5);
    if (CODE_KEY[code]) return CODE_KEY[code];
    const k = (e.key || '').toLowerCase();
    return KEY_GLYPH[k] ? k : k;
  };
  /** Does keyboard event e match spec 'alt+cmd+b'? Cmd maps to Ctrl on non-Mac. */
  IM.matchShortcut = function (e, spec) {
    const parts = spec.toLowerCase().split('+');
    let key = parts.pop();
    if (key === '' && spec.endsWith('+')) key = '+';
    const mods = new Set(parts);
    const wantCmd = mods.has('cmd'), wantCtrl = mods.has('ctrl');
    const cmdDown = IM.isMac ? e.metaKey : e.ctrlKey;
    const ctrlDown = IM.isMac ? e.ctrlKey : false;
    if (wantCmd !== cmdDown) return false;
    if (IM.isMac && wantCtrl !== ctrlDown) return false;
    if (mods.has('alt') !== e.altKey) return false;
    if (mods.has('shift') !== e.shiftKey) return false;
    return IM.eventKey(e) === key;
  };

  // ---------- Menus ----------
  let openMenus = [];
  class Menu {
    /**
     * items: [{label, key, action, disabled, checked, submenu, separator, header, id}]
     */
    constructor(items, opts) {
      this.items = items;
      this.opts = opts || {};
      this.el = h('div.menu', { tabindex: -1 });
      this.child = null;
      this.parent = this.opts.parent || null;
      this.hover = -1;
      this.rows = [];
      this.build();
    }
    build() {
      const el = this.el;
      IM.clear(el);
      this.rows = [];
      this.items.forEach((it, idx) => {
        if (!it) return;
        if (it.separator) { el.appendChild(h('div.ms')); return; }
        if (it.header) { el.appendChild(h('div.mh', it.header)); return; }
        if (it.element) { el.appendChild(it.element); return; }
        const disabled = typeof it.disabled === 'function' ? it.disabled() : !!it.disabled;
        const checked = typeof it.checked === 'function' ? it.checked() : it.checked;
        const row = h('div.mi' + (disabled ? '.disabled' : ''),
          checked ? h('span.mi-check', checked === 'mixed' ? '–' : '✓') : null,
          it.icon ? h('span', { style: { marginRight: '7px', display: 'inline-flex' } }, IM.icon(it.icon, 14)) : null,
          h('span.mi-label', typeof it.label === 'function' ? it.label() : it.label),
          it.key ? h('span.mi-key', IM.shortcutGlyph(it.key)) : null,
          it.submenu ? h('span.mi-arrow', '▸') : null);
        row._item = it;
        row._index = this.rows.length;
        row._disabled = disabled;
        row.addEventListener('pointerenter', () => this.setHover(row._index, true));
        row.addEventListener('pointerup', (e) => { e.stopPropagation(); if (!it.submenu) this.activate(row._index); });
        row.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (it.submenu) this.openSub(row._index); });
        this.rows.push(row);
        el.appendChild(row);
      });
    }
    setHover(i, fromMouse) {
      if (this.hover >= 0 && this.rows[this.hover]) this.rows[this.hover].classList.remove('hover');
      this.hover = i;
      const row = this.rows[i];
      if (!row) return;
      row.classList.add('hover');
      clearTimeout(this._subTimer);
      if (row._item.submenu && !row._disabled) {
        if (fromMouse) this._subTimer = setTimeout(() => this.openSub(i), 180);
      } else if (this.child) {
        if (fromMouse) this._subTimer = setTimeout(() => this.closeChild(), 150);
        else this.closeChild();
      }
    }
    openSub(i) {
      const row = this.rows[i];
      if (!row || row._disabled) return;
      if (this.child && this.child._fromRow === row) return;
      this.closeChild();
      const items = typeof row._item.submenu === 'function' ? row._item.submenu() : row._item.submenu;
      const sub = new Menu(items, { parent: this, onClose: null });
      sub._fromRow = row;
      this.child = sub;
      const r = row.getBoundingClientRect();
      sub.showAt(r.right - 2, r.top - 5, { sub: true, alignLeftEdge: r.left + 2 });
    }
    closeChild() { if (this.child) { this.child.close(true); this.child = null; } }
    activate(i) {
      const row = this.rows[i];
      if (!row || row._disabled) return;
      const it = row._item;
      if (it.submenu) { this.openSub(i); return; }
      // flash like macOS
      row.classList.remove('hover');
      setTimeout(() => { row.classList.add('hover'); }, 60);
      setTimeout(() => {
        Menu.closeAll();
        if (it.action) it.action();
      }, 110);
    }
    showAt(x, y, o) {
      o = o || {};
      document.body.appendChild(this.el);
      const r = this.el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = x, top = y;
      if (left + r.width > vw - 4) left = o.sub ? (o.alignLeftEdge - r.width) : vw - r.width - 4;
      if (top + r.height > vh - 4) top = Math.max(26, vh - r.height - 4);
      if (o.above && y - r.height > 0) top = y - r.height;
      this.el.style.left = Math.max(4, left) + 'px';
      this.el.style.top = Math.max(4, top) + 'px';
      if (!this.parent) openMenus.push(this);
      return this;
    }
    close(fromParent) {
      this.closeChild();
      this.el.remove();
      if (!this.parent) {
        openMenus = openMenus.filter((m) => m !== this);
        if (this.opts.onClose) this.opts.onClose();
      } else if (!fromParent && this.parent.child === this) {
        this.parent.child = null;
      }
    }
    deepest() { let m = this; while (m.child) m = m.child; return m; }
    handleKey(e) {
      const m = this.deepest();
      const n = m.rows.length;
      if (e.key === 'ArrowDown') {
        let i = m.hover;
        for (let k = 0; k < n; k++) { i = (i + 1) % n; if (!m.rows[i]._disabled) break; }
        m.setHover(i);
      } else if (e.key === 'ArrowUp') {
        let i = m.hover < 0 ? n : m.hover;
        for (let k = 0; k < n; k++) { i = (i - 1 + n) % n; if (!m.rows[i]._disabled) break; }
        m.setHover(i);
      } else if (e.key === 'ArrowRight') {
        if (m.hover >= 0 && m.rows[m.hover]._item.submenu) { m.openSub(m.hover); if (m.child) m.child.setHover(0); }
        else if (this.opts.onRight) this.opts.onRight();
      } else if (e.key === 'ArrowLeft') {
        if (m.parent) m.close();
        else if (this.opts.onLeft) this.opts.onLeft();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (m.hover >= 0) m.activate(m.hover);
      } else if (e.key === 'Escape') {
        Menu.closeAll();
      } else return false;
      e.preventDefault();
      return true;
    }
    static closeAll() { openMenus.slice().forEach((m) => m.close()); openMenus = []; }
    static isOpen() { return openMenus.length > 0; }
    static top() { return openMenus[openMenus.length - 1]; }
  }
  IM.Menu = Menu;
  IM.contextMenu = function (e, items) {
    e.preventDefault();
    Menu.closeAll();
    const m = new Menu(items.filter(Boolean));
    m.showAt(e.clientX + 1, e.clientY + 1);
    return m;
  };
  document.addEventListener('pointerdown', (e) => {
    if (!Menu.isOpen()) return;
    if (e.target.closest && (e.target.closest('.menu') || e.target.closest('#menubar'))) return;
    Menu.closeAll();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!Menu.isOpen()) return;
    const m = Menu.top();
    if (m.handleKey(e)) e.stopPropagation();
  }, true);

  // ---------- popovers ----------
  let openPopovers = [];
  /**
   * Show a popover next to an anchor element or rect.
   * opts: {side:'bottom'|'top'|'right'|'left', className, onClose, noArrow, modal}
   */
  IM.popover = function (anchor, content, opts) {
    opts = opts || {};
    if (!opts.keepOthers) IM.closePopovers();
    const pop = h('div.popover' + (opts.className ? '.' + opts.className.split(' ').join('.') : ''));
    const arrow = h('div.pop-arrow');
    if (!opts.noArrow) pop.appendChild(arrow);
    pop.appendChild(content);
    document.body.appendChild(pop);
    const place = () => {
      const ar = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
      const pr = pop.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let side = opts.side || 'bottom';
      if (side === 'bottom' && ar.bottom + pr.height + 12 > vh && ar.top - pr.height - 12 > 0) side = 'top';
      if (side === 'top' && ar.top - pr.height - 12 < 0) side = 'bottom';
      let left, top;
      if (side === 'bottom' || side === 'top') {
        left = ar.left + ar.width / 2 - pr.width / 2;
        if (opts.align === 'left') left = ar.left - 10;
        if (opts.align === 'right') left = ar.right - pr.width + 10;
        left = IM.clamp(left, 6, vw - pr.width - 6);
        top = side === 'bottom' ? ar.bottom + 9 : ar.top - pr.height - 9;
        pop.classList.toggle('arrow-up', side === 'bottom');
        pop.classList.toggle('arrow-down', side === 'top');
        const ax = IM.clamp(ar.left + ar.width / 2 - left - 9, 12, pr.width - 30);
        arrow.style.left = ax + 'px';
      } else {
        top = IM.clamp(ar.top + ar.height / 2 - pr.height / 2, 30, vh - pr.height - 6);
        left = side === 'right' ? ar.right + 9 : ar.left - pr.width - 9;
        arrow.style.display = 'none';
      }
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
    };
    place();
    const rec = { el: pop, close: null, place, anchor };
    rec.close = () => {
      if (!pop.parentNode) return;
      pop.remove();
      openPopovers = openPopovers.filter((p) => p !== rec);
      if (opts.onClose) opts.onClose();
    };
    openPopovers.push(rec);
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    return rec;
  };
  IM.closePopovers = function () { openPopovers.slice().forEach((p) => p.close()); };
  IM.hasPopover = () => openPopovers.length > 0;
  document.addEventListener('pointerdown', (e) => {
    if (!openPopovers.length) return;
    if (e.target.closest && (e.target.closest('.popover') || e.target.closest('.menu'))) return;
    const top = openPopovers[openPopovers.length - 1];
    if (top.anchor && top.anchor.contains && top.anchor.contains(e.target)) { e.stopPropagation(); top.close(); return; }
    IM.closePopovers();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openPopovers.length && !Menu.isOpen()) {
      openPopovers[openPopovers.length - 1].close();
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // ---------- sheets ----------
  let sheetStack = [];
  IM.sheet = function (content, opts) {
    opts = opts || {};
    const host = IM.$('#window');
    const backdrop = h('div.sheet-backdrop');
    const sheet = h('div.sheet' + (opts.floating ? '.floating' : ''), content);
    if (opts.width) sheet.style.width = opts.width + 'px';
    host.appendChild(backdrop);
    host.appendChild(sheet);
    const rec = {
      el: sheet,
      close() {
        backdrop.remove(); sheet.remove();
        sheetStack = sheetStack.filter((s) => s !== rec);
        if (opts.onClose) opts.onClose();
      },
      opts,
    };
    sheetStack.push(rec);
    backdrop.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (opts.closeOnBackdrop) rec.close(); });
    setTimeout(() => {
      const f = sheet.querySelector('[autofocus]') || sheet.querySelector('input,textarea');
      if (f && !opts.noFocus) { f.focus(); if (f.select) f.select(); }
    }, 60);
    return rec;
  };
  IM.hasSheet = () => sheetStack.length > 0;
  IM.topSheet = () => sheetStack[sheetStack.length - 1];
  document.addEventListener('keydown', (e) => {
    if (!sheetStack.length || Menu.isOpen() || openPopovers.length) return;
    const top = sheetStack[sheetStack.length - 1];
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (top.opts.onCancel) top.opts.onCancel(); else top.close();
    } else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
      const def = top.el.querySelector('.btn.primary:not([disabled])');
      if (def) { e.preventDefault(); e.stopPropagation(); def.click(); }
    }
  }, true);

  /** Alert dialog (macOS style, app icon on top). Returns a promise of the clicked button index. */
  IM.alert = function (o) {
    return new Promise((resolve) => {
      const buttons = o.buttons || [{ label: 'OK', primary: true }];
      let rec;
      const btnEls = buttons.map((b, i) => h('button.btn' + (b.primary ? '.primary' : ''), {
        on: { click: () => { rec.close(); resolve(i); } },
      }, b.label));
      const content = h('div.alert',
        h('div.app-icon'),
        h('div.alert-title', o.title || ''),
        o.message ? h('div.alert-msg', o.message) : null,
        o.body || null,
        h('div.alert-buttons' + (buttons.length === 2 && !o.stack ? '.row' : ''), btnEls.slice().reverse()));
      rec = IM.sheet(content, {
        floating: true,
        onCancel: () => { rec.close(); resolve(buttons.findIndex((b) => b.cancel) >= 0 ? buttons.findIndex((b) => b.cancel) : -1); },
      });
    });
  };
  IM.prompt = function (o) {
    return new Promise((resolve) => {
      const input = h('input.text-field', { type: 'text', value: o.value || '', style: { width: '100%', marginTop: '10px' } });
      let rec;
      const content = h('div.alert',
        h('div.app-icon'),
        h('div.alert-title', o.title || ''),
        o.message ? h('div.alert-msg', o.message) : null,
        input,
        h('div.alert-buttons.row',
          h('button.btn', { on: { click: () => { rec.close(); resolve(null); } } }, 'Cancel'),
          h('button.btn.primary', { on: { click: () => { rec.close(); resolve(input.value); } } }, o.ok || 'OK')));
      rec = IM.sheet(content, { floating: true, onCancel: () => { rec.close(); resolve(null); } });
    });
  };

  // ---------- notifications ----------
  IM.notify = function (title, body, opts) {
    opts = opts || {};
    const n = h('div.notification',
      h('div.app-icon'),
      h('div', h('div.n-title', title), h('div.n-body', body)),
      opts.action ? h('div.n-actions', h('button.btn.small', { on: { click: () => { opts.action.run(); n.remove(); } } }, opts.action.label)) : null);
    document.body.appendChild(n);
    n.addEventListener('click', (e) => { if (!e.target.closest('button')) n.remove(); });
    setTimeout(() => { n.style.transition = 'transform .35s ease, opacity .35s'; n.style.transform = 'translateX(120%)'; setTimeout(() => n.remove(), 400); }, opts.duration || 5000);
  };

  // ---------- interface size ----------
  // The desktop app scales the whole window like a browser's zoom and remembers the size. In a browser the page
  // can't change its zoom, but the browser's own Ctrl + / Ctrl − (⌘ on a Mac) do the same.
  let zoomHud = null, zoomHudTimer = 0, zoomHintAt = 0;
  function showZoom(z) {
    if (!zoomHud) zoomHud = h('div.zoom-hud');
    zoomHud.textContent = Math.round(z * 100) + '%';
    zoomHud.classList.remove('out');
    document.body.appendChild(zoomHud);
    clearTimeout(zoomHudTimer);
    zoomHudTimer = setTimeout(() => zoomHud.classList.add('out'), 1000);
  }
  /** Make everything bigger ('in'), smaller ('out') or actual size ('reset'). */
  IM.uiZoom = function (how) {
    if (IM.desktop && IM.desktop.zoom) {
      IM.desktop.zoom(how).then(showZoom, () => {});
      return;
    }
    if (Date.now() - zoomHintAt < 7000) return;
    zoomHintAt = Date.now();
    const mod = IM.isMac ? '⌘' : 'Ctrl';
    IM.notify('Make everything bigger or smaller', `In a browser, press ${mod} and + for bigger, ${mod} and − for smaller, ${mod} and 0 for actual size.`, { duration: 7000 });
  };

  // ---------- tooltips ----------
  let tipTimer = null, tipEl = null, tipTarget = null;
  function hideTip() { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } tipTarget = null; }
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t === tipTarget) return;
    hideTip();
    if (!t) return;
    tipTarget = t;
    tipTimer = setTimeout(() => {
      if (!document.body.contains(t)) return;
      tipEl = h('div.tooltip', t.getAttribute('data-tip'));
      document.body.appendChild(tipEl);
      const r = t.getBoundingClientRect();
      const tr = tipEl.getBoundingClientRect();
      tipEl.style.left = IM.clamp(r.left + r.width / 2 - tr.width / 2, 4, window.innerWidth - tr.width - 4) + 'px';
      tipEl.style.top = (r.bottom + 6 + tr.height > window.innerHeight ? r.top - tr.height - 6 : r.bottom + 6) + 'px';
    }, 800);
  });
  document.addEventListener('pointerdown', hideTip, true);

  // ---------- controls ----------
  IM.slider = function (o) {
    const input = h('input.mac', { type: 'range', min: o.min, max: o.max, step: o.step || 'any' });
    input.value = o.value;
    const upd = () => {
      const f = ((input.value - o.min) / (o.max - o.min)) * 100;
      input.style.setProperty('--fill', (o.centered ? 50 : f) + '%');
    };
    upd();
    if (o.neutral) input.classList.add('neutral');
    input.addEventListener('input', () => { upd(); o.onInput && o.onInput(parseFloat(input.value)); });
    input.addEventListener('change', () => { o.onChange && o.onChange(parseFloat(input.value)); });
    if (o.onStart) input.addEventListener('pointerdown', () => o.onStart());
    input.addEventListener('dblclick', () => { if (o.reset != null) { input.value = o.reset; upd(); o.onInput && o.onInput(o.reset); o.onChange && o.onChange(o.reset); } });
    input.setValue = (v) => { input.value = v; upd(); };
    if (o.width) input.style.width = o.width + 'px', input.style.flex = 'none';
    return input;
  };
  IM.checkbox = function (label, checked, onChange) {
    const input = h('input.mac', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', () => onChange && onChange(input.checked));
    return h('label.check', input, label);
  };
  IM.colorWell = function (value, onInput, onChange) {
    const sw = h('span', { style: { background: value } });
    const inp = h('input', { type: 'color', value: value });
    inp.addEventListener('input', () => { sw.style.background = inp.value; onInput && onInput(inp.value); });
    inp.addEventListener('change', () => { onChange && onChange(inp.value); });
    const well = h('label.color-well', sw, inp);
    well.setValue = (v) => { inp.value = v; sw.style.background = v; };
    return well;
  };
  /** Popup button that shows a menu of options [{label, value}] */
  IM.popupButton = function (options, value, onChange, opts) {
    opts = opts || {};
    const btn = h('button.popup-btn' + (opts.plain ? '.plain' : ''));
    const setLabel = (v) => {
      const o = options.find((x) => x && !x.separator && x.value === v);
      btn.textContent = opts.label ? opts.label : (o ? o.label : String(v));
    };
    setLabel(value);
    btn.value = value;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (Menu.isOpen()) { Menu.closeAll(); return; }
      const r = btn.getBoundingClientRect();
      const items = options.map((o) => o.separator ? { separator: true } : o.header ? { header: o.header } : ({
        label: o.label, checked: o.value === btn.value, disabled: o.disabled,
        action: () => { btn.value = o.value; setLabel(o.value); onChange && onChange(o.value); },
      }));
      const m = new Menu(items);
      m.showAt(r.left, r.bottom + 2);
    });
    btn.setValue = (v) => { btn.value = v; setLabel(v); };
    if (opts.width) btn.style.width = opts.width + 'px';
    return btn;
  };
  IM.segmented = function (options, value, onChange) {
    const wrap = h('div.tb-seg');
    const btns = options.map((o) => {
      const b = h('button', { on: { click: () => { set(o.value); onChange && onChange(o.value); } } }, o.icon ? IM.icon(o.icon, 14) : null, o.label || '');
      b._v = o.value;
      if (o.tip) b.setAttribute('data-tip', o.tip);
      return b;
    });
    btns.forEach((b) => wrap.appendChild(b));
    const set = (v) => { btns.forEach((b) => b.classList.toggle('active', b._v === v)); wrap.value = v; };
    set(value);
    wrap.setValue = set;
    return wrap;
  };
})(window.IM = window.IM || {});
