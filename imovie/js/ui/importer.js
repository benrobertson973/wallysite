/* Import window: import from this computer (files / folders / drag & drop) or record from the camera */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;

  const Importer = {
    rec: null,
    /** Target event for imports given the current context. */
    defaultEvent() {
      if (app.view === 'editor' && app.project) {
        if (app.libSel && IM.lib.eventById(app.libSel)) return app.libSel;
        return app.project.eventId;
      }
      if (app.libSel && IM.lib.eventById(app.libSel)) return app.libSel;
      return IM.lib.events[0] && IM.lib.events[0].id;
    },
    async importFiles(files, eventId) {
      eventId = eventId || this.defaultEvent();
      const list = Array.from(files).filter((f) => IM.mediaTypeOf(f));
      if (!list.length) return [];
      IM.bus.emit('importing', list.length);
      const items = await IM.lib.importFiles(list, eventId);
      if (items.length) {
        if (app.view === 'editor' && app.tab !== 'media') { app.tab = 'media'; IM.bus.emit('tab', 'media'); }
        if (app.view !== 'editor' || (app.libSel !== 'project' && app.libSel !== eventId)) { app.libSel = app.view === 'editor' ? 'project' : eventId; IM.bus.emit('libsel'); }
        IM.setBrowserSelection([]);
      }
      return items;
    },
    open() {
      if (this.sheet) return;
      this.files = [];
      this.selected = new Set();
      const evOptions = () => IM.lib.events.map((e) => ({ value: e.id, label: e.name })).concat([{ separator: true }, { value: '__new', label: 'New Event…' }]);
      this.eventId = this.defaultEvent();
      const onEvent = async (v) => {
        if (v === '__new') {
          const name = await IM.prompt({ title: 'New Event', message: 'Name the new event.', value: IM.fmtDate(Date.now(), 'event'), ok: 'Create' });
          if (name && name.trim()) { const ev = IM.lib.createEvent(name.trim()); this.eventId = ev.id; }
          IM.clear(evWrap).appendChild(IM.popupButton(evOptions(), this.eventId, onEvent, { width: 190 }));
          return;
        }
        this.eventId = v;
      };
      const evBtn = IM.popupButton(evOptions(), this.eventId, onEvent, { width: 190 });
      const evWrap = h('span', evBtn);
      this.side = h('div.import-side');
      this.content = h('div.import-content');
      this.importBtn = h('button.btn.primary', { disabled: true, on: { click: () => this.doImport() } }, 'Import All');
      const closeBtn = h('button.btn', { on: { click: () => this.close() } }, 'Close');
      const win = h('div.import-win',
        h('div.import-top', h('b', 'Import'), h('div', { style: { flex: 1 } }), h('span', { style: { color: '#bbb', fontSize: '12px' } }, 'Import to:'), evWrap),
        h('div.import-main', this.side, this.content),
        h('div.import-bottom', closeBtn, h('div', { style: { flex: 1 } }), this.countEl = h('span', { style: { color: '#9a9a9a', fontSize: '12px' } }), this.importBtn));
      this.sheet = IM.sheet(win, { onClose: () => { this.stopCamera(); this.sheet = null; }, noFocus: true });
      this.buildSide();
      this.select('computer');
    },
    close() { if (this.sheet) this.sheet.close(); },
    buildSide() {
      const s = IM.clear(this.side);
      const item = (id, label, icon) => {
        const row = h('div.sb-item', IM.icon(icon, 15), h('span.sb-name', label));
        row.dataset.src = id;
        row.addEventListener('click', () => this.select(id));
        return row;
      };
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        s.appendChild(h('div.sb-header', 'Cameras'));
        s.appendChild(item('camera', 'FaceTime HD Camera', 'camera'));
      }
      s.appendChild(h('div.sb-header', 'Devices'));
      s.appendChild(item('computer', 'This Computer', 'desktop'));
      s.appendChild(h('div.sb-header', 'Favorites'));
      s.appendChild(item('folder', 'Choose Folder…', 'folder'));
      s.appendChild(item('movies', 'Movies', 'film'));
      s.appendChild(item('pictures', 'Pictures', 'photo'));
      s.appendChild(item('music', 'Music', 'music'));
    },
    select(src) {
      IM.$$('.sb-item', this.side).forEach((r) => r.classList.toggle('sel', r.dataset.src === src));
      this.stopCamera();
      this.src = src;
      if (src === 'camera') { this.showCamera(); return; }
      if (src === 'folder') { this.chooseFolder(); return; }
      this.showFiles(src);
    },
    showFiles(src) {
      const c = IM.clear(this.content);
      const accept = src === 'pictures' ? 'image/*' : src === 'music' ? 'audio/*' : src === 'movies' ? 'video/*' : 'video/*,audio/*,image/*';
      const input = h('input', { type: 'file', multiple: true, accept, style: { display: 'none' } });
      input.addEventListener('change', () => this.addFiles(input.files));
      const drop = h('div.import-drop',
        IM.icon('import', 44),
        h('div', { style: { fontSize: '15px', color: '#ddd', fontWeight: 600 } }, 'Drag video, photo and audio files here'),
        h('div', 'or'),
        h('button.btn', { on: { click: () => input.click() } }, 'Choose Files…'),
        input);
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); }));
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); this.addFiles(e.dataTransfer.files); });
      this.grid = h('div.import-files');
      c.append(this.files.length ? this.grid : drop);
      if (this.files.length) this.renderFiles();
      this.dropEl = drop; this.input = input;
      this.updateButton();
    },
    async chooseFolder() {
      if (!window.showDirectoryPicker) { this.showFiles('computer'); this.input && this.input.click(); return; }
      try {
        const dir = await window.showDirectoryPicker({ mode: 'read' });
        const files = [];
        for await (const entry of dir.values()) {
          if (entry.kind === 'file') { const f = await entry.getFile(); if (IM.mediaTypeOf(f)) files.push(f); }
        }
        this.files = []; this.selected.clear();
        this.addFiles(files);
      } catch (e) { this.showFiles('computer'); }
    },
    addFiles(list) {
      const arr = Array.from(list || []).filter((f) => IM.mediaTypeOf(f));
      if (!arr.length) return;
      for (const f of arr) { this.files.push(f); }
      IM.clear(this.content);
      this.grid = h('div.import-files');
      const more = h('div', { style: { padding: '8px 14px', display: 'flex', gap: '8px', borderBottom: '1px solid #111' } },
        h('button.btn.small', { on: { click: () => this.input.click() } }, 'Add More…'),
        h('button.btn.small', { on: { click: () => { this.selected = new Set(this.files.map((_, i) => i)); this.renderFiles(); } } }, 'Select All'),
        h('button.btn.small', { on: { click: () => { this.selected.clear(); this.renderFiles(); } } }, 'Deselect'));
      this.content.append(more, this.grid, this.input);
      this.renderFiles();
    },
    renderFiles() {
      const g = IM.clear(this.grid);
      this.files.forEach((f, i) => {
        const kind = IM.mediaTypeOf(f);
        const th = h('div.th');
        const url = URL.createObjectURL(f);
        if (kind === 'image') th.appendChild(h('img', { src: url }));
        else if (kind === 'video') { const v = h('video', { src: url + '#t=0.5', muted: true, preload: 'metadata' }); v.muted = true; th.appendChild(v); }
        else th.appendChild(IM.icon('music', 30));
        const cell = h('div.imp-file' + (this.selected.has(i) ? '.sel' : ''), th, h('div.nm', f.name), h('div', { style: { color: '#888' } }, IM.fmtBytes(f.size)));
        cell.addEventListener('click', (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) { if (this.selected.has(i)) this.selected.delete(i); else this.selected.add(i); }
          else { this.selected = new Set([i]); }
          this.renderFiles();
        });
        cell.addEventListener('dblclick', () => { this.selected = new Set([i]); this.doImport(); });
        g.appendChild(cell);
      });
      this.updateButton();
    },
    updateButton() {
      const n = this.selected.size;
      this.importBtn.textContent = n ? 'Import Selected' : 'Import All';
      this.importBtn.disabled = !this.files.length;
      this.countEl.textContent = this.files.length ? `${IM.plural(this.files.length, 'item')}${n ? ', ' + n + ' selected' : ''}` : '';
    },
    async doImport() {
      const list = this.selected.size ? this.files.filter((_, i) => this.selected.has(i)) : this.files;
      if (!list.length) return;
      this.importBtn.disabled = true;
      this.importBtn.textContent = 'Importing…';
      const ev = this.eventId;
      this.close();
      await this.importFiles(list, ev);
    },
    // ------------------------------------------------------------------ camera
    async showCamera() {
      const c = IM.clear(this.content);
      const video = h('video', { autoplay: true, playsinline: true, muted: true });
      video.muted = true;
      const time = h('div.cam-time', '0:00');
      const rec = h('button.cam-rec', { 'data-tip': 'Record' }, IM.icon('record', 58));
      const stage = h('div.cam-stage', video, time, rec);
      c.appendChild(stage);
      this.importBtn.disabled = true;
      this.countEl.textContent = 'Recordings are added to the event as you stop recording.';
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
      } catch (e) {
        IM.clear(stage).appendChild(h('div', { style: { color: '#aaa', padding: '30px', textAlign: 'center' } }, 'The camera isn’t available. Allow camera and microphone access for this page and try again.'));
        return;
      }
      video.srcObject = this.stream;
      let started = 0, timer = null;
      rec.addEventListener('click', () => {
        if (this.rec) {
          this.rec.stop();
          return;
        }
        const mime = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
        const mr = new MediaRecorder(this.stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
        const chunks = [];
        mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        mr.onstop = async () => {
          clearInterval(timer);
          this.rec = null;
          time.classList.remove('rec');
          IM.clear(rec).appendChild(IM.icon('record', 58));
          const type = (mr.mimeType || 'video/webm').split(';')[0];
          const blob = new Blob(chunks, { type });
          const name = 'Camera Recording ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
          try { await IM.lib.addBlob(blob, name, 'video', this.eventId, { source: 'camera' }); } catch (e) { IM.notify('Recording Failed', 'The recording couldn’t be added.'); }
        };
        mr.start(500);
        this.rec = mr;
        started = performance.now();
        time.classList.add('rec');
        IM.clear(rec).appendChild(IM.icon('stop-record', 58));
        timer = setInterval(() => { time.textContent = IM.fmtTime((performance.now() - started) / 1000); }, 250);
      });
    },
    stopCamera() {
      if (this.rec) { try { this.rec.stop(); } catch (e) { /* */ } }
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    },
  };
  IM.importer = Importer;

  // ---------------------------------------------------------------- drag files in from the desktop
  // Anywhere on the window they're imported. Over the timeline they also go where they're dropped (a gap opens
  // while hovering, as when dragging from the browser); on the Projects screen they start a new movie.
  let overlay = null, depth = 0;
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const timelineAt = (x, y) => {
    const tl = IM.timelineUI;
    if (app.view !== 'editor' || !app.project || !tl || !tl.canvas || Importer.sheet) return null;
    if (IM.trailerUI && IM.trailerUI.active()) return null;
    const r = tl.canvas.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? tl : null;
  };
  // what the timeline expects while files are dragged over it (their lengths are only known once imported)
  const draggedFiles = (dt) => {
    const kinds = Array.from(dt.items || []).filter((i) => i.kind === 'file').map((i) => IM.mediaTypeOf({ type: i.type || '', name: '' }));
    return { kind: 'media', items: [], dur: 4 * Math.max(1, kinds.length), audioOnly: kinds.length > 0 && kinds.every((k) => k === 'audio') };
  };
  const showOverlay = (on) => {
    if (on && !overlay && !Importer.sheet) {
      overlay = h('div.drop-files-overlay', app.view === 'projects' ? 'Drop to make a new movie'
        : 'Drop to import into ' + ((IM.lib.eventById(Importer.defaultEvent()) || {}).name || 'your library'));
      IM.$('#window').appendChild(overlay);
    } else if (!on && overlay) { overlay.remove(); overlay = null; }
  };
  const leaveTimeline = () => { if (IM.timelineUI && IM.timelineUI.ext) IM.timelineUI.dragLeave(); };
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const tl = timelineAt(e.clientX, e.clientY);
    const onTimeline = !!tl && tl.dragOver(draggedFiles(e.dataTransfer), e.clientX, e.clientY);
    if (!tl) leaveTimeline();
    showOverlay(!onTimeline);
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) { showOverlay(false); leaveTimeline(); }
  });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    depth = 0;
    showOverlay(false);
    // (the dropped files can only be read while the event is being handled)
    const files = Array.from(e.dataTransfer.files);
    const x = e.clientX, y = e.clientY;
    if (Importer.sheet) return;
    const tl = timelineAt(x, y);
    const fromProjects = app.view === 'projects';
    if (fromProjects) await IM.newMovie();
    const items = await Importer.importFiles(files);
    if (!items.length) { leaveTimeline(); return; }
    const list = items.map((m) => ({ mediaId: m.id, a: 0, b: m.kind === 'image' ? 0 : m.duration }));
    if (tl && app.view === 'editor') {
      const dur = items.reduce((s, m) => s + (m.kind === 'image' ? (IM.prefs.photoDuration || 4) : m.duration), 0);
      if (!tl.drop({ kind: 'media', items: list, dur, audioOnly: items.every((m) => m.kind === 'audio') }, x, y)) leaveTimeline();
    } else if (fromProjects) {
      IM.insertBrowserItems(list, 'append');
    }
  });
})(window.IM = window.IM || {});
