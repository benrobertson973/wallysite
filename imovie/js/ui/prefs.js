/* Settings window, About, Help, Keyboard shortcuts, Themes */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;

  const PrefsUI = {
    open() {
      const P = IM.prefs;
      const tc = IM.checkbox('Display time as HH:MM:SS:FF', !!P.timecodeFrames, (v) => { P.timecodeFrames = v; IM.savePrefs(); IM.bus.emit('prefs'); if (IM.timelineUI) IM.timelineUI.updateTime(); });
      const place = IM.popupButton([{ value: 'kenburns', label: 'Ken Burns' }, { value: 'fill', label: 'Crop to Fill' }, { value: 'fit', label: 'Fit in Frame' }], P.photoPlacement, (v) => { P.photoPlacement = v; IM.savePrefs(); }, { width: 150 });
      const photoDur = IM.popupButton([2, 3, 4, 5, 6, 8, 10].map((s) => ({ value: s, label: s + ' seconds' })), P.photoDuration || 4, (v) => { P.photoDuration = v; IM.savePrefs(); }, { width: 150 });
      const trDur = IM.popupButton([0.5, 1, 1.5, 2, 3].map((s) => ({ value: s, label: s + (s === 1 ? ' second' : ' seconds') })), P.transitionDuration || 1, (v) => { P.transitionDuration = v; IM.savePrefs(); }, { width: 150 });
      const bg = IM.checkbox('Render in the background while idle', IM.BackgroundRender.enabled, (v) => { IM.BackgroundRender.enabled = v; P.bgRender = v; IM.savePrefs(); if (v) IM.BackgroundRender.kick(); });
      const cacheInfo = h('span', { style: { color: '#9a9a9a' } }, IM.fmtBytes(IM.RenderCache.totalBytes()));
      const clearBtn = h('button.btn.small', { on: { click: async () => { await IM.RenderCache.clear(); cacheInfo.textContent = IM.fmtBytes(0); IM.BackgroundRender.updateStatus(); } } }, 'Delete Render Files');
      const body = h('div.prefs-win',
        h('div.prefs-tabs', h('button.tb-tab.active', 'General')),
        h('div.prefs-body',
          h('label', 'Time display:'), tc,
          h('label', 'Photo placement:'), place,
          h('label', 'Photo duration:'), photoDur,
          h('label', 'Transition duration:'), trDur,
          h('label', 'Rendering:'), bg,
          h('label', 'Render files:'), h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, cacheInfo, clearBtn),
          h('label', 'Library:'), h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
            h('span', { style: { color: '#9a9a9a' } }, IM.DB.persistent ? 'Saved in this browser' : 'Not saved (private browsing?)'),
            h('button.btn.small', { on: { click: () => resetLibrary() } }, 'Reset Library…'))),
        h('div.sheet-footer', h('button.btn.primary', { on: { click: () => sheet.close() } }, 'Done')));
      const sheet = IM.sheet(body, { floating: true, closeOnBackdrop: true });
    },
  };
  async function resetLibrary() {
    const r = await IM.alert({ title: 'Reset the iMovie Library?', message: 'All projects, events and imported media stored in this browser will be deleted. This can’t be undone.', buttons: [{ label: 'Cancel', cancel: true }, { label: 'Delete Everything', primary: true }] });
    if (r !== 1) return;
    await IM.DB.clearAll();
    location.reload();
  }
  IM.prefsUI = PrefsUI;

  IM.showAbout = function () {
    const body = h('div.about',
      h('div.app-icon'),
      h('h2', 'iMovie'),
      h('div.ver', 'Version 10.4 (web)'),
      h('div.fine', 'A browser-based movie editor modeled on iMovie for Mac. Everything runs locally in your browser; your media never leaves this computer.', h('br'), h('br'), 'Not affiliated with or endorsed by Apple Inc. Media engine: Mediabunny (MPL-2.0).'),
      h('div', { style: { marginTop: '16px' } }, h('button.btn', { on: { click: () => s.close() } }, 'OK')));
    const s = IM.sheet(body, { floating: true, closeOnBackdrop: true });
  };

  const SHORTCUTS = [
    ['Playback', [['Space', 'Play or pause'], ['/', 'Play selection'], ['\\', 'Play from beginning'], ['⇧⌘F', 'Play full screen'], ['⌘L', 'Loop playback'], ['J / K / L', 'Play backward / stop / play forward (press again to go faster)'], ['← / →', 'Move one frame'], ['↑ / ↓', 'Previous / next clip'], ['Home / End', 'Go to beginning / end']]],
    ['Editing', [['E', 'Add selection to the end of the movie'], ['W', 'Insert at the playhead'], ['Q', 'Connect (cutaway) at the playhead'], ['⌘B', 'Split clip'], ['⌥⌘B', 'Detach audio'], ['⌥F', 'Add freeze frame'], ['⌘T', 'Add cross dissolve'], ['⌥/', 'Trim to playhead'], ['⌫', 'Delete selection / reject in browser'], ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['⌘C / ⌘X / ⌘V', 'Copy / cut / paste'], ['⌥⌘V', 'Paste all adjustments'], ['R + drag', 'Select a range in a clip'], ['⌥ + drag', 'Duplicate while dragging']]],
    ['Marking', [['F', 'Favorite'], ['U', 'Unmark'], ['X', 'Select entire clip'], ['⌥X', 'Clear selected ranges']]],
    ['View', [['⌘= / ⌘−', 'Zoom timeline in / out'], ['⇧Z', 'Zoom to fit'], ['N', 'Snapping'], ['S', 'Skimming'], ['⇧S', 'Audio skimming'], ['⌘\\', 'Clip trimmer'], ['⌘/', 'Precision editor'], ['V', 'Record voiceover'], ['⌘1 … ⌘5', 'My Media, Audio & Video, Titles, Backgrounds, Transitions'], ['⌃⌘F', 'Enter full screen']]],
    ['Library & sharing', [['⌘N', 'New movie'], ['⌘I', 'Import media'], ['⌘E', 'Share file'], ['⌘⌫', 'Move to Trash'], ['⌘,', 'Settings']]],
  ];
  function helpWindow(title, content) {
    const s = IM.sheet(h('div.help-win', h('div.import-top', h('b', title), h('div', { style: { flex: 1 } }), h('button.btn.small', { on: { click: () => s.close() } }, 'Done')), h('div.help-body', content)), { floating: true, closeOnBackdrop: true });
    return s;
  }
  IM.showShortcuts = function () {
    const out = [];
    for (const [sec, rows] of SHORTCUTS) {
      out.push(h('h3', sec));
      out.push(h('table', rows.map(([k, d]) => h('tr', h('td.k', k), h('td', d)))));
    }
    helpWindow('Keyboard Shortcuts', out);
  };
  IM.showHelp = function () {
    helpWindow('iMovie Help', [
      h('h3', 'Getting started'),
      h('p', 'Click Create New in the Projects browser and choose Movie. Click Import (⌘I) to bring in video, photos and audio, or drag files from your desktop onto the window.'),
      h('h3', 'Editing on the timeline'),
      h('p', 'Drag clips from the browser to the timeline. Drop between clips to insert, above a clip to add a cutaway, on a clip to replace it, or into the background music well at the bottom to add music. Drag a clip’s edge to trim it; drag the horizontal line across the waveform to change its volume, and the gray dots to fade the audio in or out. Press ⌘B to split a clip at the playhead.'),
      h('h3', 'Titles, backgrounds and transitions'),
      h('p', 'Choose Titles, Backgrounds or Transitions above the browser. Skim across a thumbnail to preview it, then drag it to the timeline. Double-click a title in the viewer to edit its text.'),
      h('h3', 'Adjustments'),
      h('p', 'Select a clip and use the buttons above the viewer to change color balance, color correction, cropping and Ken Burns, stabilization, volume, noise reduction, speed, filters and video overlays (cutaway, green/blue screen, split screen and picture in picture).'),
      h('h3', 'Sharing'),
      h('p', 'Click Share in the toolbar and choose File to export an MP4 movie. While you edit, iMovie renders your movie in the background so exporting is fast; every export is checked frame by frame against your project.'),
      h('p', h('button.btn', { on: { click: () => IM.showShortcuts() } }, 'Show Keyboard Shortcuts')),
    ]);
  };

  // ------------------------------------------------------------------ themes
  const THEMES = [
    { id: null, name: 'No Theme', colors: ['#2b2b2b', '#111'] },
    { id: 'modern', name: 'Modern', colors: ['#e9e9e9', '#8a8a8a'], title: 'line', transition: 'slide-left', font: 'Avenir Next', color: '#ffffff' },
    { id: 'bright', name: 'Bright', colors: ['#ffd84d', '#ff8a3d'], title: 'popup', transition: 'fade-white', font: 'Futura', color: '#ffffff' },
    { id: 'neon', name: 'Neon', colors: ['#ff2fd1', '#2f6bff'], title: 'prism', transition: 'cross-blur', font: 'Futura', color: '#ffffff' },
    { id: 'playful', name: 'Playful', colors: ['#7ed957', '#27a7e8'], title: 'boogie-lights', transition: 'spin-in', font: 'Marker Felt', color: '#ffffff' },
    { id: 'travel', name: 'Travel', colors: ['#f2c14e', '#3c6e71'], title: 'paper', transition: 'doorway', font: 'American Typewriter', color: '#2b2b2b' },
    { id: 'simple', name: 'Simple', colors: ['#ffffff', '#d7d7d7'], title: 'standard', transition: 'cross-dissolve', font: 'Helvetica Neue', color: '#ffffff' },
    { id: 'news', name: 'News', colors: ['#d7263d', '#1b1b3a'], title: 'ticker', transition: 'wipe-left', font: 'Helvetica Neue', color: '#ffffff' },
    { id: 'sports', name: 'Sports', colors: ['#0b6e4f', '#f6ae2d'], title: 'soft-bar-black', transition: 'swap', font: 'Impact', color: '#ffffff' },
    { id: 'bulletin', name: 'Bulletin Board', colors: ['#c89f6a', '#7a5230'], title: 'paper', transition: 'puzzle-right', font: 'Marker Felt', color: '#2b2b2b' },
    { id: 'comic', name: 'Comic Book', colors: ['#ffde03', '#e63946'], title: 'popup-lower', transition: 'page-curl-left', font: 'Chalkboard', color: '#ffffff' },
    { id: 'scrapbook', name: 'Scrapbook', colors: ['#f4e1d2', '#a26769'], title: 'paper', transition: 'page-curl-right', font: 'Noteworthy', color: '#2b2b2b' },
    { id: 'filmstrip', name: 'Filmstrip', colors: ['#222', '#555'], title: 'formal', transition: 'mosaic', font: 'Didot', color: '#ffffff' },
    { id: 'photo-album', name: 'Photo Album', colors: ['#6b4226', '#d9a066'], title: 'formal', transition: 'page-curl-left', font: 'Baskerville', color: '#ffffff' },
  ];
  IM.Themes = { list: THEMES, get: (id) => THEMES.find((t) => t.id === id) };
  IM.themes = {
    /** "Automatic content": the theme adds its titles and transitions (turning it off removes them). */
    setAutoContent(on) {
      IM.edit('Automatic Content', (pp) => { pp.settings.autoContent = !!on; IM.themes.applyTo(pp, pp.settings.theme); });
    },
    chooser() {
      const p = app.project;
      if (!p) return;
      let sel = p.settings.theme || null;
      const grid = h('div.theme-grid');
      const cells = THEMES.map((t) => {
        const art = h('div.art', { style: { background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`, color: t.id === 'simple' ? '#333' : '#fff', fontFamily: t.font ? IM.fontStack(t.font) : '' } }, t.id ? t.name : '');
        const c = h('div.theme-cell' + (sel === t.id ? '.sel' : ''), art, h('div', t.name));
        c.addEventListener('click', () => { sel = t.id; cells.forEach((x) => x.classList.remove('sel')); c.classList.add('sel'); });
        c.addEventListener('dblclick', () => { apply(); });
        grid.appendChild(c);
        return c;
      });
      const apply = () => {
        s.close();
        IM.themes.apply(sel);
      };
      const s = IM.sheet(h('div', h('div', { style: { padding: '16px 20px 0', fontWeight: 700 } }, 'Themes'), grid,
        h('div.sheet-footer', h('button.btn', { on: { click: () => s.close() } }, 'Cancel'), h('button.btn.primary', { on: { click: apply } }, 'Change'))), { floating: true });
    },
    apply(id) {
      IM.edit(id ? 'Set Theme' : 'Remove Theme', (p) => IM.themes.applyTo(p, id));
    },
    /** Set theme `id` on project p (inside an edit), replacing any automatic content of the previous theme. */
    applyTo(p, id) {
      const t = IM.Themes.get(id);
      p.settings.theme = id;
      // remove automatic theme content (added by a previous theme or a previous application)
      p.connected = p.connected.filter((c) => !c._theme);
      p.clips.forEach((c) => { if (c.transition && c.transition._theme) c.transition = null; });
      if (!t || !t.id || !p.clips.length || p.settings.autoContent === false) { Pr.invalidate(p); return; }
      // theme transitions between clips
      p.clips.forEach((c, i) => { if (i < p.clips.length - 1 && !c.transition) c.transition = { type: t.transition, dur: 1, _theme: true }; });
      Pr.invalidate(p);
      // opening title and closing credits
      const open = Pr.makeTitle(t.title, { text: [p.name, ''], font: t.font, color: t.color });
      open._theme = true;
      Pr.connect(p, [open], 0, 3);
      const L = Pr.layout(p);
      const endT = Math.max(0, L.duration - 3);
      const close = Pr.makeTitle('scrolling-credits', { font: t.font });
      close.srcOut = Math.min(8, Math.max(2, L.duration - endT));
      close._theme = true;
      if (L.duration > 6) Pr.connect(p, [close], endT, 3);
    },
  };
})(window.IM = window.IM || {});
