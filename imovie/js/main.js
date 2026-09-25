/* Bootstrap: build views, wire modules, splitters */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;

  function buildEditor(host) {
    const ed = h('div.view.editor-view.hidden');
    const upper = h('div.ed-upper');
    const lower = h('div.ed-lower');
    const hsplit = h('div.ed-hsplit');
    const vsplit = h('div.ed-vsplit');
    const left = h('div', { style: { flex: '1', display: 'flex', minWidth: '0', position: 'relative' } });
    upper.append(left, vsplit);
    ed.append(upper, hsplit, lower);
    host.appendChild(ed);

    IM.sidebarUI.init(left);
    const browserHost = h('div', { style: { flex: '1', display: 'flex', minWidth: '0', position: 'relative' } });
    left.appendChild(browserHost);
    IM.browserUI.init(browserHost);
    IM.contentUI.init(browserHost);
    IM.viewerUI.init(upper);
    IM.timelineUI.init(lower);
    IM.trailerUI.init(lower);

    // ---- splitters ----
    const applySizes = () => {
      const total = ed.clientHeight;
      if (!total) return;
      const upperH = IM.prefs.upperHeight ? IM.clamp(IM.prefs.upperHeight, 180, total - 150) : Math.round(total * 0.53);
      upper.style.height = (app.view === 'media' ? total : upperH) + 'px';
      const vw = IM.prefs.viewerWidth ? IM.clamp(IM.prefs.viewerWidth, 300, upper.clientWidth - 320) : Math.round(upper.clientWidth * 0.47);
      IM.viewerUI.el.style.width = vw + 'px';
    };
    hsplit.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const start = upper.clientHeight;
      IM.drag(e, (dx, dy) => { IM.prefs.upperHeight = IM.clamp(start + dy, 180, ed.clientHeight - 150); applySizes(); }, () => IM.savePrefs(), { threshold: 0 });
    });
    hsplit.addEventListener('dblclick', () => { IM.prefs.upperHeight = null; IM.savePrefs(); applySizes(); });
    vsplit.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const start = IM.viewerUI.el.clientWidth;
      IM.drag(e, (dx) => { IM.prefs.viewerWidth = IM.clamp(start - dx, 300, upper.clientWidth - 320); applySizes(); }, () => IM.savePrefs(), { threshold: 0 });
    });
    // viewer sits to the right of the split handle
    upper.appendChild(IM.viewerUI.el);
    new ResizeObserver(applySizes).observe(ed);
    IM.bus.on('view', (v) => {
      ed.classList.toggle('hidden', v === 'projects');
      ed.classList.toggle('media-mode', v === 'media');
      requestAnimationFrame(applySizes);
    });
    IM.bus.on('layout', () => requestAnimationFrame(applySizes));
    // focus tracking between browser and timeline
    upper.addEventListener('pointerdown', (e) => { if (e.target.closest('.browser-pane') || e.target.closest('.sidebar')) app.focus = 'browser'; }, true);
    lower.addEventListener('pointerdown', () => { app.focus = 'timeline'; }, true);
    return ed;
  }

  async function start() {
    const host = IM.$('#content');
    IM.app.player = new IM.Player();
    IM.app.player.loop = !!IM.prefs.loop;
    IM.app.player.skimming = IM.prefs.skimming !== false;
    IM.app.player.audioSkimming = !!IM.prefs.audioSkimming;
    IM.Menubar.init();
    IM.Toolbar.init();
    IM.projectsUI.init(host);
    buildEditor(host);
    await IM.lib.init();
    IM.AudioGen.registerAll();
    if (IM.prefs.bgRender === false) IM.BackgroundRender.enabled = false;
    IM.BackgroundRender.init();
    IM.bus.on('bg-render', (st) => IM.Toolbar.setBackground && IM.Toolbar.setBackground(st));
    IM.bus.on('storage-full', () => IM.alert({ title: 'Your browser storage is full', message: 'Some media couldn’t be saved. Free up disk space or delete unused events and projects.' }));
    IM.lib.on('projects-changed', () => {});
    IM.setView('projects');
    // persist on leave
    // a pinch or ctrl+wheel anywhere else must not zoom the whole app (the timeline zooms itself)
    window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('beforeunload', () => { if (app.project) { app.project.playhead = app.player.t; IM.lib.saveProjectNow(app.project); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && app.project) IM.lib.saveProjectNow(app.project); });
    window.addEventListener('blur', () => IM.$('#window').classList.add('inactive'));
    window.addEventListener('focus', () => IM.$('#window').classList.remove('inactive'));
    IM.ready = true;
    IM.bus.emit('ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.IM = window.IM || {});
