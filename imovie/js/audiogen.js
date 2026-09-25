/* Procedurally synthesized Sound Effects and Soundtracks for the Audio & Video browser */
(function (IM) {
  'use strict';
  const SR = 44100;
  const TAU = Math.PI * 2;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ------------------------------------------------------------------ sample synthesis (JS → Float32Array, mono)
  const cache = new Map();
  function synth(kind, midi, dur, seed) {
    const key = kind + ':' + midi + ':' + dur.toFixed(3) + ':' + (seed || 0);
    if (cache.has(key)) return cache.get(key);
    const n = Math.max(1, Math.floor(dur * SR));
    const out = new Float32Array(n);
    const f = mtof(midi);
    const rnd = IM.rand((seed || 1) * 7919 + midi * 31 + kind.length);
    switch (kind) {
      case 'pluck': { // Karplus–Strong
        const p = Math.max(2, Math.round(SR / f));
        const buf = new Float32Array(p);
        for (let i = 0; i < p; i++) buf[i] = rnd() * 2 - 1;
        let idx = 0;
        const damp = 0.996 - Math.min(0.01, f / 60000);
        for (let i = 0; i < n; i++) {
          const a = buf[idx], b = buf[(idx + 1) % p];
          const v = (a + b) * 0.5 * damp;
          buf[idx] = v; out[i] = a; idx = (idx + 1) % p;
        }
        break;
      }
      case 'piano': {
        const parts = [1, 2, 3, 4, 5, 6];
        const amps = [1, 0.55, 0.32, 0.18, 0.11, 0.06];
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          let v = 0;
          for (let k = 0; k < parts.length; k++) {
            const fk = f * parts[k] * (1 + 0.0004 * parts[k] * parts[k]);
            v += amps[k] * Math.sin(TAU * fk * t) * Math.exp(-t * (1.6 + k * 1.1 + f / 900));
          }
          out[i] = v * 0.35 * Math.min(1, t * 300);
        }
        break;
      }
      case 'rhodes': {
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const mod = Math.sin(TAU * f * t) * 1.2 * Math.exp(-t * 3);
          out[i] = Math.sin(TAU * f * t + mod) * Math.exp(-t * 1.4) * 0.4 * Math.min(1, t * 200);
        }
        break;
      }
      case 'bell': {
        const parts = [1, 2.76, 5.4, 8.93, 13.34];
        const amps = [1, 0.6, 0.35, 0.2, 0.1];
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          let v = 0;
          for (let k = 0; k < parts.length; k++) v += amps[k] * Math.sin(TAU * f * parts[k] * t) * Math.exp(-t * (1.2 + k * 1.8));
          out[i] = v * 0.3 * Math.min(1, t * 1000);
        }
        break;
      }
      case 'pad': {
        const det = [-0.12, 0, 0.1];
        let lp = 0;
        const phases = [rnd(), rnd(), rnd()];
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          let v = 0;
          for (let k = 0; k < 3; k++) {
            const fk = f * Math.pow(2, det[k] / 12);
            const ph = (phases[k] + fk * t) % 1;
            v += (ph * 2 - 1);
          }
          lp += (v / 3 - lp) * 0.06;
          const env = Math.min(1, t / 0.6) * Math.min(1, (dur - t) / 0.8);
          out[i] = lp * env * 0.35;
        }
        break;
      }
      case 'strings': {
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const vib = 1 + 0.004 * Math.sin(TAU * 5.2 * t);
          const ph = (f * vib * t) % 1;
          const v = (ph * 2 - 1) + 0.5 * (((f * 1.003 * t) % 1) * 2 - 1);
          lp += (v - lp) * 0.04;
          const env = Math.min(1, t / 0.35) * Math.min(1, (dur - t) / 0.4);
          out[i] = lp * env * 0.3;
        }
        break;
      }
      case 'brass': {
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const ph = (f * t) % 1;
          const cut = 0.02 + 0.25 * Math.exp(-t * 4) + 0.05;
          lp += ((ph * 2 - 1) - lp) * cut;
          const env = Math.min(1, t / 0.04) * Math.min(1, (dur - t) / 0.1) * (0.8 + 0.2 * Math.exp(-t * 3));
          out[i] = lp * env * 0.45;
        }
        break;
      }
      case 'lead': {
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const vib = 1 + 0.006 * Math.sin(TAU * 5.5 * t) * Math.min(1, t * 3);
          const ph = (f * vib * t) % 1;
          const sq = ph < 0.5 ? 1 : -1;
          const env = Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.08);
          out[i] = (sq * 0.35 + Math.sin(TAU * f * vib * t) * 0.4) * env * 0.35;
        }
        break;
      }
      case 'bass': {
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const ph = (f * t) % 1;
          lp += ((ph * 2 - 1) - lp) * 0.035;
          const env = Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.05) * (0.75 + 0.25 * Math.exp(-t * 6));
          out[i] = (lp * 0.8 + Math.sin(TAU * f * t) * 0.6) * env * 0.5;
        }
        break;
      }
      case 'kick': {
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const fr = 45 + 110 * Math.exp(-t * 28);
          ph += fr / SR;
          out[i] = Math.sin(TAU * ph) * Math.exp(-t * 7) * 0.95 + (rnd() * 2 - 1) * Math.exp(-t * 300) * 0.2;
        }
        break;
      }
      case 'snare': {
        let hp = 0, prev = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const w = rnd() * 2 - 1;
          hp = 0.9 * (hp + w - prev); prev = w;
          out[i] = hp * Math.exp(-t * 18) * 0.5 + Math.sin(TAU * 185 * t) * Math.exp(-t * 25) * 0.4;
        }
        break;
      }
      case 'clap': {
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const w = rnd() * 2 - 1;
          const bursts = [0, 0.011, 0.022, 0.034];
          let env = 0;
          for (const b of bursts) if (t >= b) env = Math.max(env, Math.exp(-(t - b) * (b === 0.034 ? 14 : 140)));
          out[i] = w * env * 0.55;
        }
        break;
      }
      case 'hat': {
        let hp = 0, prev = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const w = rnd() * 2 - 1;
          hp = 0.6 * (hp + w - prev); prev = w;
          out[i] = hp * Math.exp(-t * (midi > 60 ? 12 : 45)) * 0.28;
        }
        break;
      }
      case 'crash': {
        let hp = 0, prev = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const w = rnd() * 2 - 1;
          hp = 0.7 * (hp + w - prev); prev = w;
          out[i] = hp * Math.exp(-t * 1.3) * 0.35 * Math.min(1, t * 500);
        }
        break;
      }
      case 'timpani': {
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const fr = f * (1 + 0.1 * Math.exp(-t * 20));
          ph += fr / SR;
          out[i] = (Math.sin(TAU * ph) * 0.8 + (rnd() * 2 - 1) * Math.exp(-t * 60) * 0.3) * Math.exp(-t * 2.2) * 0.8;
        }
        break;
      }
      default: break;
    }
    cache.set(key, out);
    if (cache.size > 900) cache.delete(cache.keys().next().value);
    return out;
  }

  // ------------------------------------------------------------------ rendering helpers
  function makeIR(ctx, sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    const rnd = IM.rand(42);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  /** Offline mixing session. */
  function session(dur, reverbSec) {
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    const master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    const rev = ctx.createConvolver(); rev.buffer = makeIR(ctx, reverbSec || 2.2, 2.5);
    const revIn = ctx.createGain(); revIn.gain.value = 1;
    revIn.connect(rev); rev.connect(master);
    const S = {
      ctx, master, rev: revIn, dur,
      play(data, t, o) {
        o = o || {};
        if (t >= dur) return;
        const b = ctx.createBuffer(1, data.length, SR);
        b.copyToChannel(data, 0);
        const src = ctx.createBufferSource(); src.buffer = b;
        if (o.rate) src.playbackRate.value = o.rate;
        const g = ctx.createGain(); g.gain.value = o.vel == null ? 0.8 : o.vel;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (pan) { pan.pan.value = o.pan || 0; src.connect(g); g.connect(pan); pan.connect(master); if (o.rev) { const sg = ctx.createGain(); sg.gain.value = o.rev; pan.connect(sg); sg.connect(revIn); } }
        else { src.connect(g); g.connect(master); }
        src.start(t);
      },
      noise(t, len, o) {
        o = o || {};
        const n = Math.floor(len * SR);
        const b = ctx.createBuffer(1, n, SR); const d = b.getChannelData(0);
        const rnd = IM.rand(o.seed || 7);
        let brown = 0;
        for (let i = 0; i < n; i++) { const w = rnd() * 2 - 1; if (o.brown) { brown = (brown + 0.02 * w) / 1.02; d[i] = brown * 3.5; } else d[i] = w; }
        const src = ctx.createBufferSource(); src.buffer = b;
        let node = src;
        if (o.filter) { const f = ctx.createBiquadFilter(); f.type = o.filter; f.frequency.value = o.freq || 1000; f.Q.value = o.q || 0.7; node.connect(f); node = f; if (o.sweep) f.frequency.setValueCurveAtTime(new Float32Array(o.sweep), t, len); }
        const g = ctx.createGain();
        const env = o.env || [[0, 1]];
        g.gain.setValueAtTime(0, t);
        for (const [dt, v] of env) g.gain.linearRampToValueAtTime(v * (o.vel == null ? 0.5 : o.vel), t + dt * len);
        node.connect(g);
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (pan) { pan.pan.value = o.pan || 0; g.connect(pan); pan.connect(master); if (o.rev) { const sg = ctx.createGain(); sg.gain.value = o.rev; pan.connect(sg); sg.connect(revIn); } } else g.connect(master);
        src.start(t);
        return g;
      },
      tone(t, len, o) {
        o = o || {};
        const osc = ctx.createOscillator();
        osc.type = o.type || 'sine';
        if (o.curve) osc.frequency.setValueCurveAtTime(new Float32Array(o.curve), t, len);
        else osc.frequency.value = o.freq || 440;
        const g = ctx.createGain();
        const env = o.env || [[0.01, 1], [1, 0]];
        g.gain.setValueAtTime(0, t);
        for (const [dt, v] of env) g.gain.linearRampToValueAtTime(v * (o.vel == null ? 0.4 : o.vel), t + dt * len);
        let node = osc;
        if (o.filter) { const f = ctx.createBiquadFilter(); f.type = o.filter; f.frequency.value = o.ffreq || 2000; node.connect(f); node = f; }
        node.connect(g);
        g.connect(master);
        if (o.rev) { const sg = ctx.createGain(); sg.gain.value = o.rev; g.connect(sg); sg.connect(revIn); }
        osc.start(t); osc.stop(t + len + 0.05);
        return osc;
      },
    };
    return S;
  }

  // ------------------------------------------------------------------ sound effects
  const SFX = [];
  const fx = (id, name, category, duration, fn) => SFX.push({ id, name, category, duration, fn });
  fx('applause', 'Applause', 'Crowds', 5, (S) => {
    const rnd = IM.rand(3);
    S.noise(0, 5, { filter: 'bandpass', freq: 1800, q: 0.5, env: [[0.08, 0.5], [0.75, 0.45], [1, 0]], vel: 0.25, rev: 0.3 });
    for (let i = 0; i < 260; i++) {
      const t = rnd() * 4.3 + (rnd() * 0.3);
      S.play(synth('clap', 60, 0.12, i % 20), t, { vel: 0.12 + rnd() * 0.18, pan: rnd() * 1.6 - 0.8, rate: 0.85 + rnd() * 0.4, rev: 0.4 });
    }
  });
  fx('cheer', 'Crowd Cheer', 'Crowds', 5, (S) => {
    S.noise(0, 5, { filter: 'bandpass', freq: 900, q: 0.7, env: [[0.1, 0.8], [0.6, 1], [1, 0]], vel: 0.35, rev: 0.4 });
    const rnd = IM.rand(9);
    for (let i = 0; i < 40; i++) {
      const t = rnd() * 4, f = 300 + rnd() * 500;
      S.tone(t, 0.5 + rnd() * 0.6, { type: 'sawtooth', curve: [f, f * 1.3, f * 1.15], filter: 'lowpass', ffreq: 1500, vel: 0.03, env: [[0.2, 1], [1, 0]], rev: 0.5 });
    }
  });
  fx('crowd', 'Crowd Murmur', 'Crowds', 8, (S) => {
    S.noise(0, 8, { filter: 'bandpass', freq: 600, q: 1.2, env: [[0.1, 1], [0.9, 1], [1, 0]], vel: 0.35, brown: false, rev: 0.4 });
    S.noise(0, 8, { filter: 'lowpass', freq: 400, env: [[0.1, 1], [0.9, 1], [1, 0]], vel: 0.3, brown: true });
  });
  fx('whoosh', 'Whoosh', 'Transitions', 1.2, (S) => S.noise(0, 1.2, { filter: 'bandpass', q: 2, sweep: [300, 2500, 700], env: [[0.45, 1], [1, 0]], vel: 0.8, rev: 0.2 }));
  fx('swoosh', 'Swoosh', 'Transitions', 0.6, (S) => S.noise(0, 0.6, { filter: 'highpass', sweep: [4000, 800], env: [[0.3, 1], [1, 0]], vel: 0.6 }));
  fx('riser', 'Riser', 'Transitions', 3, (S) => { S.noise(0, 3, { filter: 'bandpass', q: 3, sweep: [200, 5000], env: [[0.95, 1], [1, 0]], vel: 0.5, rev: 0.5 }); S.tone(0, 3, { type: 'sawtooth', curve: [80, 400], filter: 'lowpass', ffreq: 1200, vel: 0.12, env: [[0.95, 1], [1, 0]] }); });
  fx('bass-drop', 'Bass Drop', 'Transitions', 2.2, (S) => S.tone(0, 2.2, { type: 'sine', curve: [120, 38], env: [[0.02, 1], [0.8, 0.6], [1, 0]], vel: 0.9 }));
  fx('pop', 'Pop', 'Cartoon', 0.3, (S) => S.tone(0, 0.25, { curve: [900, 250], env: [[0.005, 1], [1, 0]], vel: 0.6 }));
  fx('boing', 'Boing', 'Cartoon', 1, (S) => { const o = S.tone(0, 1, { type: 'sine', curve: [180, 420, 200, 330, 220, 280, 240], env: [[0.02, 1], [1, 0]], vel: 0.5 }); void o; });
  fx('slide-up', 'Slide Whistle Up', 'Cartoon', 1.2, (S) => S.tone(0, 1.2, { curve: [500, 2000], env: [[0.05, 1], [0.9, 1], [1, 0]], vel: 0.3 }));
  fx('slide-down', 'Slide Whistle Down', 'Cartoon', 1.2, (S) => S.tone(0, 1.2, { curve: [2000, 450], env: [[0.05, 1], [0.9, 1], [1, 0]], vel: 0.3 }));
  fx('laser', 'Laser', 'Sci-Fi', 0.7, (S) => S.tone(0, 0.6, { type: 'square', curve: [2200, 180], filter: 'lowpass', ffreq: 3000, env: [[0.01, 1], [1, 0]], vel: 0.25 }));
  fx('sparkle', 'Magic Sparkle', 'Sci-Fi', 2, (S) => { const rnd = IM.rand(5); for (let i = 0; i < 26; i++) S.play(synth('bell', 84 + Math.floor(rnd() * 16), 0.8), i * 0.06 + rnd() * 0.05, { vel: 0.25, pan: rnd() * 2 - 1, rev: 0.6 }); });
  fx('explosion', 'Explosion', 'Action', 3, (S) => { S.noise(0, 3, { filter: 'lowpass', sweep: [3000, 300, 120], env: [[0.01, 1], [0.3, 0.5], [1, 0]], vel: 1, brown: true, rev: 0.4 }); S.play(synth('kick', 30, 1.2), 0, { vel: 1, rate: 0.6 }); });
  fx('thunder', 'Thunder', 'Nature', 6, (S) => { S.noise(0, 6, { filter: 'lowpass', freq: 240, env: [[0.05, 1], [0.2, 0.5], [0.35, 0.9], [1, 0]], vel: 1, brown: true, rev: 0.6 }); S.noise(0, 0.5, { filter: 'highpass', freq: 800, env: [[0.02, 1], [1, 0]], vel: 0.4 }); });
  fx('rain', 'Rain', 'Nature', 8, (S) => { S.noise(0, 8, { filter: 'highpass', freq: 1200, env: [[0.1, 1], [0.9, 1], [1, 0]], vel: 0.18 }); const rnd = IM.rand(2); for (let i = 0; i < 180; i++) S.tone(rnd() * 7.8, 0.02, { freq: 2000 + rnd() * 3000, env: [[0.1, 1], [1, 0]], vel: 0.05 + rnd() * 0.05 }); });
  fx('ocean', 'Ocean Waves', 'Nature', 10, (S) => { for (let k = 0; k < 3; k++) S.noise(k * 3.2, 4.2, { filter: 'lowpass', freq: 900, env: [[0.4, 1], [1, 0]], vel: 0.55, brown: false, rev: 0.3, seed: k + 3 }); S.noise(0, 10, { filter: 'lowpass', freq: 300, brown: true, env: [[0.1, 0.8], [0.9, 0.8], [1, 0]], vel: 0.4 }); });
  fx('wind', 'Wind', 'Nature', 8, (S) => S.noise(0, 8, { filter: 'bandpass', q: 4, sweep: [300, 700, 400, 900, 350], env: [[0.2, 1], [0.8, 0.8], [1, 0]], vel: 0.6 }));
  fx('birds', 'Birds Chirping', 'Nature', 6, (S) => { const rnd = IM.rand(11); for (let i = 0; i < 30; i++) { const t = rnd() * 5.6, f = 2500 + rnd() * 2000; S.tone(t, 0.12, { curve: [f, f * 1.4, f * 0.9], env: [[0.1, 1], [1, 0]], vel: 0.12, rev: 0.4 }); } });
  fx('crickets', 'Crickets', 'Nature', 6, (S) => { for (let i = 0; i < 60; i++) S.tone(i * 0.1, 0.05, { type: 'sine', freq: 4400, env: [[0.2, 1], [1, 0]], vel: 0.06 }); });
  fx('heartbeat', 'Heartbeat', 'Suspense', 4, (S) => { for (let i = 0; i < 4; i++) { S.play(synth('kick', 30, 0.4), i * 1.0, { vel: 0.9, rate: 0.7 }); S.play(synth('kick', 30, 0.4), i * 1.0 + 0.28, { vel: 0.6, rate: 0.7 }); } });
  fx('clock', 'Clock Ticking', 'Household', 5, (S) => { for (let i = 0; i < 10; i++) S.tone(i * 0.5, 0.02, { type: 'square', freq: i % 2 ? 2200 : 1800, filter: 'bandpass', ffreq: 2000, env: [[0.05, 1], [1, 0]], vel: 0.3 }); });
  fx('doorbell', 'Doorbell', 'Household', 2.6, (S) => { S.play(synth('bell', 76, 2), 0, { vel: 0.6, rev: 0.3 }); S.play(synth('bell', 72, 2.2), 0.6, { vel: 0.6, rev: 0.3 }); });
  fx('shutter', 'Camera Shutter', 'Household', 0.4, (S) => { S.noise(0, 0.05, { filter: 'highpass', freq: 2000, env: [[0.05, 1], [1, 0]], vel: 0.7 }); S.noise(0.12, 0.06, { filter: 'bandpass', freq: 3000, env: [[0.05, 1], [1, 0]], vel: 0.6 }); });
  fx('typewriter', 'Typewriter', 'Household', 3, (S) => { const rnd = IM.rand(4); for (let i = 0; i < 18; i++) S.noise(i * 0.13 + rnd() * 0.04, 0.03, { filter: 'bandpass', freq: 2500 + rnd() * 1500, env: [[0.05, 1], [1, 0]], vel: 0.6 }); S.play(synth('bell', 88, 1), 2.5, { vel: 0.4 }); });
  fx('footsteps', 'Footsteps', 'Household', 4, (S) => { for (let i = 0; i < 8; i++) S.noise(i * 0.5, 0.12, { filter: 'lowpass', freq: 600, env: [[0.05, 1], [1, 0]], vel: 0.8, brown: true }); });
  fx('ding', 'Ding', 'Alerts', 2.5, (S) => S.play(synth('bell', 88, 2.4), 0, { vel: 0.6, rev: 0.3 }));
  fx('chime', 'Chimes', 'Alerts', 3, (S) => [79, 83, 86].forEach((m, i) => S.play(synth('bell', m, 2.5), i * 0.18, { vel: 0.45, rev: 0.4 })));
  fx('success', 'Success', 'Alerts', 1.2, (S) => [72, 76, 79, 84].forEach((m, i) => S.play(synth('bell', m, 1), i * 0.08, { vel: 0.4, rev: 0.3 })));
  fx('error', 'Error', 'Alerts', 0.6, (S) => { S.tone(0, 0.2, { type: 'square', freq: 220, filter: 'lowpass', ffreq: 1200, env: [[0.02, 1], [1, 0]], vel: 0.25 }); S.tone(0.22, 0.3, { type: 'square', freq: 180, filter: 'lowpass', ffreq: 1200, env: [[0.02, 1], [1, 0]], vel: 0.25 }); });
  fx('coin', 'Coin', 'Games', 0.5, (S) => { S.tone(0, 0.08, { type: 'square', freq: 988, env: [[0.02, 1], [1, 0.8]], vel: 0.18 }); S.tone(0.08, 0.35, { type: 'square', freq: 1319, env: [[0.02, 1], [1, 0]], vel: 0.18 }); });
  fx('level-up', 'Level Up', 'Games', 1.4, (S) => [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => S.tone(i * 0.09, 0.2, { type: 'square', freq: mtof(m), env: [[0.02, 1], [1, 0]], vel: 0.14 })));
  fx('drumroll', 'Drum Roll', 'Music', 3.2, (S) => { for (let i = 0; i < 70; i++) S.play(synth('snare', 60, 0.2, i % 8), i * 0.036, { vel: 0.15 + 0.5 * i / 70, pan: (i % 2 ? 0.1 : -0.1) }); S.play(synth('crash', 60, 2.4), 2.55, { vel: 0.8, rev: 0.4 }); S.play(synth('kick', 36, 0.5), 2.55, { vel: 0.9 }); });
  fx('cymbal', 'Cymbal Crash', 'Music', 3, (S) => S.play(synth('crash', 60, 3), 0, { vel: 0.9, rev: 0.4 }));
  fx('tada', 'Ta-Da', 'Music', 2.5, (S) => { [60, 64, 67].forEach((m) => { S.play(synth('brass', m, 0.18), 0, { vel: 0.4 }); S.play(synth('brass', m + 12, 2.2), 0.22, { vel: 0.35, rev: 0.4 }); }); S.play(synth('crash', 60, 2), 0.22, { vel: 0.4 }); });
  fx('scratch', 'Record Scratch', 'Music', 0.8, (S) => S.noise(0, 0.7, { filter: 'bandpass', q: 5, sweep: [900, 2500, 600, 1800], env: [[0.1, 1], [0.6, 0.7], [1, 0]], vel: 0.9 }));
  fx('horn', 'Car Horn', 'Vehicles', 1.2, (S) => { S.tone(0, 1, { type: 'sawtooth', freq: 415, filter: 'lowpass', ffreq: 1800, env: [[0.03, 1], [0.95, 1], [1, 0]], vel: 0.18 }); S.tone(0, 1, { type: 'sawtooth', freq: 520, filter: 'lowpass', ffreq: 1800, env: [[0.03, 1], [0.95, 1], [1, 0]], vel: 0.16 }); });
  fx('siren', 'Siren', 'Vehicles', 5, (S) => S.tone(0, 5, { type: 'triangle', curve: [700, 1300, 700, 1300, 700, 1300, 700], env: [[0.05, 1], [0.95, 1], [1, 0]], vel: 0.25, rev: 0.3 }));

  // ------------------------------------------------------------------ soundtracks
  const SONGS = [];
  const song = (id, name, genre, duration, o) => SONGS.push(Object.assign({ id, name, genre, duration }, o));
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
  function chordNotes(root, scale, degree, n) {
    const out = [];
    for (let k = 0; k < (n || 3); k++) {
      const d = degree + k * 2;
      out.push(root + scale[d % 7] + 12 * Math.floor(d / 7));
    }
    return out;
  }
  song('sunny', 'Sunny Days', 'Pop', 64, { bpm: 118, key: 60, scale: MAJ, prog: [0, 4, 5, 3], lead: 'pluck', chords: 'piano', drums: 'pop', seed: 1 });
  song('adventure', 'Adventure', 'Cinematic', 72, { bpm: 96, key: 57, scale: MIN, prog: [0, 5, 2, 6], lead: 'brass', chords: 'strings', drums: 'epic', seed: 2 });
  song('dreams', 'Dreams', 'Ambient', 70, { bpm: 72, key: 62, scale: MAJ, prog: [0, 3, 5, 4], lead: 'bell', chords: 'pad', drums: 'none', seed: 3 });
  song('road-trip', 'Road Trip', 'Acoustic', 66, { bpm: 108, key: 55, scale: MAJ, prog: [0, 4, 5, 3], lead: 'pluck', chords: 'pluck', drums: 'light', seed: 4 });
  song('celebration', 'Celebration', 'Dance', 62, { bpm: 124, key: 62, scale: MAJ, prog: [5, 3, 0, 4], lead: 'lead', chords: 'pad', drums: 'dance', seed: 5 });
  song('memories', 'Memories', 'Piano', 70, { bpm: 76, key: 60, scale: MAJ, prog: [0, 5, 3, 4], lead: 'piano', chords: 'piano', drums: 'none', seed: 6 });
  song('tension', 'Tension', 'Suspense', 60, { bpm: 90, key: 52, scale: MIN, prog: [0, 0, 5, 4], lead: 'bell', chords: 'strings', drums: 'pulse', seed: 7 });
  song('chill', 'Chill Beats', 'Hip Hop', 66, { bpm: 84, key: 57, scale: MIN, prog: [3, 4, 0, 0], lead: 'rhodes', chords: 'rhodes', drums: 'lofi', seed: 8 });
  song('hero', 'Hero', 'Cinematic', 70, { bpm: 92, key: 62, scale: MAJ, prog: [0, 4, 5, 3], lead: 'brass', chords: 'strings', drums: 'epic', seed: 9 });
  song('holiday', 'Holiday Bells', 'Seasonal', 60, { bpm: 120, key: 67, scale: MAJ, prog: [0, 3, 4, 0], lead: 'bell', chords: 'piano', drums: 'sleigh', seed: 10 });

  function renderSong(sg) {
    const S = session(sg.duration, sg.drums === 'none' ? 3.2 : 2.2);
    const beat = 60 / sg.bpm, bar = beat * 4;
    const bars = Math.floor((sg.duration - 2) / bar);
    const rnd = IM.rand(sg.seed * 101);
    const motif = [];
    for (let i = 0; i < 8; i++) motif.push({ step: Math.floor(rnd() * 3), len: [1, 1, 2, 0.5][Math.floor(rnd() * 4)], rest: rnd() < 0.18 });
    const sectionOf = (b) => (b < 2 ? 'intro' : b >= bars - 2 ? 'outro' : Math.floor((b - 2) / 8) % 2 === 0 ? 'verse' : 'chorus');
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      const sec = sectionOf(b);
      const deg = sg.prog[b % sg.prog.length];
      const chord = chordNotes(sg.key, sg.scale, deg, 4);
      const fadeOut = b >= bars - 2 ? (bars - b) / 3 : 1;
      const vel = (sec === 'chorus' ? 1 : sec === 'intro' ? 0.6 : 0.8) * fadeOut;
      // chords
      if (sg.chords === 'pad' || sg.chords === 'strings') {
        chord.slice(0, 3).forEach((m, i) => S.play(synth(sg.chords, m, bar + 0.3, i), t0, { vel: 0.22 * vel, pan: (i - 1) * 0.4, rev: 0.5 }));
      } else if (sg.chords === 'piano' || sg.chords === 'rhodes') {
        const pattern = sg.bpm > 100 ? [0, 1.5, 2, 3.5] : [0, 2];
        pattern.forEach((pb) => chord.slice(0, 3).forEach((m, i) => S.play(synth(sg.chords, m, beat * 2.2), t0 + pb * beat + i * 0.012, { vel: 0.22 * vel, pan: (i - 1) * 0.3, rev: 0.35 })));
      } else if (sg.chords === 'pluck') {
        for (let s = 0; s < 8; s++) {
          const m = chord[(s % 2 === 0 ? 0 : 1 + (s % 3)) % chord.length] + (s % 4 === 0 ? -12 : 0);
          S.play(synth('pluck', m, beat * 1.5, s), t0 + s * beat / 2, { vel: 0.35 * vel * (s % 2 ? 0.75 : 1), pan: (s % 2 ? 0.3 : -0.3), rev: 0.25 });
        }
      }
      // bass
      if (sec !== 'intro' && sg.drums !== 'none') {
        const root = sg.key - 24 + sg.scale[deg % 7];
        const bp = sg.drums === 'dance' ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] : [0, 1.5, 2, 3];
        bp.forEach((pb, i) => S.play(synth('bass', root + (sg.drums === 'dance' && i % 2 ? 12 : 0), beat * (sg.drums === 'dance' ? 0.45 : 0.9)), t0 + pb * beat, { vel: 0.5 * vel }));
      } else if (sg.drums === 'none' && sec !== 'intro') {
        S.play(synth('piano', sg.key - 24 + sg.scale[deg % 7], bar), t0, { vel: 0.25 * vel, rev: 0.4 });
      }
      // lead melody in chorus (and softer in verse)
      if (sec === 'chorus' || (sec === 'verse' && b % 2 === 1)) {
        let pos = 0, k = 0;
        while (pos < 4) {
          const mm = motif[(k + b) % motif.length];
          const len = Math.min(mm.len, 4 - pos);
          if (!mm.rest) {
            const m = chord[mm.step % chord.length] + 12 + (sg.lead === 'bell' ? 12 : 0);
            S.play(synth(sg.lead, m, len * beat * 1.1, k), t0 + pos * beat, { vel: (sec === 'chorus' ? 0.32 : 0.2) * fadeOut, pan: 0.1, rev: 0.4 });
          }
          pos += len; k++;
        }
      }
      // drums
      const d = sg.drums;
      if (d !== 'none' && sec !== 'intro') {
        for (let s = 0; s < 16; s++) {
          const t = t0 + s * beat / 4;
          if (d === 'pop' || d === 'light') {
            if (s % 8 === 0) S.play(synth('kick', 36, 0.4), t, { vel: 0.8 * vel });
            if (s % 8 === 4) S.play(synth(d === 'pop' ? 'clap' : 'snare', 60, 0.3, s), t, { vel: 0.5 * vel, rev: 0.2 });
            if (s % 2 === 0) S.play(synth('hat', 70, 0.08, s), t, { vel: 0.35 * vel, pan: 0.2 });
          } else if (d === 'dance') {
            if (s % 4 === 0) S.play(synth('kick', 36, 0.35), t, { vel: 0.9 * vel });
            if (s % 8 === 4) S.play(synth('clap', 60, 0.3, s), t, { vel: 0.55 * vel, rev: 0.2 });
            if (s % 4 === 2) S.play(synth('hat', 72, 0.25, s), t, { vel: 0.4 * vel, pan: 0.25 });
          } else if (d === 'epic') {
            if (s === 0 || s === 10) S.play(synth('timpani', 38, 1.4), t, { vel: 0.8 * vel, rev: 0.4 });
            if (s % 4 === 2 && sec === 'chorus') S.play(synth('snare', 60, 0.3, s), t, { vel: 0.35 * vel, rev: 0.4 });
            if (s === 0 && b % 8 === 2) S.play(synth('crash', 60, 2.5), t, { vel: 0.35, rev: 0.4 });
          } else if (d === 'lofi') {
            if (s === 0 || s === 7 || s === 10) S.play(synth('kick', 34, 0.4), t, { vel: 0.7 * vel });
            if (s === 4 || s === 12) S.play(synth('snare', 60, 0.3, s), t, { vel: 0.4 * vel, rev: 0.25 });
            if (s % 2 === 0) S.play(synth('hat', 68, 0.06, s), t + (s % 4 === 2 ? 0.02 : 0), { vel: 0.25 * vel });
          } else if (d === 'pulse') {
            if (s % 4 === 0) S.play(synth('kick', 30, 0.5), t, { vel: 0.7 * vel, rate: 0.8 });
          } else if (d === 'sleigh') {
            S.play(synth('hat', 80, 0.05, s), t, { vel: 0.25 * vel, pan: s % 2 ? 0.3 : -0.3 });
            if (s % 8 === 0) S.play(synth('kick', 36, 0.3), t, { vel: 0.6 * vel });
          }
        }
      }
    }
    // final chord
    const tEnd = bars * bar;
    chordNotes(sg.key, sg.scale, sg.prog[0], 3).forEach((m, i) => S.play(synth(sg.chords === 'pluck' ? 'piano' : sg.chords, m, 2.2, i), tEnd, { vel: 0.25, rev: 0.6 }));
    return S.ctx.startRendering();
  }
  // ------------------------------------------------------------------ trailer scores
  /**
   * A cinematic cue fitted to a trailer's cut points.
   * d: { duration, mood, bpm, key, scale: 'maj'|'min', seed, cues: { logoEnd, hits: [t], titleAt, creditsAt } }
   */
  const MOODS = {
    epic: { drone: 'strings', ost: 'strings', stab: 'brass', drums: 'epic', hit: 'boom', lead: 'brass' },
    action: { drone: 'strings', ost: 'strings', stab: 'brass', drums: 'action', hit: 'boom', lead: 'brass' },
    dark: { drone: 'pad', ost: 'bell', stab: 'strings', drums: 'pulse', hit: 'boom', lead: 'bell' },
    light: { drone: 'pad', ost: 'pluck', stab: 'piano', drums: 'light', hit: 'soft', lead: 'bell' },
    romantic: { drone: 'strings', ost: 'piano', stab: 'strings', drums: 'none', hit: 'soft', lead: 'piano' },
    retro: { drone: 'pad', ost: 'rhodes', stab: 'rhodes', drums: 'lofi', hit: 'soft', lead: 'lead' },
    scifi: { drone: 'pad', ost: 'lead', stab: 'pad', drums: 'pulse', hit: 'boom', lead: 'lead' },
    documentary: { drone: 'strings', ost: 'pluck', stab: 'piano', drums: 'light', hit: 'soft', lead: 'piano' },
  };
  function renderTrailerScore(d) {
    const dur = d.duration;
    const S = session(dur + 0.3, 2.8);
    const M = MOODS[d.mood] || MOODS.epic;
    const scale = d.scale === 'maj' ? MAJ : MIN;
    const beat = 60 / d.bpm, bar = beat * 4;
    const prog = d.prog || (d.scale === 'maj' ? [0, 4, 5, 3] : [0, 5, 2, 6]);
    const cues = d.cues || {};
    const logoEnd = cues.logoEnd || 0, titleAt = cues.titleAt || dur * 0.85, creditsAt = cues.creditsAt || dur;
    const root = d.key;
    // logo: a low swell
    if (logoEnd > 0.5) {
      S.play(synth(M.drone, root - 12, logoEnd + 0.6), 0, { vel: 0.45, rev: 0.6 });
      S.play(synth(M.drone, root - 5, logoEnd + 0.6, 1), 0.2, { vel: 0.25, rev: 0.6, pan: 0.2 });
      S.noise(Math.max(0, logoEnd - 1.6), 1.6, { filter: 'bandpass', q: 4, sweep: [300, 900, 2400, 5200], env: [[0.1, 0.2], [0.9, 1], [1, 0]], vel: 0.18, rev: 0.4 });
    }
    // body: an ostinato that grows toward the title
    const bodyEnd = titleAt;
    const nBars = Math.max(1, Math.ceil((bodyEnd - logoEnd) / bar));
    for (let b = 0; b < nBars; b++) {
      const t0 = logoEnd + b * bar;
      if (t0 >= bodyEnd) break;
      const k = nBars > 1 ? b / (nBars - 1) : 1;
      const deg = prog[b % prog.length];
      const chord = chordNotes(root, scale, deg, 3);
      // sustained harmony
      chord.forEach((m, i) => S.play(synth(M.drone, m - 12, Math.min(bar + 0.4, bodyEnd - t0 + 0.3), i + b), t0, { vel: (0.12 + 0.12 * k) * (i ? 0.7 : 1), pan: (i - 1) * 0.35, rev: 0.5 }));
      // ostinato (eighths, sixteenths near the end)
      const sub = M.drums === 'action' && k > 0.6 ? 4 : 2;
      for (let s = 0; s < 4 * sub; s++) {
        const t = t0 + s * beat / sub;
        if (t >= bodyEnd - 0.05) break;
        const m = chord[s % chord.length] + (s % 4 === 3 ? 12 : 0);
        S.play(synth(M.ost, m, beat / sub * 1.6, s + b * 16), t, { vel: (0.1 + 0.2 * k) * (s % 2 ? 0.75 : 1), pan: s % 2 ? 0.25 : -0.25, rev: 0.3 });
      }
      // percussion
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * beat / 4;
        if (t >= bodyEnd - 0.05) break;
        const v = 0.3 + 0.5 * k;
        if (M.drums === 'epic') { if (s === 0 || (k > 0.5 && s === 10)) S.play(synth('timpani', root - 22, 1.2), t, { vel: 0.5 * v, rev: 0.4 }); }
        else if (M.drums === 'action') { if (s % 4 === 0) S.play(synth('kick', 34, 0.4), t, { vel: 0.6 * v }); if (s % 8 === 4) S.play(synth('snare', 60, 0.3, s), t, { vel: 0.35 * v, rev: 0.3 }); if (k > 0.7 && s % 2 === 1) S.play(synth('snare', 62, 0.15, s), t, { vel: 0.18 * v }); }
        else if (M.drums === 'light') { if (s % 8 === 0) S.play(synth('kick', 38, 0.3), t, { vel: 0.4 * v }); if (s % 8 === 4) S.play(synth('clap', 60, 0.25, s), t, { vel: 0.3 * v, rev: 0.2 }); if (s % 2 === 0) S.play(synth('hat', 72, 0.06, s), t, { vel: 0.18 * v }); }
        else if (M.drums === 'lofi') { if (s === 0 || s === 7 || s === 10) S.play(synth('kick', 34, 0.4), t, { vel: 0.5 * v }); if (s === 4 || s === 12) S.play(synth('snare', 60, 0.3, s), t, { vel: 0.3 * v, rev: 0.2 }); if (s % 2 === 0) S.play(synth('hat', 68, 0.05, s), t, { vel: 0.16 * v }); }
        else if (M.drums === 'pulse') { if (s % 4 === 0) S.play(synth('kick', 28, 0.5), t, { vel: 0.45 * v, rate: 0.85 }); }
      }
    }
    // impacts on the cards
    const hit = (t, big) => {
      if (t < 0 || t >= dur) return;
      if (M.hit === 'boom') {
        S.tone(t, big ? 2.6 : 1.6, { type: 'sine', curve: [90, 55, 38, 30], env: [[0.005, 1], [0.25, 0.6], [1, 0]], vel: big ? 0.9 : 0.6 });
        S.play(synth('timpani', root - 24, 1.6), t, { vel: big ? 0.8 : 0.5, rev: 0.5 });
        S.noise(t, big ? 2.2 : 1.2, { filter: 'lowpass', freq: big ? 2400 : 1400, env: [[0.005, 1], [0.2, 0.35], [1, 0]], vel: big ? 0.35 : 0.2, rev: 0.6 });
      } else {
        S.play(synth('crash', 60, big ? 2.2 : 1.2), t, { vel: big ? 0.35 : 0.18, rev: 0.5 });
        S.play(synth('kick', 36, 0.5), t, { vel: big ? 0.6 : 0.4 });
      }
      if (big) chordNotes(root, scale, prog[0], 3).forEach((m, i) => S.play(synth(M.stab, m, 2.4, i), t, { vel: 0.3, pan: (i - 1) * 0.3, rev: 0.6 }));
    };
    (cues.hits || []).forEach((t) => hit(t, false));
    // riser into the title, then the big hit
    S.noise(Math.max(logoEnd, titleAt - 2.4), Math.min(2.4, titleAt - logoEnd), { filter: 'bandpass', q: 3, sweep: [400, 1200, 3500, 8000], env: [[0.1, 0.1], [0.95, 1], [1, 0]], vel: 0.22, rev: 0.3 });
    hit(titleAt, true);
    // title & credits: sustained chord that fades out
    const end = dur;
    const tail = Math.max(1, end - titleAt);
    chordNotes(root, scale, prog[0], 3).forEach((m, i) => S.play(synth(M.drone, m - 12, tail, 50 + i), titleAt + 0.05, { vel: 0.22, pan: (i - 1) * 0.3, rev: 0.7 }));
    if (creditsAt < end) S.play(synth(M.lead, root + 12 + scale[4], Math.max(0.5, end - creditsAt), 9), creditsAt, { vel: 0.12, rev: 0.7 });
    return S.ctx.startRendering().then((buf) => {
      // fade the last half second so the movie ends cleanly
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const x = buf.getChannelData(c), n = Math.min(x.length, Math.floor(0.5 * SR)), o = Math.floor(end * SR) - n;
        for (let i = 0; i < n && o + i < x.length; i++) x[o + i] *= 1 - i / n;
        for (let i = Math.max(0, o + n); i < x.length; i++) x[i] = 0;
      }
      return buf;
    });
  }

  async function renderSfx(def) {
    const S = session(def.duration + 0.05, 1.8);
    def.fn(S);
    return S.ctx.startRendering();
  }

  // ------------------------------------------------------------------ WAV encoding & media registration
  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
    data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
    w(36, 'data'); data.setUint32(40, n * ch * 2, true);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([data.buffer], { type: 'audio/wav' });
  }
  IM.encodeWav = wav;

  const byId = new Map();
  SFX.forEach((d) => byId.set('sfx:' + d.id, Object.assign({ kind: 'sfx' }, d)));
  SONGS.forEach((d) => byId.set('st:' + d.id, Object.assign({ kind: 'song' }, d)));

  IM.AudioGen = {
    sfx: SFX, soundtracks: SONGS,
    registerAll() { for (const [k, d] of byId) if (d.kind !== 'trailer') IM.builtinMedia(k); },
    /** Register (or look up) a trailer score; returns its built-in media id. */
    trailerScore(def) {
      const id = 'tr:' + IM.fnv(JSON.stringify(def));
      if (!byId.has(id)) byId.set(id, Object.assign({ kind: 'trailer', id, name: def.name || 'Trailer Music', genre: 'Trailer' }, def));
      return id;
    },
  };
  /** Media item for a built-in sound (registered once, generated on demand). */
  IM.builtinMedia = function (rowId) {
    const id = 'builtin:' + rowId;
    let m = IM.lib.media.get(id);
    if (m) return m;
    const d = byId.get(rowId);
    if (!d) return null;
    m = {
      id, name: d.name, kind: 'audio', builtin: rowId, hidden: true, eventId: null, duration: d.duration,
      hasAudio: true, favorites: [], rejected: [], created: 0, date: 0, size: d.duration * SR * 4, status: 'ready', fps: 30,
    };
    IM.lib.media.set(id, m);
    return m;
  };
  IM.ensureBuiltin = function (m) {
    if (m.blob) return Promise.resolve(m);
    if (m._gen) return m._gen;
    const d = byId.get(m.builtin);
    if (!d) return Promise.reject(new Error('unknown built-in sound'));
    m._gen = (async () => {
      const buf = d.kind === 'song' ? await renderSong(d) : d.kind === 'trailer' ? await renderTrailerScore(d) : await renderSfx(d);
      m.audioBuffer = buf;
      m.duration = buf.duration;
      m.blob = wav(buf);
      m.size = m.blob.size;
      m.url = URL.createObjectURL(m.blob);
      IM.lib._peaksFromBuffer(m, buf);
      IM.lib.emit('changed');
      return m;
    })();
    return m._gen;
  };
})(window.IM = window.IM || {});
