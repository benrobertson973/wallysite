/* ==========================================================================
   Stabilization — "Stabilize Shaky Video" and "Fix Rolling Shutter"
   --------------------------------------------------------------------------
   * Analysis runs once per media file, in 10-second chunks and only where
     clips use the file. Frames are decoded with WebCodecs at a small size and
     the global motion between consecutive frames (translation + rotation) is
     estimated by coarse-to-fine block matching and a robust similarity fit.
     Results are stored in IndexedDB, keyed by the frames' own timestamps.
   * A clip's correction depends only on the analysis inside the clip's source
     range, its stabilization amount and its rolling-shutter level. It is
     looked up with the timestamp of the frame actually being drawn, so the
     viewer and the export stabilize identically. The compositor applies it in
     the clip shader (see Compose.layer / Renderer.clipUniforms).
   ========================================================================== */
(function (IM) {
  'use strict';
  const VERSION = 1;
  const CHUNK = 10;        // seconds of source per analysis chunk
  const AW = 192;          // analysis width (sensor orientation)
  const RS = { none: 0, low: 0.3, medium: 0.5, high: 0.7, extra: 0.9 };
  const clamp = IM.clamp;

  const media = new Map();   // mediaId -> { rot, asp, chunks: Map(k -> rec), ts, mo, rev }
  const jobs = new Map();    // mediaId:k -> Promise
  const corr = new Map();    // correction cache key -> result
  const wanted = new Set();  // item ranges requested by the viewer while data was missing
  let queue = Promise.resolve();
  let active = 0;

  const chunkOf = (t) => Math.max(0, Math.floor(t / CHUNK));
  const dbKey = (id, k) => 'stab:' + id + ':' + k;

  function rsLevel(v) {
    const r = v && v.rollingShutter;
    if (!r || r === 'none') return 0;
    if (r === true) return RS.medium;
    return RS[r] || 0;
  }
  function needsStab(v) { return !!v && ((v.stabilize || 0) > 0 || rsLevel(v) > 0); }

  /** Source range [a, b] a clip displays, padded to cover the frame shown at its first instant. */
  function itemRange(it) {
    if (it.type === 'freeze') return [it.frameTime, it.frameTime];
    return [it.srcIn, Math.max(it.srcIn, it.srcOut)];
  }
  function chunksFor(a, b) {
    const out = [];
    for (let k = chunkOf(a - 0.1); k <= chunkOf(b); k++) out.push(k);
    return out;
  }

  // ------------------------------------------------------------------ image helpers
  function normalize(L) {
    const n = L.length;
    let s = 0;
    for (let i = 0; i < n; i++) s += L[i];
    const mean = s / n;
    let q = 0;
    for (let i = 0; i < n; i++) { const e = L[i] - mean; q += e * e; }
    const k = 40 / (Math.sqrt(q / n) + 1);
    for (let i = 0; i < n; i++) L[i] = (L[i] - mean) * k;  // exposure-independent
    return L;
  }
  function normLuma(d, n) {
    const L = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return normalize(L);
  }
  // Decoded-frame formats whose first plane is luma (value = bytes per sample).
  const YUV = { I420: 1, I420A: 1, I422: 1, I422A: 1, I444: 1, I444A: 1, NV12: 1, I420P10: 2, I420P12: 2, I420AP10: 2, I422P10: 2, I422P12: 2, I422AP10: 2, I444P10: 2, I444P12: 2, I444AP10: 2 };
  /** Luma of a decoded sample, box-downsampled to W x H, read straight from the frame's planes (no GPU readback). */
  async function sampleLuma(s, W, H, scratch) {
    const fmt = s.format;
    const bps = YUV[fmt];
    const rgb = fmt === 'RGBA' || fmt === 'RGBX' || fmt === 'BGRA' || fmt === 'BGRX';
    if (!bps && !rgb) return null;
    const size = s.allocationSize();
    if (!scratch.buf || scratch.buf.byteLength < size) scratch.buf = new Uint8Array(size);
    const layout = await s.copyTo(scratch.buf);
    const vw = s.codedWidth, vh = s.codedHeight;
    const key = vw + 'x' + vh;
    if (scratch.key !== key) {
      scratch.key = key;
      scratch.xb = new Int32Array(vw); scratch.yb = new Int32Array(vh);
      for (let x = 0; x < vw; x++) scratch.xb[x] = Math.min(W - 1, Math.floor((x * W) / vw));
      for (let y = 0; y < vh; y++) scratch.yb[y] = Math.min(H - 1, Math.floor((y * H) / vh));
      scratch.cnt = new Float32Array(W * H);
      for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) scratch.cnt[scratch.yb[y] * W + scratch.xb[x]]++;
    }
    const { xb, yb, cnt } = scratch;
    const out = new Float32Array(W * H);
    const { offset, stride } = layout[0];
    if (bps === 1) {
      const B = scratch.buf;
      for (let y = 0; y < vh; y++) {
        const o = yb[y] * W, base = offset + y * stride;
        for (let x = 0; x < vw; x++) out[o + xb[x]] += B[base + x];
      }
    } else if (bps === 2) {
      const B = new Uint16Array(scratch.buf.buffer, scratch.buf.byteOffset, scratch.buf.byteLength >> 1);
      for (let y = 0; y < vh; y++) {
        const o = yb[y] * W, base = (offset + y * stride) >> 1;
        for (let x = 0; x < vw; x++) out[o + xb[x]] += B[base + x];
      }
    } else {
      const B = scratch.buf, bgr = fmt[0] === 'B';
      const kr = bgr ? 0.114 : 0.299, kb = bgr ? 0.299 : 0.114;
      for (let y = 0; y < vh; y++) {
        const o = yb[y] * W, base = offset + y * stride;
        for (let x = 0, i = base; x < vw; x++, i += 4) out[o + xb[x]] += kr * B[i] + 0.587 * B[i + 1] + kb * B[i + 2];
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= cnt[i] || 1;
    return normalize(out);
  }
  function down(src, w, h) {
    const W = w >> 1, H = h >> 1, o = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      let i = 2 * y * w;
      for (let x = 0; x < W; x++, i += 2) o[y * W + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) * 0.25;
    }
    return { d: o, w: W, h: H };
  }
  function pyramid(L, w, h) {
    const l0 = { d: L, w, h }, l1 = down(L, w, h), l2 = down(l1.d, l1.w, l1.h);
    return [l0, l1, l2];
  }
  function globalShift(a, b, R) {
    const w = a.w, h = a.h, A = a.d, B = b.d;
    let best = Infinity, bx = 0, by = 0;
    for (let sy = -R; sy <= R; sy++) for (let sx = -R; sx <= R; sx++) {
      const x0 = Math.max(0, -sx), x1 = Math.min(w, w - sx), y0 = Math.max(0, -sy), y1 = Math.min(h, h - sy);
      let s = 0;
      for (let y = y0; y < y1; y++) {
        let ia = y * w + x0, ib = (y + sy) * w + x0 + sx;
        for (let x = x0; x < x1; x++, ia++, ib++) s += Math.abs(A[ia] - B[ib]);
      }
      const v = s / ((x1 - x0) * (y1 - y0)) + 0.05 * (Math.abs(sx) + Math.abs(sy));
      if (v < best) { best = v; bx = sx; by = sy; }
    }
    return { x: bx, y: by };
  }
  function sad(a, b, ax, ay, bx, by, bs) {
    if (bx < 0 || by < 0 || bx + bs > b.w || by + bs > b.h) return Infinity;
    const w = a.w, A = a.d, B = b.d;
    let s = 0;
    for (let y = 0; y < bs; y++) {
      let ia = (ay + y) * w + ax, ib = (by + y) * w + bx;
      for (let x = 0; x < bs; x++, ia++, ib++) s += Math.abs(A[ia] - B[ib]);
    }
    return s;
  }
  /** Minimum eigenvalue of the gradient structure tensor (per pixel) — rejects flat and edge-only blocks. */
  function cornerness(l, x0, y0, bs) {
    const w = l.w, D = l.d;
    let xx = 0, yy = 0, xy = 0;
    for (let y = y0; y < y0 + bs; y++) for (let x = x0; x < x0 + bs; x++) {
      const i = y * w + x;
      const gx = (x + 1 < l.w ? D[i + 1] : D[i]) - (x > 0 ? D[i - 1] : D[i]);
      const gy = (y + 1 < l.h ? D[i + w] : D[i]) - (y > 0 ? D[i - w] : D[i]);
      xx += gx * gx; yy += gy * gy; xy += gx * gy;
    }
    const n = bs * bs, t = (xx + yy) / 2, d = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
    return (t - d) / n;
  }
  function median(arr) {
    if (!arr.length) return 0;
    const s = Float64Array.from(arr).sort();
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function solve4(M, v) {
    const A = M.map((r, i) => r.concat([v[i]]));
    for (let c = 0; c < 4; c++) {
      let p = c;
      for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-9) return null;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < 4; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 5; k++) A[r][k] -= f * A[c][k];
      }
    }
    return [A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2], A[3][4] / A[3][3]];
  }
  /** Robust fit of u = tx + a*x - b*y, v = ty + b*x + a*y (similarity, small angle). */
  function fitSimilarity(P) {
    let tx = median(P.map((p) => p.u)), ty = median(P.map((p) => p.v)), a = 0, b = 0;
    if (P.length < 4) return { tx, ty, a, b, inl: P.length ? 1 : 0 };
    let inl = 1;
    for (let it = 0; it < 6; it++) {
      const res = P.map((p) => Math.hypot(p.u - (tx + a * p.x - b * p.y), p.v - (ty + b * p.x + a * p.y)));
      const sc = Math.max(0.35, 1.4826 * median(res));
      const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], V = [0, 0, 0, 0];
      let good = 0;
      P.forEach((p, i) => {
        const r = res[i], k = 1.5 * sc;
        const w = r <= k ? 1 : k / r;   // Huber
        if (r < 2.5 * sc) good++;
        const r1 = [1, 0, p.x, -p.y], r2 = [0, 1, p.y, p.x];
        for (let m = 0; m < 4; m++) {
          V[m] += w * (r1[m] * p.u + r2[m] * p.v);
          for (let n = 0; n < 4; n++) M[m][n] += w * (r1[m] * r1[n] + r2[m] * r2[n]);
        }
      });
      inl = good / P.length;
      const s = solve4(M, V);
      if (!s) break;
      [tx, ty, a, b] = s;
    }
    return { tx, ty, a, b, inl };
  }

  /** Motion from frame A to frame B (pyramids): [tx, ty] in units of frame height, rotation (rad), quality. */
  function estimate(PA, PB) {
    const [a0, a1, a2] = PA, [b0, b1, b2] = PB;
    const g = globalShift(a2, b2, 8);
    const BS = 16, H = a0.h, W = a0.w;
    const cols = 8, rows = 5, pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      // block top-left at level 0 (even so it maps onto level 1)
      const x0 = (Math.round(((c + 0.5) / cols) * (W - BS * 2) + BS / 2) >> 1) << 1;
      const y0 = (Math.round(((r + 0.5) / rows) * (H - BS * 2) + BS / 2) >> 1) << 1;
      if (cornerness(a0, x0, y0, BS) < 6) continue;
      // level 1 search around the global shift
      const hx = x0 >> 1, hy = y0 >> 1;
      let best = Infinity, dx1 = 0, dy1 = 0;
      for (let dy = 2 * g.y - 3; dy <= 2 * g.y + 3; dy++) for (let dx = 2 * g.x - 3; dx <= 2 * g.x + 3; dx++) {
        const s = sad(a1, b1, hx, hy, hx + dx, hy + dy, BS >> 1) + 0.5 * (Math.abs(dx - 2 * g.x) + Math.abs(dy - 2 * g.y));
        if (s < best) { best = s; dx1 = dx; dy1 = dy; }
      }
      if (!isFinite(best)) continue;
      // level 0 refine
      let cx = 2 * dx1, cy = 2 * dy1, s0 = Infinity;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const s = sad(a0, b0, x0, y0, x0 + cx + dx, y0 + cy + dy, BS);
          if (s < s0 - 1e-9) { s0 = s; if (dx || dy) { cx += dx; cy += dy; moved = true; } }
        }
        if (!moved) break;
      }
      if (!isFinite(s0)) continue;
      // sub-pixel (parabola through neighbours)
      const sp = (m, z, p) => { const d = m - 2 * z + p; return isFinite(d) && d > 1e-6 ? clamp(0.5 * (m - p) / d, -0.5, 0.5) : 0; };
      const fx = sp(sad(a0, b0, x0, y0, x0 + cx - 1, y0 + cy, BS), s0, sad(a0, b0, x0, y0, x0 + cx + 1, y0 + cy, BS));
      const fy = sp(sad(a0, b0, x0, y0, x0 + cx, y0 + cy - 1, BS), s0, sad(a0, b0, x0, y0, x0 + cx, y0 + cy + 1, BS));
      pts.push({ x: x0 + BS / 2 - W / 2, y: y0 + BS / 2 - H / 2, u: cx + fx, v: cy + fy, err: s0 / (BS * BS) });
    }
    if (pts.length < 3) return [4 * g.x / H, 4 * g.y / H, 0, 0];
    const f = fitSimilarity(pts);
    const err = median(pts.map((p) => p.err));
    // a scene change (or chaos) — no usable motion
    if (f.inl < 0.35 || err > 30) return [0, 0, 0, 0];
    // Only trust a rotation that is well determined (points spread over the frame) and explains the
    // motion clearly better than translation alone — moving objects must not tilt the picture.
    const t = fitTranslation(pts);
    const r1 = pts.map((p) => Math.hypot(p.u - (f.tx + f.a * p.x - f.b * p.y), p.v - (f.ty + f.b * p.x + f.a * p.y)));
    const s1 = Math.max(0.35, 1.4826 * median(r1));
    const inl = pts.filter((p, i) => r1[i] < 2.5 * s1);
    const spread = (k) => { const mu = inl.reduce((a, p) => a + p[k], 0) / inl.length; return Math.sqrt(inl.reduce((a, p) => a + (p[k] - mu) ** 2, 0) / inl.length); };
    const rms = (fn) => Math.sqrt(inl.reduce((a, p) => { const [du, dv] = fn(p); return a + du * du + dv * dv; }, 0) / Math.max(1, inl.length));
    const e1 = rms((p) => [p.u - (f.tx + f.a * p.x - f.b * p.y), p.v - (f.ty + f.b * p.x + f.a * p.y)]);
    const e0 = rms((p) => [p.u - t.tx, p.v - t.ty]);
    const rotOK = inl.length >= 8 && spread('x') > 0.15 * W && spread('y') > 0.12 * H && (e1 < 0.7 * e0 || e0 < 0.25) && Math.abs(f.b) < 0.06;
    if (!rotOK) return [t.tx / H, t.ty / H, 0, 1];
    return [f.tx / H, f.ty / H, f.b, 1];
  }
  function fitTranslation(P) {
    let tx = median(P.map((p) => p.u)), ty = median(P.map((p) => p.v));
    for (let it = 0; it < 4; it++) {
      const res = P.map((p) => Math.hypot(p.u - tx, p.v - ty));
      const sc = Math.max(0.35, 1.4826 * median(res)), k = 1.5 * sc;
      let sw = 0, su = 0, sv = 0;
      P.forEach((p, i) => { const w = res[i] <= k ? 1 : k / res[i]; sw += w; su += w * p.u; sv += w * p.v; });
      if (sw > 0) { tx = su / sw; ty = sv / sw; }
    }
    return { tx, ty };
  }

  // ------------------------------------------------------------------ analysis
  async function analyzeChunk(m, k, onProgress, cancelled) {
    const mb = await IM.loadMediabunny();
    if (!mb || typeof VideoDecoder === 'undefined') throw new Error('Stabilization needs WebCodecs, which this browser doesn’t support.');
    if (!m.blob && m.builtin) await IM.ensureBuiltin(m);
    if (!m.blob) throw new Error('The media file isn’t available.');
    const input = new mb.Input({ source: new mb.BlobSource(m.blob), formats: mb.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error(`“${m.name}” can’t be analyzed in this browser.`);
      const sw = track.squarePixelWidth || track.codedWidth, sh = track.squarePixelHeight || track.codedHeight;
      const W = AW, H = Math.max(24, Math.round((AW * sh) / sw / 4) * 4);
      const sink = new mb.VideoSampleSink(track);
      const scratch = {};
      let ctx = null;
      const t0 = k * CHUNK, t1 = (k + 1) * CHUNK;
      const dur = Math.max(0.1, Math.min(t1, m.duration || t1) - t0);
      const ts = [], mo = [];
      let prev = null, n = 0;
      for await (const smp of sink.samples(k === 0 ? 0 : t0 - 1e-6, t1)) {
        let L = null;
        const t = smp.timestamp;
        try {
          if (cancelled && cancelled()) throw new Error('cancelled');
          try { L = await sampleLuma(smp, W, H, scratch); } catch (e) { L = null; }
          if (!L) {
            // formats without CPU-readable planes: draw the raw (unrotated) frame through a canvas
            if (!ctx) { const c = document.createElement('canvas'); c.width = W; c.height = H; ctx = c.getContext('2d', { willReadFrequently: true }); }
            ctx.drawImage(smp.toCanvasImageSource(), 0, 0, W, H);
            L = normLuma(ctx.getImageData(0, 0, W, H).data, W * H);
          }
        } finally { smp.close(); }
        const P = pyramid(L, W, H);
        if (k === 0 || t >= t0 - 1e-9) {
          ts.push(t);
          mo.push(...(prev ? estimate(prev, P) : [0, 0, 0, 0]));
        }
        prev = P;
        if (onProgress && (++n & 7) === 0) onProgress(clamp((t - t0) / dur, 0, 1));
        if ((n & 15) === 0) await new Promise((r) => setTimeout(r, 0));  // keep the UI responsive
      }
      return { v: VERSION, k, rot: track.rotation || 0, W, H, ts: Float64Array.from(ts), mo: Float32Array.from(mo) };
    } finally {
      try { input.dispose && input.dispose(); } catch (e) { /* */ }
    }
  }

  function rec(id) {
    let D = media.get(id);
    if (!D) { D = { rot: 0, asp: 16 / 9, chunks: new Map(), ts: null, mo: null, rev: 0 }; media.set(id, D); }
    return D;
  }
  function addChunk(id, c) {
    const D = rec(id);
    D.chunks.set(c.k, c);
    D.rot = c.rot; D.asp = c.W / c.H;
    D.ts = null; D.mo = null; D.rev++;
  }
  function merged(D) {
    if (D.ts) return D;
    const ks = Array.from(D.chunks.keys()).sort((a, b) => a - b);
    let n = 0;
    for (const k of ks) n += D.chunks.get(k).ts.length;
    const ts = new Float64Array(n), mo = new Float32Array(4 * n);
    let o = 0;
    for (const k of ks) { const c = D.chunks.get(k); ts.set(c.ts, o); mo.set(c.mo, 4 * o); o += c.ts.length; }
    D.ts = ts; D.mo = mo;
    return D;
  }

  function ensureChunk(m, k, onProgress, cancelled) {
    const D = media.get(m.id);
    if (D && D.chunks.has(k)) return Promise.resolve();
    const key = m.id + ':' + k;
    if (jobs.has(key)) return jobs.get(key);
    const job = (async () => {
      const stored = await IM.DB.get('kv', dbKey(m.id, k));
      if (stored && stored.v === VERSION && stored.ts && stored.mo) { addChunk(m.id, stored); return; }
      // one analysis at a time — decoding is heavy
      const run = queue.then(async () => {
        active++;
        IM.bus.emit('stab-progress', { active });
        try {
          const c = await analyzeChunk(m, k, onProgress, cancelled);
          addChunk(m.id, c);
          if (!m.hidden) IM.DB.put('kv', dbKey(m.id, k), c);
        } finally {
          active--;
          IM.bus.emit('stab-progress', { active });
        }
      });
      queue = run.catch(() => {});
      await run;
    })();
    jobs.set(key, job);
    job.then(() => jobs.delete(key), () => jobs.delete(key));
    return job;
  }

  function ready(it, m) {
    const D = media.get(m.id);
    if (!D) return false;
    const [a, b] = itemRange(it);
    return chunksFor(a, b).every((k) => D.chunks.has(k) || k * CHUNK > (m.duration || 0) + 0.5);
  }

  /** Analyze everything clip `it` needs. onProgress(0..1). */
  async function ensureItem(it, onProgress, cancelled) {
    const m = IM.lib.get(it.mediaId);
    if (!m) throw new Error('The clip’s media is missing.');
    const [a, b] = itemRange(it);
    const ks = chunksFor(a, b).filter((k) => k * CHUNK <= (m.duration || 0) + 0.5);
    for (let i = 0; i < ks.length; i++) {
      await ensureChunk(m, ks[i], (p) => onProgress && onProgress((i + p) / ks.length), cancelled);
    }
    if (onProgress) onProgress(1);
  }

  // ------------------------------------------------------------------ corrections
  function upper(ts, t) {  // largest index with ts[i] <= t (or 0)
    let lo = 0, hi = ts.length - 1, r = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  function smoothLinear(src, n, sigma) {
    const R = Math.max(1, Math.ceil(3 * sigma)), g = new Float64Array(R + 1);
    for (let i = 0; i <= R; i++) g[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      const j0 = Math.max(0, i - R), j1 = Math.min(n - 1, i + R);
      for (let j = j0; j <= j1; j++) {
        const x = j - i, w = g[Math.abs(x)], y = src[j];
        sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y;
      }
      const den = sw * sxx - sx * sx;
      out[i] = den > 1e-9 ? (sy * sxx - sx * sxy) / den : sy / sw;  // local linear fit, evaluated at i
    }
    return out;
  }
  function itemCorrection(it, m) {
    const v = it.video || {};
    const amount = clamp(v.stabilize || 0, 0, 1), k = rsLevel(v);
    const [a, b] = itemRange(it);
    const D = media.get(m.id);
    if (!D || !ready(it, m)) return null;
    const key = [m.id, a, b, amount, k, D.rev].join('|');
    let C = corr.get(key);
    if (C) return C;
    merged(D);
    if (!D.ts.length) return null;
    const i0 = upper(D.ts, a + 0.0015), i1 = Math.max(i0, upper(D.ts, Math.max(a + 0.0015, b - 1e-6)));
    const n = i1 - i0 + 1, asp = D.asp;
    // cumulative transform of frame i0's content: A_j(p) = R(th_j) p + T_j
    const th = new Float64Array(n), tx = new Float64Array(n), ty = new Float64Array(n);
    for (let j = 1; j < n; j++) {
      const o = 4 * (i0 + j), bb = D.mo[o + 2], cs = Math.cos(bb), sn = Math.sin(bb);
      th[j] = th[j - 1] + bb;
      tx[j] = cs * tx[j - 1] - sn * ty[j - 1] + D.mo[o];
      ty[j] = sn * tx[j - 1] + cs * ty[j - 1] + D.mo[o + 1];
    }
    const span = n > 1 ? D.ts[i1] - D.ts[i0] : 0;
    const fps = n > 1 && span > 0 ? (n - 1) / span : (m.fps || 30);
    const out = new Float32Array(5 * n);
    let sX = null, sY = null;
    if (amount > 0 && n > 2) {
      const sigma = Math.max(1, fps * (0.1 + 1.4 * amount));
      const sTh = smoothLinear(th, n, sigma);
      sX = smoothLinear(tx, n, sigma); sY = smoothLinear(ty, n, sigma);
      for (let j = 0; j < n; j++) {
        const ca = th[j] - sTh[j], cs = Math.cos(ca), sn = Math.sin(ca);
        out[5 * j] = tx[j] - (cs * sX[j] - sn * sY[j]);
        out[5 * j + 1] = ty[j] - (sn * sX[j] + cs * sY[j]);
        out[5 * j + 2] = ca;
      }
    }
    // rolling shutter: content velocity (frame heights per frame) around each frame
    if (k > 0) {
      for (let j = 0; j < n; j++) {
        const i = i0 + j;
        const pv = j > 0 ? [D.mo[4 * i], D.mo[4 * i + 1]] : null;
        const nx = j < n - 1 ? [D.mo[4 * (i + 1)], D.mo[4 * (i + 1) + 1]] : null;
        const vv = pv && nx ? [(pv[0] + nx[0]) / 2, (pv[1] + nx[1]) / 2] : (pv || nx || [0, 0]);
        out[5 * j + 3] = vv[0]; out[5 * j + 4] = vv[1];
      }
    }
    // one zoom for the whole clip, big enough for most frames' corrections (limited by the amount)
    const need = [];
    for (let j = 0; j < n; j++) {
      const o = 5 * j, ca = Math.abs(out[o + 2]), cs = Math.cos(ca), sn = Math.sin(ca);
      const rx = Math.abs(out[o]) + Math.abs(out[o + 3]) * k / 2, ry = Math.abs(out[o + 1]) + Math.abs(out[o + 4]) * k / 2;
      const zx = (asp / 2 * cs + 0.5 * sn) / Math.max(1e-3, asp / 2 - rx);
      const zy = (asp / 2 * sn + 0.5 * cs) / Math.max(1e-3, 0.5 - ry);
      need.push(Math.max(1, zx, zy));
    }
    need.sort((x, y) => x - y);
    const zmax = 1 + (amount > 0 ? 0.04 + 0.26 * amount : 0.12);
    const z = clamp(need[Math.min(n - 1, Math.floor(n * 0.9))] || 1, 1, zmax);
    // limit each frame's correction so the zoomed picture always covers the frame
    for (let j = 0; j < n; j++) {
      const o = 5 * j;
      let ca = out[o + 2];
      const hx = asp / (2 * z), hy = 1 / (2 * z);
      const ext = (x) => [hx * Math.abs(Math.cos(x)) + hy * Math.abs(Math.sin(x)), hx * Math.abs(Math.sin(x)) + hy * Math.abs(Math.cos(x))];
      let e = ext(ca), guard = 0;
      while ((e[0] > asp / 2 || e[1] > 0.5) && guard++ < 40) { ca *= 0.85; e = ext(ca); }
      if (ca !== out[o + 2] && sX) {
        // recompute the translation for the reduced angle
        const cs = Math.cos(ca), sn = Math.sin(ca);
        out[o] = tx[j] - (cs * sX[j] - sn * sY[j]); out[o + 1] = ty[j] - (sn * sX[j] + cs * sY[j]);
        out[o + 2] = ca;
      }
      const rsx = Math.abs(out[o + 3]) * k / 2, rsy = Math.abs(out[o + 4]) * k / 2;
      const mx = Math.max(0, asp / 2 - e[0] - rsx), my = Math.max(0, 0.5 - e[1] - rsy);
      out[o] = clamp(out[o], -mx, mx);
      out[o + 1] = clamp(out[o + 1], -my, my);
    }
    C = { ts: D.ts.slice(i0, i1 + 1), d: out, z: amount > 0 || k > 0 ? z : 1, k, rot: D.rot, asp };
    if (corr.size > 64) corr.delete(corr.keys().next().value);
    corr.set(key, C);
    return C;
  }

  // sensor vector -> texture vector for a texture rotated `rel` degrees clockwise from the sensor image
  function toTex(x, y, rel, asp) {
    if (rel === 90) return [-y / asp, x / asp];
    if (rel === 180) return [-x, -y];
    if (rel === 270) return [y / asp, -x / asp];
    return [x, y];
  }

  function request(it, m) {
    const key = m.id + '|' + itemRange(it).join('|');
    if (wanted.has(key)) return;
    wanted.add(key);
    ensureItem(it).then(() => IM.bus.emit('stab-ready', { mediaId: m.id }), (e) => { console.warn('Stabilization analysis failed', e); IM.bus.emit('stab-failed', { mediaId: m.id, error: e }); });
  }

  IM.stabilizer = {
    VERSION,
    needs: needsStab,
    rsLevel,
    ready(it) { const m = IM.lib.get(it.mediaId); return !!m && ready(it, m); },
    isBusy() { return active > 0; },
    /** Make sure clip `it` is analyzed (loads stored analysis, or analyzes). */
    analyze(it, onProgress, cancelled) { return ensureItem(it, onProgress, cancelled); },
    ensure: ensureItem,
    /**
     * Uniforms for one frame of clip `it`, or null if the analysis isn't loaded yet.
     * ts: timestamp of the source frame being drawn; metaRot: rotation the texture still needs;
     * texAsp: texture width / height.
     */
    forFrame(it, m, ts, metaRot, texAsp, noRequest) {
      if (!m || m.kind !== 'video') return null;
      const C = itemCorrection(it, m);
      if (!C) { if (!noRequest) request(it, m); return null; }
      const j = clamp(upper(C.ts, ts + 1e-3), 0, C.ts.length - 1), o = 5 * j;
      const rel = ((((C.rot - (metaRot || 0)) % 360) + 360) % 360);
      const c = toTex(C.d[o], C.d[o + 1], rel, C.asp);
      const vv = toTex(C.d[o + 3], C.d[o + 4], rel, C.asp);
      const dir = toTex(0, 1, rel, 1);
      const scale = rel === 90 || rel === 270 ? C.asp : 1;
      return { s: [c[0], c[1], C.d[o + 2], C.z], rs: [vv[0], vv[1], C.k * scale, texAsp], dir };
    },
    /** Remove stored analysis for a media item (on delete). */
    forget(id, duration) {
      media.delete(id);
      const n = Math.ceil((duration || 0) / CHUNK) + 1;
      for (let k = 0; k < n; k++) IM.DB.del('kv', dbKey(id, k));
    },
    _estimate: estimate, _pyramid: pyramid, _normLuma: normLuma, _media: media,
  };
})(window.IM = window.IM || {});
