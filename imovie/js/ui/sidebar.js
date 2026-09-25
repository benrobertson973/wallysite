/* Libraries list (sidebar) */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;

  const Sidebar = {
    el: null, libOpen: true,
    init(host) {
      this.el = h('div.sidebar', { tabindex: 0 });
      host.appendChild(this.el);
      IM.lib.on('changed', () => this.render());
      IM.lib.on('media-added', () => this.render());
      IM.bus.on('libsel', () => this.render());
      IM.bus.on('tab', () => this.render());
      IM.bus.on('view', () => this.render());
      IM.bus.on('layout', () => this.render());
      IM.bus.on('project-opened', () => this.render());
      this.el.addEventListener('focus', () => this.el.classList.add('focused'));
      this.el.addEventListener('blur', () => this.el.classList.remove('focused'));
      this.el.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.sb-item')) return;
        IM.contextMenu(e, [{ label: 'New Event', action: () => IM.run('newEvent') }]);
      });
    },
    visible() {
      if (!IM.prefs.showLibraries) return false;
      if (app.view === 'editor' && (app.tab === 'titles' || app.tab === 'backgrounds' || app.tab === 'transitions')) return false;
      return app.view !== 'projects';
    },
    render() {
      const el = IM.clear(this.el);
      el.classList.toggle('hidden', !this.visible());
      if (!this.visible()) return;
      if (app.tab === 'audio' && app.view === 'editor') { this.renderAudio(el); return; }
      if (app.view === 'editor') {
        el.appendChild(this.item('project', 'Project Media', 'project-media', { cls: 'proj' }));
      }
      el.appendChild(h('div.sb-header', 'Libraries'));
      el.appendChild(this.item('photos', 'Photos Library', 'photos', { cls: 'photos' }));
      const libRow = this.item('library', 'iMovie Library', 'library', { cls: 'lib', disclosure: true, open: this.libOpen, noSelect: true });
      el.appendChild(libRow);
      if (this.libOpen) {
        const evs = IM.lib.events.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const ev of evs) {
          const row = this.item(ev.id, ev.name, 'star', { indent: 34, event: ev });
          el.appendChild(row);
        }
      }
      if (!app.libSel || (app.libSel !== 'project' && app.libSel !== 'photos' && !IM.lib.eventById(app.libSel))) {
        app.libSel = app.view === 'editor' ? 'project' : (IM.lib.events[0] && IM.lib.events[0].id);
      }
    },
    renderAudio(el) {
      el.appendChild(h('div.sb-header', 'Audio & Video'));
      if (!app.libSel || !String(app.libSel).startsWith('audio:')) app.libSel = 'audio:soundtracks';
      el.appendChild(this.item('audio:soundtracks', 'Soundtracks', 'music', { cls: 'audio-src' }));
      el.appendChild(this.item('audio:sfx', 'Sound Effects', 'waveform', { cls: 'audio-src' }));
      el.appendChild(this.item('audio:music', 'Music', 'music', { cls: 'audio-src' }));
    },
    item(id, name, icon, o) {
      o = o || {};
      const disc = o.disclosure ? h('span.sb-disc' + (o.open ? '.open' : ''), IM.icon('disclosure', 10)) : null;
      const row = h('div.sb-item' + (o.cls ? '.' + o.cls : '') + (app.libSel === id && !o.noSelect ? '.sel' : ''),
        disc, IM.icon(icon, 15), h('span.sb-name', name));
      if (o.indent) row.style.setProperty('--indent', o.indent + 'px');
      if (disc) disc.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.libOpen = !this.libOpen; this.render(); });
      row.addEventListener('pointerdown', () => {
        if (o.noSelect) { this.libOpen = !this.libOpen; this.render(); return; }
        app.libSel = id;
        IM.setBrowserSelection([]);
        IM.bus.emit('libsel');
      });
      if (o.event) {
        row.dataset.eventId = o.event.id;
        row.addEventListener('dblclick', () => this.rename(o.event.id));
        row.addEventListener('contextmenu', (e) => {
          IM.contextMenu(e, [
            { label: 'Rename Event', action: () => this.rename(o.event.id) },
            { label: 'New Event', action: () => IM.run('newEvent') },
            { separator: true },
            { label: 'Move Event to Trash', action: () => this.deleteEvent(o.event) },
          ]);
        });
      }
      return row;
    },
    rename(evId) {
      const row = this.el.querySelector(`[data-event-id="${evId}"]`);
      const ev = IM.lib.eventById(evId);
      if (!row || !ev) return;
      const nameEl = row.querySelector('.sb-name');
      const input = h('input.text-field', { type: 'text', value: ev.name });
      nameEl.replaceWith(input);
      input.focus(); input.select();
      const done = (ok) => {
        if (ok && input.value.trim()) IM.lib.renameEvent(evId, input.value.trim());
        else this.render();
      };
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      input.addEventListener('blur', () => done(true));
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
    },
    async deleteEvent(ev) {
      const items = IM.lib.mediaInEvent(ev.id);
      const used = items.filter((m) => IM.lib.usageCount(m.id) > 0);
      if (used.length) {
        await IM.alert({ title: 'The event can’t be deleted', message: `“${ev.name}” contains clips that are used in projects.` });
        return;
      }
      const r = await IM.alert({ title: `Move “${ev.name}” to the Trash?`, message: items.length ? `${IM.plural(items.length, 'clip')} will be deleted.` : 'This event is empty.', buttons: [{ label: 'Cancel', cancel: true }, { label: 'Move to Trash', primary: true }] });
      if (r !== 1) return;
      for (const p of IM.lib.projects.values()) if (p.eventId === ev.id) p.eventId = null;
      await IM.lib.deleteEvent(ev.id);
      if (app.libSel === ev.id) app.libSel = app.view === 'editor' ? 'project' : null;
      IM.bus.emit('libsel');
    },
    /** For drag & drop of browser clips onto events. */
    eventAt(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      const row = el && el.closest && el.closest('.sb-item');
      return row && row.dataset.eventId ? row : null;
    },
  };
  IM.sidebarUI = Sidebar;
})(window.IM = window.IM || {});
