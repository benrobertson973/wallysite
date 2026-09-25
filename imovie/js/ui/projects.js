/* Projects browser (the launch screen) */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;

  const ProjectsUI = {
    el: null, selected: null,
    init(host) {
      this.el = h('div.view.projects-view');
      host.appendChild(this.el);
      IM.lib.on('projects-changed', () => { if (app.view === 'projects') this.render(); });
      IM.bus.on('view', (v) => { this.el.classList.toggle('hidden', v !== 'projects'); if (v === 'projects') this.render(); });
      this.el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.proj-tile')) { this.selected = null; this.highlight(); } });
    },
    render() {
      const el = IM.clear(this.el);
      const list = IM.lib.projectList();
      const scroller = h('div.proj-scroll');
      el.appendChild(scroller);
      scroller.appendChild(h('div.proj-header', h('h1', 'Projects'), h('span.proj-count', list.length ? IM.plural(list.length, 'project') : '')));
      const grid = h('div.proj-grid');
      scroller.appendChild(grid);
      const create = h('div.proj-tile.create',
        h('div.proj-thumb', h('div.create-plus', IM.icon('plus', 34))),
        h('div.proj-name', 'Create New'));
      create.addEventListener('click', (e) => this.createMenu(create.querySelector('.proj-thumb')));
      grid.appendChild(create);
      for (const p of list) grid.appendChild(this.tile(p));
      this.highlight();
    },
    tile(p) {
      const L = IM.Project.layout(p);
      const thumb = h('div.proj-thumb');
      if (p.poster) thumb.appendChild(h('img', { src: p.poster, alt: '', draggable: false }));
      else thumb.appendChild(h('div.proj-empty', IM.icon('film', 30)));
      const more = h('button.proj-more', { 'data-tip': 'More' }, IM.icon('ellipsis', 14));
      thumb.appendChild(more);
      thumb.appendChild(h('div.proj-dur', IM.fmtTime(L.duration)));
      const t = h('div.proj-tile', thumb,
        h('div.proj-name', p.name),
        h('div.proj-meta', IM.fmtDate(p.modified || p.created)));
      t.dataset.id = p.id;
      t.addEventListener('pointerdown', () => { this.selected = p.id; this.highlight(); });
      t.addEventListener('dblclick', () => IM.openProject(p));
      more.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.selected = p.id; this.highlight(); this.moreMenu(p, more); });
      t.addEventListener('contextmenu', (e) => { this.selected = p.id; this.highlight(); IM.contextMenu(e, this.menuItems(p)); });
      return t;
    },
    highlight() { IM.$$('.proj-tile', this.el).forEach((t) => t.classList.toggle('selected', t.dataset.id === this.selected)); },
    menuItems(p) {
      return [
        { label: 'Open Project', action: () => IM.openProject(p) },
        { label: 'Share Project…', disabled: !p.clips.length, action: () => { IM.openProject(p); setTimeout(() => IM.share.open('file'), 50); } },
        { separator: true },
        { label: 'Rename Project…', action: () => this.rename(p) },
        { label: 'Duplicate Project', action: () => this.duplicate(p) },
        { separator: true },
        { label: 'Delete Project', action: () => this.remove(p) },
      ];
    },
    moreMenu(p, anchor) {
      IM.Menu.closeAll();
      const r = anchor.getBoundingClientRect();
      new IM.Menu(this.menuItems(p)).showAt(r.left, r.bottom + 4);
    },
    createMenu(anchor) {
      const opt = (icon, label, sub, fn) => {
        const b = h('button.create-opt', IM.icon(icon, 34), h('div.co-label', label), h('div.co-sub', sub));
        b.addEventListener('click', () => { IM.closePopovers(); fn(); });
        return b;
      };
      const content = h('div.create-pop',
        opt('movie', 'Movie', 'Combine video, photos, music, titles and effects', () => IM.newMovie()),
        opt('trailer', 'Trailer', 'Create a Hollywood-style movie trailer', () => IM.run('newTrailer')));
      IM.popover(anchor, content, { side: 'right' });
    },
    async rename(p) {
      const name = await IM.prompt({ title: 'Rename Project', message: 'Enter a new name for this project.', value: p.name, ok: 'Rename' });
      if (!name || !name.trim() || name.trim() === p.name) return;
      p.name = IM.lib.uniqueProjectName(name.trim());
      IM.lib.saveProjectNow(p);
      this.render();
    },
    duplicate(p) {
      const copy = IM.clone(Object.assign({}, p, { _layout: null }));
      copy.id = IM.uid('p');
      copy.name = IM.lib.uniqueProjectName(p.name + ' copy');
      copy.created = copy.modified = Date.now();
      IM.Project.upgrade(copy);
      IM.lib.addProject(copy);
      this.selected = copy.id;
      this.render();
    },
    async remove(p) {
      const r = await IM.alert({ title: `Delete “${p.name}”?`, message: 'The project will be deleted permanently. The media in your library won’t be deleted.', buttons: [{ label: 'Cancel', cancel: true }, { label: 'Delete', primary: true }] });
      if (r !== 1) return;
      await IM.lib.deleteProject(p.id);
      if (this.selected === p.id) this.selected = null;
      this.render();
    },
    deleteSelected() { const p = IM.lib.projects.get(this.selected); if (p) this.remove(p); },
  };
  IM.projectsUI = ProjectsUI;
})(window.IM = window.IM || {});
