/* Web Audio: live routing for media elements, effect chains, offline mixdown for export */
(function (IM) {
  'use strict';
  const clamp = IM.clamp;

  // ---------- impulse responses (cached per context) ----------
  function makeIR(ctx, seconds, decay, pre) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      const rnd = IM.rand(1234 + c * 77);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay) * (i < rate * (pre || 0) ? i / (rate * (pre || 1e-3)) : 1);
        d[i] = (rnd() * 2 - 1) * env;
      }
    }
    return buf;
  }
  const irCache = new WeakMap();
  function ir(ctx, name) {
    let m = irCache.get(ctx);
    if (!m) { m = {}; irCache.set(ctx, m); }
    if (!m[name]) {
      if (name === 'room') m[name] = makeIR(ctx, 1.2, 3.2, 0.005);
      else if (name === 'cathedral') m[name] = makeIR(ctx, 4.5, 2.2, 0.02);
      else if (name === 'cosmic') m[name] = makeIR(ctx, 3.0, 1.6, 0.05);
    }
    return m[name];
  }
  function distortionCurve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x)); }
    return curve;
  }

  /** Delay-line pitch shifter (two crossfaded modulated delays). ratio > 1 = higher. */
  function pitchShifter(ctx, ratio) {
    const input = ctx.createGain(), output = ctx.createGain();
    const T = 0.1; // modulation period
    const D = Math.abs(ratio - 1) * T; // delay excursion
    const up = ratio > 1;
    const rate = ctx.sampleRate;
    const len = Math.floor(T * rate);
    const ramp = ctx.createBuffer(1, len, rate), fade = ctx.createBuffer(1, len, rate);
    const rd = ramp.getChannelData(0), fd = fade.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      rd[i] = up ? (1 - x) : x;
      fd[i] = Math.sin(Math.PI * x); // window
    }
    const nodes = [];
    for (let k = 0; k < 2; k++) {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.01;
      const modSrc = ctx.createBufferSource(); modSrc.buffer = ramp; modSrc.loop = true;
      const modGain = ctx.createGain(); modGain.gain.value = D;
      modSrc.connect(modGain); modGain.connect(delay.delayTime);
      const fadeSrc = ctx.createBufferSource(); fadeSrc.buffer = fade; fadeSrc.loop = true;
      const vca = ctx.createGain(); vca.gain.value = 0;
      fadeSrc.connect(vca.gain);
      input.connect(delay); delay.connect(vca); vca.connect(output);
      const when = ctx.currentTime + 0.01;
      modSrc.start(when, k * T / 2); fadeSrc.start(when, k * T / 2);
      nodes.push(modSrc, fadeSrc);
    }
    return { input, output, stop: () => nodes.forEach((n) => { try { n.stop(); } catch (e) { /* */ } }) };
  }

  /**
   * Build an effect chain for audio settings: {eq, effect, nr}. Returns {input, output, dispose}.
   */
  function buildChain(ctx, cfg) {
    const input = ctx.createGain();
    let node = input;
    const stops = [];
    const connect = (n) => { node.connect(n); node = n; return n; };
    // noise reduction: high-pass + gentle low-pass as amount rises
    if (cfg.nr > 0) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60 + 120 * cfg.nr; connect(hp);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 16000 - 9000 * cfg.nr; connect(lp);
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -40; comp.ratio.value = 1.5 + cfg.nr * 2; comp.knee.value = 20; connect(comp);
    }
    // equalizer
    const eq = IM.EQPresets.get(cfg.eq || 'flat');
    if (eq && eq.id !== 'flat') {
      IM.EQ_FREQS.forEach((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 0.9; b.gain.value = eq.bands[i];
        connect(b);
      });
      if (eq.hum) [50, 60, 100, 120, 180].forEach((f) => { const n = ctx.createBiquadFilter(); n.type = 'notch'; n.frequency.value = f; n.Q.value = 12; connect(n); });
    }
    // audio effect
    const fx = cfg.effect || 'none';
    const out = ctx.createGain();
    const wetDry = (wetNode, wet, dry) => {
      const d = ctx.createGain(); d.gain.value = dry; node.connect(d); d.connect(out);
      const w = ctx.createGain(); w.gain.value = wet; node.connect(wetNode.input || wetNode); (wetNode.output || wetNode).connect(w); w.connect(out);
    };
    if (fx === 'echo') {
      const dl = ctx.createDelay(2); dl.delayTime.value = 0.32;
      const fb = ctx.createGain(); fb.gain.value = 0.42;
      dl.connect(fb); fb.connect(dl);
      wetDry(dl, 0.55, 1);
    } else if (fx === 'large-room') {
      const cv = ctx.createConvolver(); cv.buffer = ir(ctx, 'room'); wetDry(cv, 0.5, 0.85);
    } else if (fx === 'cathedral') {
      const cv = ctx.createConvolver(); cv.buffer = ir(ctx, 'cathedral'); wetDry(cv, 0.7, 0.7);
    } else if (fx === 'telephone' || fx === 'shortwave') {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = fx === 'telephone' ? 420 : 700; connect(hp);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = fx === 'telephone' ? 3200 : 2400; connect(lp);
      const ws = ctx.createWaveShaper(); ws.curve = distortionCurve(fx === 'telephone' ? 18 : 40); connect(ws);
      if (fx === 'shortwave') {
        const rm = ctx.createGain(); rm.gain.value = 0.75; connect(rm);
        const osc = ctx.createOscillator(); osc.frequency.value = 3.5;
        const og = ctx.createGain(); og.gain.value = 0.25; osc.connect(og); og.connect(rm.gain); osc.start(); stops.push(osc);
      }
      node.connect(out);
    } else if (fx === 'muffled') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.5; connect(lp); node.connect(out);
    } else if (fx === 'robot' || fx === 'alien') {
      const rm = ctx.createGain(); rm.gain.value = 0;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = fx === 'robot' ? 38 : 95;
      osc.connect(rm.gain); osc.start(); stops.push(osc);
      connect(rm);
      const dl = ctx.createDelay(0.1); dl.delayTime.value = fx === 'robot' ? 0.012 : 0.004;
      const fb = ctx.createGain(); fb.gain.value = 0.55; dl.connect(fb); fb.connect(dl);
      const mix = ctx.createGain(); node.connect(mix); node.connect(dl); dl.connect(mix);
      const mk = ctx.createGain(); mk.gain.value = 1.6; mix.connect(mk);
      if (fx === 'alien') {
        const ps = pitchShifter(ctx, 1.35); mk.connect(ps.input); ps.output.connect(out); stops.push(ps);
      } else mk.connect(out);
    } else if (fx === 'cosmic') {
      const ps = pitchShifter(ctx, 0.84); stops.push(ps);
      const cv = ctx.createConvolver(); cv.buffer = ir(ctx, 'cosmic');
      const dl = ctx.createDelay(2); dl.delayTime.value = 0.45; const fb = ctx.createGain(); fb.gain.value = 0.35; dl.connect(fb); fb.connect(dl);
      node.connect(ps.input);
      const d = ctx.createGain(); d.gain.value = 0.7; ps.output.connect(d); d.connect(out);
      ps.output.connect(cv); const w = ctx.createGain(); w.gain.value = 0.6; cv.connect(w); w.connect(out);
      ps.output.connect(dl); const w2 = ctx.createGain(); w2.gain.value = 0.3; dl.connect(w2); w2.connect(out);
    } else if (fx === 'chipmunk' || fx === 'pitch-down') {
      const ps = pitchShifter(ctx, fx === 'chipmunk' ? 1.8 : 0.66); stops.push(ps);
      node.connect(ps.input); ps.output.connect(out);
    } else {
      node.connect(out);
    }
    return {
      input, output: out,
      dispose() {
        stops.forEach((s) => { try { s.stop(); } catch (e) { /* */ } });
        try { input.disconnect(); } catch (e) { /* */ }
        try { out.disconnect(); } catch (e) { /* */ }
      },
    };
  }
  IM.buildAudioChain = buildChain;
  IM.chainKey = (a) => (a ? [a.eq || 'flat', a.effect || 'none', Math.round((a.nr || 0) * 20)].join('|') : 'flat|none|0');

  // ---------- gain envelope helpers (shared by playback + export) ----------
  /** Returns gain factor for item audio at local time (fades + volume + mute). */
  /** Gain of item `it` at `local` seconds into its `dur`; `e` (layout entry) adds transition crossfades. */
  IM.itemGain = function (it, local, dur, e) {
    const a = it.audio || {};
    if (a.mute) return 0;
    let g = a.volume == null ? 1 : a.volume;
    if (a.fadeIn > 0 && local < a.fadeIn) g *= Math.sin(clamp(local / a.fadeIn, 0, 1) * Math.PI / 2);
    if (a.fadeOut > 0 && dur - local < a.fadeOut) g *= Math.sin(clamp((dur - local) / a.fadeOut, 0, 1) * Math.PI / 2);
    // transitions crossfade the audio of the two clips (equal power)
    if (e && e.where === 'primary') {
      if (e.trIn > 0 && local < e.trIn) g *= Math.sin(clamp(local / e.trIn, 0, 1) * Math.PI / 2);
      if (e.trOut > 0 && dur - local < e.trOut) g *= Math.sin(clamp((dur - local) / e.trOut, 0, 1) * Math.PI / 2);
    }
    return g;
  };
  /** Ducking multiplier for item at timeline time t given layout. */
  IM.duckFactor = function (p, L, t, selfId) {
    let f = 1;
    const all = L.clips.concat(L.connected, L.music);
    for (const e of all) {
      const it = e.item;
      if (it.id === selfId || !it.audio || !it.audio.duck) continue;
      const ramp = 0.35;
      if (t < e.start - ramp || t > e.end + ramp) continue;
      const k = clamp(Math.min((t - (e.start - ramp)) / ramp, ((e.end + ramp) - t) / ramp), 0, 1);
      f = Math.min(f, 1 - (it.audio.duckAmount == null ? 0.75 : it.audio.duckAmount) * k);
    }
    return f;
  };

  // ======================================================================
  // Live engine
  // ======================================================================
  class AudioEngine {
    constructor() {
      this.chains = new Map(); // element -> {src, chain, gain, key}
      this.ready = false;
    }
    init() {
      if (this.ready) return;
      const ctx = IM.audioCtx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.analyserL = ctx.createAnalyser(); this.analyserR = ctx.createAnalyser();
      this.analyserL.fftSize = 1024; this.analyserR.fftSize = 1024;
      const split = ctx.createChannelSplitter(2);
      this.master.connect(split);
      split.connect(this.analyserL, 0); split.connect(this.analyserR, 1);
      this.master.connect(ctx.destination);
      this.ready = true;
    }
    /** Route a media element through the graph (once). */
    attach(el) {
      this.init();
      let rec = this.chains.get(el);
      if (rec) return rec;
      let src = null;
      try { src = this.ctx.createMediaElementSource(el); } catch (e) { src = null; }
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      rec = { src, chain: null, gain, key: null };
      if (src) { src.connect(gain); gain.connect(this.master); }
      this.chains.set(el, rec);
      return rec;
    }
    configure(el, audio) {
      const rec = this.attach(el);
      if (!rec.src) return rec;
      const key = IM.chainKey(audio);
      if (rec.key === key) return rec;
      rec.key = key;
      try { rec.src.disconnect(); } catch (e) { /* */ }
      if (rec.chain) { rec.chain.dispose(); rec.chain = null; }
      if (key === 'flat|none|0') rec.src.connect(rec.gain);
      else {
        rec.chain = buildChain(this.ctx, audio || {});
        rec.src.connect(rec.chain.input);
        rec.chain.output.connect(rec.gain);
      }
      return rec;
    }
    setGain(el, v, immediate) {
      const rec = this.chains.get(el);
      if (!rec) { el.volume = clamp(v, 0, 1); return; }
      const g = rec.gain.gain;
      const now = this.ctx.currentTime;
      if (immediate) { g.cancelScheduledValues(now); g.setValueAtTime(v, now); }
      else g.setTargetAtTime(v, now, 0.012);
    }
    levels() {
      if (!this.ready) return [0, 0];
      const out = [];
      for (const an of [this.analyserL, this.analyserR]) {
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        let m = 0;
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; }
        out.push(m);
      }
      return out;
    }
  }
  IM.AudioEngine = AudioEngine;

})(window.IM = window.IM || {});
