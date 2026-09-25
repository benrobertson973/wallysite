/* Fake macOS menu bar with iMovie's menus + global keyboard shortcuts */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;

  // item helpers
  const I = (label, cmd, key, extra) => Object.assign({ label, cmd, key }, extra || {});
  const SEP = { separator: true };
  const DIS = (label, key) => ({ label, key, disabled: true });

  const MENUS = [
    {
      title: 'iMovie', app: true, items: [
        I('About iMovie', 'about'), SEP,
        I('Settings…', 'prefs', 'cmd+,'), SEP,
        { label: 'Services', submenu: [DIS('No Services Apply')] }, SEP,
        I('Hide iMovie', 'hide', 'cmd+h'), DIS('Hide Others', 'alt+cmd+h'), DIS('Show All'), SEP,
        I('Quit iMovie', 'quit', 'cmd+q'),
      ],
    },
    {
      title: 'File', items: [
        I('New Movie', 'newMovie', 'cmd+n'), I('New Trailer', 'newTrailer'),
        { label: 'Open Library', submenu: [{ label: 'iMovie Library', checked: true }, SEP, DIS('New…'), DIS('Other…')] },
        I('New Event', 'newEvent'), SEP,
        I('Import Media…', 'import', 'cmd+i'), I('Convert Trailer to Movie', 'convertTrailer'), SEP,
        { label: 'Share', submenu: [I('Email…', 'share:email'), I('YouTube & Facebook…', 'share:youtube'), I('Image…', 'share:image'), I('File…', 'share:file', 'cmd+e')] },
        SEP,
        I('Move to Trash', 'moveToTrash', 'cmd+delete'), SEP,
        DIS('Consolidate Library Media…'), DIS('Delete Render Files…'),
      ],
    },
    {
      title: 'Edit', items: [
        I('Undo', 'undo', 'cmd+z'), I('Redo', 'redo', 'shift+cmd+z'), SEP,
        I('Cut', 'cut', 'cmd+x'), I('Copy', 'copy', 'cmd+c'), I('Paste', 'paste', 'cmd+v'),
        {
          label: 'Paste Adjustments', submenu: [
            I('All', 'pasteAdj:all', 'alt+cmd+v'), SEP,
            I('Video Effect', 'pasteAdj:filter'), I('Audio Effect', 'pasteAdj:audioEffect'), I('Volume', 'pasteAdj:volume'), I('Speed', 'pasteAdj:speed'),
            I('Crop', 'pasteAdj:crop'), I('Color', 'pasteAdj:color'), I('Stabilization', 'pasteAdj:stabilization'), I('Video Overlay', 'pasteAdj:overlay'), I('Title Style', 'pasteAdj:titles'),
          ],
        },
        I('Delete', 'delete', 'delete'), SEP,
        I('Select All', 'selectAll', 'cmd+a'), I('Deselect All', 'deselectAll', 'shift+cmd+a'), SEP,
        I('Add Cross Dissolve', 'addCrossDissolve', 'cmd+t'), SEP,
        DIS('Start Dictation…'), DIS('Emoji & Symbols', 'ctrl+cmd+space'),
      ],
    },
    {
      title: 'Mark', items: [
        I('Favorite', 'favorite', 'f'), I('Reject', 'reject', 'delete', { hiddenKey: true }), I('Unmark', 'unmark', 'u'), SEP,
        I('Select Clip Range', 'selectClipRange', 'x'), I('Clear Selected Ranges', 'clearRanges', 'alt+x'),
      ],
    },
    {
      title: 'Modify', items: [
        I('Enhance', 'enhance'), SEP,
        I('Split Clip', 'split', 'cmd+b'), I('Join Clip', 'join'), I('Detach Audio', 'detachAudio', 'alt+cmd+b'), SEP,
        I('Add Freeze Frame', 'freezeFrame', 'alt+f'), SEP,
        { label: 'Slow Down', submenu: [I('50%', 'slow:0.5'), I('25%', 'slow:0.25'), I('10%', 'slow:0.1')] },
        { label: 'Speed Up', submenu: [I('2x', 'fast:2'), I('4x', 'fast:4'), I('8x', 'fast:8'), I('20x', 'fast:20')] },
        { label: 'Instant Replay', submenu: [I('50%', 'replay:0.5'), I('25%', 'replay:0.25'), I('10%', 'replay:0.1')] },
        { label: 'Rewind', submenu: [I('1x', 'rewind:1'), I('2x', 'rewind:2'), I('4x', 'rewind:4')] },
        I('Reverse Clip', 'reverse'),
        I('Reset Speed', 'resetSpeed'), SEP,
        I('Trim to Playhead', 'trimToPlayhead', 'alt+/'),
      ],
    },
    {
      title: 'View', items: [
        I('Play', 'play', 'space'), I('Play Selection', 'playSelection', '/'), I('Play from Beginning', 'playFromBeginning', '\\'),
        I('Play Full Screen', 'playFullScreen', 'shift+cmd+f'), I('Loop Playback', 'loop', 'cmd+l'), SEP,
        I('Snapping', 'snapping', 'n'), I('Skimming', 'skimming', 's'), I('Audio Skimming', 'audioSkimming', 'shift+s'), SEP,
        I('Zoom In', 'zoomIn', 'cmd+='), I('Zoom Out', 'zoomOut', 'cmd+-'), I('Zoom to Fit', 'zoomFit', 'shift+z'), SEP,
        I('Enter Full Screen', 'enterFullScreen', 'ctrl+cmd+f'),
      ],
    },
    {
      title: 'Window', items: [
        I('Minimize', 'minimize', 'cmd+m'), I('Zoom', 'zoomWindow'), SEP,
        I('Go to Projects', 'goProjects'), I('Go to Media', 'goMedia'), SEP,
        I('Show Clip Trimmer', 'clipTrimmer', 'cmd+\\'), I('Show Precision Editor', 'precisionEditor', 'cmd+/'), SEP,
        I('Record Voiceover', 'voiceover', 'v'), I('Show Audio Meters', 'meters'), SEP,
        {
          label: 'Content Library', submenu: [
            I('My Media', 'tab:media', 'cmd+1'), I('Audio & Video', 'tab:audio', 'cmd+2'), I('Titles', 'tab:titles', 'cmd+3'),
            I('Backgrounds', 'tab:backgrounds', 'cmd+4'), I('Transitions', 'tab:transitions', 'cmd+5'),
          ],
        },
        I('Hide Libraries', 'toggleLibraries'), SEP,
        DIS('Bring All to Front'), SEP, { label: 'iMovie', checked: true },
      ],
    },
    {
      title: 'Help', items: [
        { element: null, search: true }, I('iMovie Help', 'help'), I('Keyboard Shortcuts', 'shortcuts'), DIS('What’s New in iMovie'),
      ],
    },
  ];

  // Shortcuts that aren't shown in menus
  const HIDDEN_KEYS = [
    ['j', 'shuttleJ'], ['k', 'shuttleK'], ['l', 'shuttleL'],
    ['left', 'prevFrame'], ['right', 'nextFrame'], ['shift+left', 'prevFrames'], ['shift+right', 'nextFrames'],
    ['up', 'prevEdit'], ['down', 'nextEdit'], ['home', 'goStart'], ['end', 'goEnd'], ['fwddelete', 'delete'],
    ['e', 'append'], ['q', 'connect'], ['w', 'insert'], ['esc', 'escape'], ['return', 'playSelection'],
    ['cmd+[', 'rotateLeft'], ['cmd+]', 'rotateRight'], ['cmd+delete', 'moveToTrash'],
  ];

  function resolveItems(items) {
    return items.map((it) => {
      if (!it || it.separator || it.header) return it;
      if (it.search) {
        const inp = h('input.text-field', { type: 'search', placeholder: 'Search', style: { width: '100%' } });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { IM.Menu.closeAll(); IM.run('help'); } e.stopPropagation(); });
        const wrap = h('div.mi-search', h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('span', { style: { fontSize: '12px', color: '#aaa', whiteSpace: 'nowrap' } }, 'Search'), inp));
        wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
        return { element: wrap };
      }
      const out = { label: it.label, key: it.hiddenKey ? null : it.key, checked: it.checked };
      if (it.submenu) { out.submenu = () => resolveItems(it.submenu); return out; }
      if (it.disabled) { out.disabled = true; return out; }
      if (it.cmd) {
        const c = IM.commands[it.cmd];
        if (!c) { out.disabled = true; return out; }
        if (c.label) out.label = c.label();
        out.disabled = c.enabled ? !c.enabled() : false;
        if (c.checked) out.checked = c.checked();
        out.action = () => IM.run(it.cmd);
      }
      return out;
    });
  }

  const Menubar = {
    el: null, titles: [], open: -1, menu: null,
    init() {
      const el = IM.$('#menubar');
      this.el = el;
      const apple = h('div.mb-item.apple', IM.isMac ? '' : IM.icon('apple', 15));
      apple.addEventListener('pointerdown', (e) => { e.preventDefault(); this.toggleApple(apple); });
      el.appendChild(apple);
      MENUS.forEach((m, i) => {
        const t = h('div.mb-item' + (m.app ? '.app' : ''), m.title);
        t.addEventListener('pointerdown', (e) => { e.preventDefault(); if (this.open === i) this.close(); else this.show(i); });
        t.addEventListener('pointerenter', () => { if (this.open >= 0 && this.open !== i) this.show(i); });
        this.titles.push(t);
        el.appendChild(t);
      });
      el.appendChild(h('div.mb-spacer'));
      const clock = h('div.mb-item.mb-clock');
      const status = h('div.mb-status',
        h('div.mb-item', IM.icon('battery', 22)),
        h('div.mb-item', IM.icon('wifi', 15)),
        h('div.mb-item', IM.icon('spotlight', 14)),
        h('div.mb-item', IM.icon('control-center', 15)),
        clock);
      el.appendChild(status);
      const tick = () => {
        const d = new Date();
        clock.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '  ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      };
      tick(); setInterval(tick, 10000);
      document.addEventListener('keydown', (e) => this.onKey(e));
      // auto-reveal when in native fullscreen
      document.addEventListener('pointermove', (e) => {
        if (!document.body.classList.contains('native-fullscreen')) return;
        el.classList.toggle('peek', e.clientY < 6 || (this.open >= 0) || (e.clientY < 30 && el.classList.contains('peek')));
      });
      document.addEventListener('fullscreenchange', () => {
        document.body.classList.toggle('native-fullscreen', !!document.fullscreenElement && !(IM.viewerUI && IM.viewerUI.isFullscreen()));
      });
    },
    toggleApple(anchor) {
      if (this.open === 'apple') { this.close(); return; }
      this.close();
      this.open = 'apple';
      anchor.classList.add('open');
      const r = anchor.getBoundingClientRect();
      this.menu = new IM.Menu([
        { label: 'About This Mac', action: () => IM.run('about') }, { separator: true },
        { label: 'System Settings…', disabled: true }, { label: 'App Store…', disabled: true }, { separator: true },
        { label: 'Recent Items', submenu: [{ label: 'iMovie', disabled: true }] }, { separator: true },
        { label: 'Force Quit…', key: 'alt+cmd+esc', disabled: true }, { separator: true },
        { label: 'Sleep', disabled: true }, { label: 'Restart…', disabled: true }, { label: 'Shut Down…', disabled: true }, { separator: true },
        { label: 'Lock Screen', key: 'ctrl+cmd+q', disabled: true }, { label: 'Log Out…', key: 'shift+cmd+q', disabled: true },
      ], { onClose: () => { anchor.classList.remove('open'); this.open = -1; } });
      this.menu.showAt(r.left, r.bottom + 1);
    },
    show(i) {
      this.close();
      this.open = i;
      const t = this.titles[i];
      t.classList.add('open');
      const r = t.getBoundingClientRect();
      this.menu = new IM.Menu(resolveItems(MENUS[i].items), {
        onClose: () => { t.classList.remove('open'); if (this.open === i) this.open = -1; },
        onLeft: () => this.show((i - 1 + MENUS.length) % MENUS.length),
        onRight: () => this.show((i + 1) % MENUS.length),
      });
      this.menu.showAt(r.left, r.bottom + 1);
    },
    close() { IM.Menu.closeAll(); this.open = -1; this.titles.forEach((t) => t.classList.remove('open')); },
    flash(cmd) {
      const idx = MENUS.findIndex((m) => JSON.stringify(m.items).includes('"' + cmd + '"'));
      if (idx < 0) return;
      const t = this.titles[idx];
      t.classList.add('open');
      setTimeout(() => t.classList.remove('open'), 130);
    },
    keymap() {
      if (this._keymap) return this._keymap;
      const out = [];
      const walk = (items) => items.forEach((it) => {
        if (!it) return;
        if (it.submenu) walk(it.submenu);
        else if (it.key && it.cmd) out.push([it.key, it.cmd, !it.hiddenKey]);
      });
      MENUS.forEach((m) => walk(m.items));
      HIDDEN_KEYS.forEach(([k, c]) => out.push([k, c, false]));
      this._keymap = out;
      return out;
    },
    onKey(e) {
      if (IM.Menu.isOpen()) return;
      if (IM.hasSheet()) return;
      const typing = IM.isTyping(e);
      if (typing) {
        // let fields handle editing shortcuts; allow only a few global ones
        const k = IM.eventKey(e);
        const cmdDown = IM.isMac ? e.metaKey : e.ctrlKey;
        if (!cmdDown || ['a', 'c', 'v', 'x', 'z'].includes(k) || (e.target.closest && e.target.closest('.title-editor'))) {
          if (e.key === 'Escape') e.target.blur();
          return;
        }
      }
      // popovers take Escape
      if (e.key === 'Escape' && IM.hasPopover()) return;
      for (const [spec, cmd, visible] of this.keymap()) {
        if (!IM.matchShortcut(e, spec)) continue;
        if (cmd === 'delete' && e.repeat) { e.preventDefault(); return; }
        // "Delete" means Reject when the browser has focus
        let c = cmd;
        if (spec === 'delete' && cmd === 'reject') continue;
        if (!IM.commands[c]) continue;
        if (IM.commands[c].enabled && !IM.commands[c].enabled()) {
          if (visible || cmd === 'delete') { e.preventDefault(); }
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (visible && (IM.isMac ? e.metaKey : e.ctrlKey)) this.flash(c);
        IM.run(c);
        IM.bus.emit('command', c);
        return;
      }
    },
  };
  IM.Menubar = Menubar;
})(window.IM = window.IM || {});
