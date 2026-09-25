/* Window toolbar for each view */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;

  function traffic() {
    const x = '<svg viewBox="0 0 8 8"><path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" stroke-width="1.3"/></svg>';
    const m = '<svg viewBox="0 0 8 8"><path d="M1.2 4h5.6" stroke="currentColor" stroke-width="1.4"/></svg>';
    const f = '<svg viewBox="0 0 8 8"><path d="M1.6 3.6V1.6h2zM6.4 4.4v2h-2z" fill="currentColor"/></svg>';
    const close = h('div.tl.close', { html: x, 'data-tip': 'Close' });
    const min = h('div.tl.min', { html: m });
    const max = h('div.tl.max', { html: f });
    close.addEventListener('click', () => { if (app.view === 'editor') IM.closeProject(); else IM.run('quit'); });
    min.addEventListener('click', () => IM.run('minimize'));
    max.addEventListener('click', () => IM.run('enterFullScreen'));
    return h('div.traffic', close, min, max);
  }

  const TABS = [
    ['media', 'My Media'], ['audio', 'Audio & Video'], ['titles', 'Titles'], ['backgrounds', 'Backgrounds'], ['transitions', 'Transitions'],
  ];

  const Toolbar = {
    el: null,
    init() {
      this.el = IM.$('#toolbar');
      IM.bus.on('view', () => this.render());
      IM.bus.on('tab', () => this.updateTabs());
      IM.bus.on('project-changed', () => this.updateTitle());
      IM.bus.on('export-progress', (p) => { this.setProgress(p); this.layoutTitle(); });
      if (window.ResizeObserver) new ResizeObserver(() => this.layoutTitle()).observe(this.el);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.layoutTitle());
      else window.addEventListener('resize', () => this.layoutTitle());
      this.render();
    },
    render() {
      const el = IM.clear(this.el);
      el.appendChild(traffic());
      this.progress = null;
      if (app.view === 'projects') {
        el.appendChild(h('div.tb-center', IM.segmented([{ value: 'media', label: 'Media' }, { value: 'projects', label: 'Projects' }], 'projects', (v) => { if (v === 'media') IM.run('goMedia'); })));
        el.appendChild(h('div.tb-spacer'));
      } else if (app.view === 'media') {
        const imp = h('button.tb-btn.bordered', { 'data-tip': 'Import Media', on: { click: () => IM.run('import') } }, IM.icon('import', 17));
        el.appendChild(imp);
        el.appendChild(h('div.tb-center', IM.segmented([{ value: 'media', label: 'Media' }, { value: 'projects', label: 'Projects' }], 'media', (v) => { if (v === 'projects') IM.setView('projects'); })));
        el.appendChild(h('div.tb-spacer'));
      } else {
        const back = h('button.tb-btn.bordered.tb-back', { on: { click: () => IM.closeProject() } }, IM.icon('chevron-left', 15), 'Projects');
        const imp = h('button.tb-btn.bordered', { 'data-tip': 'Import Media', on: { click: () => IM.run('import') } }, IM.icon('import', 17));
        const tabs = this.tabsEl = h('div.tb-tabs');
        this.tabBtns = TABS.map(([id, label]) => {
          const b = h('button.tb-tab', { on: { click: () => IM.run('tab:' + id) } }, label);
          b._id = id;
          tabs.appendChild(b);
          return b;
        });
        this.titleEl = h('div.tb-title');
        this.titleEl.style.pointerEvents = 'auto';
        this.titleEl.addEventListener('dblclick', () => this.renameProject());
        el.append(back, imp, tabs, this.titleEl, h('div.tb-spacer'));
        this.progressWrap = h('div', { style: { display: 'flex', alignItems: 'center' } });
        el.appendChild(this.progressWrap);
        const share = h('button.tb-btn.bordered', { 'data-tip': 'Share', on: { click: (e) => IM.share.menu(e.currentTarget) } }, IM.icon('share', 17));
        this.shareBtn = share;
        el.appendChild(share);
        this.updateTabs();
        this.updateTitle();
      }
    },
    /** Centre the project name in the window when it fits; otherwise keep it between the tabs and Share, shortened. */
    layoutTitle() {
      const t = this.titleEl;
      if (!t || !t.isConnected || !this.tabsEl) return;
      const bar = this.el.getBoundingClientRect();
      const left = this.tabsEl.getBoundingClientRect().right - bar.left + 14;
      const rightEls = [this.progressWrap, this.shareBtn].filter(Boolean).map((e) => e.getBoundingClientRect().left - bar.left);
      const right = (rightEls.length ? Math.min(...rightEls) : bar.width) - 14;
      t.style.transform = 'none'; t.style.left = '0px'; t.style.width = 'auto'; t.style.maxWidth = 'none';
      const natural = Math.ceil(t.scrollWidth) + 1;
      const w = Math.max(0, Math.min(natural, right - left));
      const x = Math.max(left, Math.min(bar.width / 2 - w / 2, right - w));
      t.style.left = Math.round(x) + 'px';
      t.style.width = Math.round(w) + 'px';
      t.style.visibility = w < 24 ? 'hidden' : '';
    },
    updateTabs() {
      if (!this.tabBtns) return;
      this.tabBtns.forEach((b) => b.classList.toggle('active', b._id === app.tab));
    },
    updateTitle() {
      if (this.titleEl && app.project) this.titleEl.textContent = app.project.name;
      this.layoutTitle();
    },
    async renameProject() {
      const p = app.project;
      if (!p) return;
      const name = await IM.prompt({ title: 'Rename Project', message: 'Enter a new name for this project.', value: p.name, ok: 'Rename' });
      if (name && name.trim()) {
        p.name = IM.lib.uniqueProjectName(name.trim()) === name.trim() || name.trim() === p.name ? name.trim() : IM.lib.uniqueProjectName(name.trim());
        IM.lib.saveProject(p);
        this.updateTitle();
        IM.lib.emit('projects-changed');
      }
    },
    /** Small gray ring while movie sections are rendered in the background. */
    setBackground(st) {
      if (!this.progressWrap || app.view !== 'editor') return;
      if (IM.share && IM.share.job) return;
      let el = this.bgEl;
      if (!st || !st.rendering || !st.total) { if (el) { el.remove(); this.bgEl = null; } return; }
      const f = st.done / st.total;
      const r = 7, c = 2 * Math.PI * r;
      const svg = `<svg class="tb-progress" viewBox="0 0 22 22" style="width:18px;height:18px"><circle cx="11" cy="11" r="${r}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2.2"/><circle cx="11" cy="11" r="${r}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 11 11)"/></svg>`;
      if (!el) {
        el = this.bgEl = h('div.tb-btn', { style: { minWidth: '26px', padding: '0 4px' } });
        this.progressWrap.appendChild(el);
      }
      el.innerHTML = svg;
      el.setAttribute('data-tip', `Background rendering: ${st.done} of ${st.total} sections ready`);
    },
    setProgress(p) {
      if (!this.progressWrap) return;
      IM.clear(this.progressWrap);
      this.bgEl = null;
      if (p == null || p >= 1) return;
      const r = 8, c = 2 * Math.PI * r;
      const svg = `<svg class="tb-progress" viewBox="0 0 22 22"><circle cx="11" cy="11" r="${r}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2.5"/><circle cx="11" cy="11" r="${r}" fill="none" stroke="#0a84ff" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 11 11)"/></svg>`;
      const b = h('button.tb-btn', { html: svg, 'data-tip': 'Sharing: ' + Math.round(p * 100) + '%', on: { click: (e) => IM.share.progressPopover(e.currentTarget) } });
      this.progressWrap.appendChild(b);
    },
  };
  IM.Toolbar = Toolbar;
})(window.IM = window.IM || {});
