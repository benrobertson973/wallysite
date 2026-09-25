/* Record Voiceover (microphone button below the viewer) */
(function (IM) {
  'use strict';
  const h = IM.h;
  const app = IM.app;
  const Pr = IM.Project;

  const VO = {
    bar: null, stream: null, rec: null, muteProject: true,
    toggle() { if (this.bar) this.close(); else this.open(); },
    async open() {
      if (!app.project) return;
      const viewer = IM.viewerUI;
      this.recBtn = h('button.vo-rec', { 'data-tip': 'Record voiceover' }, IM.icon('record', 28));
      this.level = h('div.vo-level', h('i'));
      this.inputSel = IM.popupButton([{ value: 'default', label: 'System Setting: Default Microphone' }], 'default', (v) => this.startStream(v), { width: 230 });
      const mute = IM.checkbox('Mute Project', this.muteProject, (v) => { this.muteProject = v; });
      this.bar = h('div.vo-bar', this.recBtn, h('span', 'Input:'), this.inputSel, this.level, mute, h('div', { style: { flex: 1 } }), h('button.btn.small', { on: { click: () => this.close() } }, 'Done'));
      viewer.el.appendChild(this.bar);
      this.recBtn.addEventListener('click', () => (this.rec ? this.stop() : this.countdown()));
      await this.startStream('default');
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const mics = devs.filter((d) => d.kind === 'audioinput');
        const opts = mics.map((d, i) => ({ value: d.deviceId || 'default', label: d.label || 'Microphone ' + (i + 1) }));
        if (opts.length) {
          const sel = IM.popupButton(opts, opts[0].value, (v) => this.startStream(v), { width: 230 });
          this.inputSel.replaceWith(sel); this.inputSel = sel;
        }
      } catch (e) { /* ignore */ }
    },
    async startStream(deviceId) {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        IM.alert({ title: 'Microphone unavailable', message: 'Allow microphone access for this page to record a voiceover.' });
        this.close();
        return;
      }
      const ctx = IM.audioCtx();
      this.an = ctx.createAnalyser(); this.an.fftSize = 1024;
      ctx.createMediaStreamSource(this.stream).connect(this.an);
      const buf = new Float32Array(this.an.fftSize);
      const loop = () => {
        if (!this.bar) return;
        this.an.getFloatTimeDomainData(buf);
        let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
        const db = m > 0 ? 20 * Math.log10(m) : -80;
        this.level.firstChild.style.width = IM.clamp((db + 50) / 50, 0, 1) * 100 + '%';
        requestAnimationFrame(loop);
      };
      loop();
    },
    countdown() {
      const stage = IM.viewerUI.stage;
      const el = h('div.vo-count', '3');
      stage.appendChild(el);
      let n = 3;
      const tick = () => {
        n--;
        if (n <= 0) { el.remove(); this.start(); return; }
        el.textContent = String(n);
        setTimeout(tick, 1000);
      };
      setTimeout(tick, 1000);
    },
    start() {
      const pl = app.player;
      this.startT = pl.t;
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => this.finish(new Blob(chunks, { type: (mr.mimeType || 'audio/webm').split(';')[0] }));
      mr.start(250);
      this.rec = mr;
      IM.clear(this.recBtn).appendChild(IM.icon('stop-record', 28));
      pl.muteProject = this.muteProject;
      if (Pr.duration(app.project) > 0) pl.play({ from: this.startT });
      this._stopWatch = pl.on('play', (on) => { if (!on && this.rec) this.stop(); });
    },
    stop() {
      const pl = app.player;
      if (this._stopWatch) { this._stopWatch(); this._stopWatch = null; }
      if (this.rec) { this.rec.stop(); this.rec = null; }
      pl.muteProject = false;
      if (pl.isPlaying()) pl.pause();
      if (this.recBtn) IM.clear(this.recBtn).appendChild(IM.icon('record', 28));
    },
    async finish(blob) {
      const p = app.project;
      if (!p || !blob.size) return;
      const n = IM.lib.allUserMedia().filter((m) => m.source === 'voiceover').length + 1;
      let m;
      try { m = await IM.lib.addBlob(blob, 'Voiceover ' + n, 'audio', p.eventId, { source: 'voiceover' }); } catch (e) {
        IM.notify('Voiceover Failed', 'The recording couldn’t be added.');
        return;
      }
      const it = Pr.itemFromMedia(m, 0, m.duration);
      it.name = m.name;
      it._voiceover = true;
      if (!p.clips.length) IM.edit('Record Voiceover', (pp) => Pr.addMusic(pp, [it]));
      else IM.edit('Record Voiceover', (pp) => Pr.connect(pp, [it], this.startT, IM.timelineUI.freeLane(this.startT, m.duration, -1)));
      IM.select([it.id]);
    },
    close() {
      if (this.rec) this.stop();
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this.bar) { this.bar.remove(); this.bar = null; }
    },
  };
  IM.voiceover = VO;
})(window.IM = window.IM || {});
