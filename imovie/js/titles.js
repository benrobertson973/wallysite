/* Title styles: animated text rendered with Canvas2D (then composited in WebGL) */
(function (IM) {
  'use strict';
  const clamp = IM.clamp, E = IM.ease;

  // ---------- helpers ----------
  function ph(st, tin, tout) {
    tin = tin == null ? 1 : tin; tout = tout == null ? 1 : tout;
    const i = tin > 0 ? clamp(st.t / tin, 0, 1) : 1;
    const o = tout > 0 ? clamp((st.dur - st.t) / tout, 0, 1) : 1;
    return { i, o, v: Math.min(i, o) };
  }
  function font(st, px, weight, family, italic) {
    let w = weight || 400;
    if (st.bold) w = Math.min(900, w + 300);
    const it = (italic || st.italic) ? 'italic ' : '';
    return `${it}${w} ${Math.max(1, Math.round(px))}px ${IM.fontStack(st.fontOverride ? st.font : (family || st.font))}`;
  }
  function setShadow(ctx, S, strength) {
    if (strength === 0) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; return; }
    ctx.shadowColor = `rgba(0,0,0,${0.55 * (strength == null ? 1 : strength)})`;
    ctx.shadowBlur = 8 * S;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * S;
  }
  function noShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }

  /**
   * Draw a line of text. o: {x,y,font,color,align,alpha,tracking,letter(i,n)->{dx,dy,a,s,r,color},outline,box:index}
   */
  function line(ctx, st, text, o) {
    if (!text) return null;
    ctx.save();
    ctx.font = o.font;
    ctx.textBaseline = 'alphabetic';
    const align = o.align || 'center';
    const tracking = o.tracking || 0;
    const chars = Array.from(text);
    let widths = null, total;
    if (tracking || o.letter) {
      widths = chars.map((ch) => ctx.measureText(ch).width + tracking);
      total = widths.reduce((a, b) => a + b, 0) - tracking;
    } else total = ctx.measureText(text).width;
    let x0 = o.x;
    if (align === 'center') x0 = o.x - total / 2;
    else if (align === 'right') x0 = o.x - total;
    const m = ctx.measureText('Hg');
    const asc = m.actualBoundingBoxAscent || parseFloat(o.font.match(/(\d+)px/)[1]) * 0.75;
    const desc = m.actualBoundingBoxDescent || asc * 0.25;
    if (st.boxes && o.box != null) st.boxes[o.box] = { x: x0, y: o.y - asc, w: Math.max(total, 20), h: asc + desc, align, font: o.font, cx: o.x, color: o.color };
    const alpha = o.alpha == null ? 1 : o.alpha;
    const color = o.color || st.color;
    const outline = st.outline || o.outline;
    const drawChar = (s, x, y) => {
      if (outline) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1.5, parseFloat(o.font.match(/(\d+)px/)[1]) * 0.06);
        ctx.strokeStyle = st.outlineColor || '#000';
        ctx.strokeText(s, x, y);
      }
      ctx.fillText(s, x, y);
    };
    ctx.fillStyle = color;
    if (!widths) {
      ctx.globalAlpha = alpha;
      drawChar(text, x0, o.y);
    } else {
      let x = x0;
      const n = chars.length;
      for (let i = 0; i < n; i++) {
        const ch = chars[i];
        const L = o.letter ? o.letter(i, n, x - x0, total) : null;
        const a = alpha * (L && L.a != null ? L.a : 1);
        if (a > 0.003) {
          ctx.globalAlpha = clamp(a, 0, 1);
          if (L && (L.s != null || L.r)) {
            ctx.save();
            const cw = widths[i] - tracking;
            ctx.translate(x + cw / 2 + (L.dx || 0), o.y + (L.dy || 0) - asc / 2);
            if (L.r) ctx.rotate(L.r);
            const s = L.s == null ? 1 : L.s;
            ctx.scale(s, s);
            if (L.color) ctx.fillStyle = L.color;
            if (L.glow) { ctx.shadowColor = L.glow; ctx.shadowBlur = L.glowBlur || 20; }
            drawChar(ch, -cw / 2, asc / 2);
            ctx.restore();
          } else {
            if (L && L.color) ctx.fillStyle = L.color; else ctx.fillStyle = color;
            drawChar(ch, x + (L ? L.dx || 0 : 0), o.y + (L ? L.dy || 0 : 0));
          }
        }
        x += widths[i];
      }
    }
    ctx.restore();
    return { x: x0, w: total, asc, desc };
  }
  function measure(ctx, text, f, tracking) {
    ctx.save(); ctx.font = f;
    let w = ctx.measureText(text || '').width + (tracking || 0) * Math.max(0, Array.from(text || '').length - 1);
    ctx.restore();
    return w;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function alignX(st, W, def, margin) {
    const a = st.alignOverride || def;
    if (a === 'left') return { x: W * (margin || 0.075), align: 'left' };
    if (a === 'right') return { x: W * (1 - (margin || 0.075)), align: 'right' };
    return { x: W / 2, align: 'center' };
  }
  const T0 = (st) => st.text[0] || '';
  const T1 = (st) => st.text[1] || '';

  // ---------- homography (maps output uv -> texture uv) ----------
  function homography(dst, src) {
    // solve for H such that src ~ H * dst ; 4 point correspondences
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [u, v] = src[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    // column-major for GLSL
    return [h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], 1];
  }

  // ---------- style definitions ----------
  const styles = [];
  function def(o) {
    styles.push(Object.assign({ fields: 2, defaults: ['Title Text Here', ''], font: 'Helvetica Neue', color: '#ffffff', align: 'center', duration: 4, size: 1 }, o));
  }
  const CENTER_Y = 0.5, LOWER_Y = 0.8;

  // Standard: lower-center title with subtitle, gentle fade
  def({
    id: 'standard', name: 'Standard', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.8, 0.8);
      const a = alignX(st, W, 'center');
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: a.x, y: H * 0.8, font: font(st, 64 * S * st.size, 500), align: a.align, alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: a.x, y: H * 0.8 + 52 * S * st.size, font: font(st, 34 * S * st.size, 400), align: a.align, alpha: p.v, box: 1 });
    },
  });
  def({
    id: 'standard-lower', name: 'Standard Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.7, 0.7);
      const a = alignX(st, W, 'left', 0.07);
      const dx = (1 - E.outCubic(p.i)) * -30 * S;
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: a.x + dx, y: H * 0.79, font: font(st, 58 * S * st.size, 600), align: a.align, alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: a.x + dx * 0.6, y: H * 0.79 + 46 * S * st.size, font: font(st, 32 * S * st.size, 400), align: a.align, alpha: p.v * 0.95, box: 1 });
    },
  });
  // Expand
  function expandRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 1, 1);
      const k = clamp(st.t / st.dur, 0, 1);
      const a = alignX(st, W, lower ? 'left' : 'center', 0.07);
      const y = lower ? H * 0.79 : H * CENTER_Y + 18 * S;
      setShadow(ctx, S, 0.8);
      line(ctx, st, T0(st).toUpperCase(), { x: a.x, y, font: font(st, 60 * S * st.size, 300), align: a.align, alpha: p.v, tracking: (4 + 22 * E.outCubic(k)) * S, box: 0 });
      line(ctx, st, T1(st), { x: a.x, y: y + 50 * S * st.size, font: font(st, 30 * S * st.size, 400), align: a.align, alpha: p.v, tracking: (2 + 8 * k) * S, box: 1 });
    };
  }
  def({ id: 'expand', name: 'Expand', render: expandRender(false) });
  def({ id: 'expand-lower', name: 'Expand Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: expandRender(true) });
  // Reveal
  function revealRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.2, 0.8);
      const a = alignX(st, W, lower ? 'left' : 'center', 0.07);
      const y = lower ? H * 0.79 : H * CENTER_Y + 16 * S;
      const f0 = font(st, 62 * S * st.size, 500);
      const w0 = measure(ctx, T0(st), f0);
      const left = a.align === 'left' ? a.x : a.align === 'right' ? a.x - w0 : a.x - w0 / 2;
      const rx = left - 40 * S + (w0 + 80 * S) * E.inOutCubic(p.i);
      ctx.save();
      const g = ctx.createLinearGradient(rx - 60 * S, 0, rx, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: a.x, y, font: f0, align: a.align, alpha: p.o, box: 0 });
      line(ctx, st, T1(st), { x: a.x, y: y + 48 * S * st.size, font: font(st, 30 * S * st.size, 400), align: a.align, alpha: p.o * E.inOutCubic(clamp((st.t - 0.6) / 0.8, 0, 1)), box: 1 });
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      if (p.i < 1) {
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - p.i)})`;
        ctx.fillRect(rx - 2 * S, y - 60 * S * st.size, 3 * S, 80 * S * st.size);
        ctx.restore();
      }
    };
  }
  def({ id: 'reveal', name: 'Reveal', render: revealRender(false) });
  def({ id: 'reveal-lower', name: 'Reveal Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: revealRender(true) });
  // Focus (uses GL blur)
  function focusRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.1, 1);
      const a = alignX(st, W, lower ? 'left' : 'center', 0.07);
      const y = lower ? H * 0.79 : H * CENTER_Y + 16 * S;
      setShadow(ctx, S, 0.7);
      line(ctx, st, T0(st), { x: a.x, y, font: font(st, 64 * S * st.size, 400), align: a.align, alpha: Math.min(1, p.v * 1.4), box: 0 });
      line(ctx, st, T1(st), { x: a.x, y: y + 50 * S * st.size, font: font(st, 32 * S * st.size, 300), align: a.align, alpha: Math.min(1, p.v * 1.4), box: 1 });
      return { blur: (1 - E.outCubic(p.v)) * 26 * S };
    };
  }
  def({ id: 'focus', name: 'Focus', render: focusRender(false) });
  def({ id: 'focus-lower', name: 'Focus Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: focusRender(true) });
  // Line
  function lineRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.2, 0.9);
      const a = alignX(st, W, lower ? 'left' : 'center', 0.07);
      const y = lower ? H * 0.8 : H * CENTER_Y;
      const f0 = font(st, 56 * S * st.size, 500);
      const w = Math.max(measure(ctx, T0(st), f0), measure(ctx, T1(st), font(st, 30 * S * st.size, 400))) + 40 * S;
      const lp = E.inOutCubic(clamp(p.i * 1.6, 0, 1)) * p.o;
      ctx.save();
      setShadow(ctx, S, 0.5);
      ctx.fillStyle = st.color;
      const lw = w * lp;
      const lx = a.align === 'left' ? a.x : a.align === 'right' ? a.x - lw : a.x - lw / 2;
      ctx.globalAlpha = p.o;
      ctx.fillRect(lx, y - 1.5 * S, lw, 3 * S);
      ctx.restore();
      const tp = E.outCubic(clamp((p.i - 0.4) / 0.6, 0, 1));
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, y - 2 * S); ctx.clip();
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: a.x, y: y - 14 * S + (1 - tp) * 60 * S, font: f0, align: a.align, alpha: p.o * tp, box: 0 });
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y + 2 * S, W, H); ctx.clip();
      setShadow(ctx, S);
      line(ctx, st, T1(st), { x: a.x, y: y + 38 * S - (1 - tp) * 50 * S, font: font(st, 30 * S * st.size, 400), align: a.align, alpha: p.o * tp, box: 1 });
      ctx.restore();
    };
  }
  def({ id: 'line', name: 'Line', defaults: ['Title Text Here', 'Subtitle'], render: lineRender(false) });
  def({ id: 'line-lower', name: 'Line Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: lineRender(true) });
  // Pop-up
  function popRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.6, 0.45);
      const f0 = font(st, 50 * S * st.size, 600), f1 = font(st, 28 * S * st.size, 400);
      const w = Math.max(measure(ctx, T0(st), f0), measure(ctx, T1(st), f1)) + 70 * S;
      const hh = (T1(st) ? 118 : 84) * S * st.size;
      const cx = lower ? W * 0.07 + w / 2 : W / 2;
      const cy = lower ? H * 0.8 - 20 * S : H * CENTER_Y;
      const sc = p.i < 1 ? E.outBack(p.i) : E.inQuad(p.o) * 0 + (p.o < 1 ? E.outCubic(p.o) : 1);
      ctx.save();
      ctx.translate(cx, cy + hh / 2);
      ctx.scale(sc, sc);
      ctx.translate(-cx, -(cy + hh / 2));
      setShadow(ctx, S, 0.8);
      ctx.fillStyle = st.boxColor || '#2c78f2';
      roundRect(ctx, cx - w / 2, cy - hh / 2, w, hh, 10 * S);
      ctx.fill();
      noShadow(ctx);
      line(ctx, st, T0(st), { x: cx, y: cy + (T1(st) ? -4 : 18) * S * st.size, font: f0, align: 'center', box: 0 });
      line(ctx, st, T1(st), { x: cx, y: cy + 36 * S * st.size, font: f1, align: 'center', alpha: 0.9, box: 1 });
      ctx.restore();
    };
  }
  def({ id: 'popup', name: 'Pop-up', defaults: ['Title Text Here', ''], render: popRender(false) });
  def({ id: 'popup-lower', name: 'Pop-up Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: popRender(true) });
  // Gravity
  function gravityRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S;
      const a = alignX(st, W, lower ? 'left' : 'center', 0.07);
      const y = lower ? H * 0.79 : H * CENTER_Y + 18 * S;
      const outStart = st.dur - 1.0;
      const letter = (i, n, off, total) => {
        const d = 0.9 * (i / Math.max(1, n));
        const ti = clamp((st.t - d * 0.8) / 0.9, 0, 1);
        let dy = -(1 - E.outBounce(ti)) * (y + 60 * S);
        let a1 = ti > 0 ? 1 : 0;
        if (st.t > outStart) {
          const to = clamp((st.t - outStart - (i / Math.max(1, n)) * 0.3) / 0.7, 0, 1);
          dy += to * to * (H - y + 120 * S);
          return { dy, a: a1, r: to * 0.6 * (i % 2 ? 1 : -1), s: 1 };
        }
        return { dy, a: a1 };
      };
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: a.x, y, font: font(st, 64 * S * st.size, 700), align: a.align, letter, box: 0 });
      line(ctx, st, T1(st), { x: a.x, y: y + 50 * S * st.size, font: font(st, 30 * S * st.size, 400), align: a.align, letter: (i, n) => letter(i + n, n * 2), box: 1 });
    };
  }
  def({ id: 'gravity', name: 'Gravity', render: gravityRender(false) });
  def({ id: 'gravity-lower', name: 'Gravity Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: gravityRender(true) });
  // Prism
  function prismRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.1, 0.9);
      const a = alignX(st, W, lower ? 'left' : 'center', 0.07);
      const y = lower ? H * 0.79 : H * CENTER_Y + 16 * S;
      const off = (1 - E.outCubic(p.v)) * 70 * S;
      const f0 = font(st, 62 * S * st.size, 600);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cols = ['#ff2a2a', '#2aff4a', '#2a6bff'];
      cols.forEach((c, k) => {
        line(ctx, st, T0(st), { x: a.x + (k - 1) * off, y: y + (k - 1) * off * 0.2, font: f0, align: a.align, color: c, alpha: p.v, box: k === 1 ? 0 : null });
        line(ctx, st, T1(st), { x: a.x - (k - 1) * off * 0.6, y: y + 48 * S * st.size, font: font(st, 30 * S * st.size, 400), align: a.align, color: c, alpha: p.v, box: k === 1 ? 1 : null });
      });
      ctx.restore();
    };
  }
  def({ id: 'prism', name: 'Prism', render: prismRender(false) });
  def({ id: 'prism-lower', name: 'Prism Lower Third', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: prismRender(true) });
  // Centered
  def({
    id: 'centered', name: 'Centered', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.8, 0.8);
      const sc = 1 + (1 - p.i) * 0.04;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2);
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: W / 2, y: H * 0.5 + 20 * S, font: font(st, 80 * S * st.size, 600), align: 'center', alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: H * 0.5 + 76 * S * st.size, font: font(st, 36 * S * st.size, 400), align: 'center', alpha: p.v, box: 1 });
      ctx.restore();
    },
  });
  // Overlap
  def({
    id: 'overlap', name: 'Overlap', defaults: ['Title Text', 'Here'],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1, 1);
      const k = st.t / st.dur;
      ctx.save();
      setShadow(ctx, S, 0.4);
      line(ctx, st, T0(st).toUpperCase(), { x: W * 0.42 + k * 60 * S, y: H * 0.47, font: font(st, 150 * S * st.size, 800), align: 'center', alpha: p.v * 0.55, box: 0 });
      line(ctx, st, T1(st).toUpperCase(), { x: W * 0.58 - k * 60 * S, y: H * 0.47 + 110 * S * st.size, font: font(st, 150 * S * st.size, 800), align: 'center', alpha: p.v * 0.55, box: 1 });
      ctx.restore();
    },
  });
  // Four Corners
  def({
    id: 'four-corners', name: 'Four Corners', fields: 4, defaults: ['Title Text', 'Here', 'Title Text', 'Here'],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.8, 0.8);
      const f = font(st, 44 * S * st.size, 500);
      setShadow(ctx, S);
      const m = 0.06;
      line(ctx, st, st.text[0] || '', { x: W * m, y: H * 0.12, font: f, align: 'left', alpha: p.v, box: 0 });
      line(ctx, st, st.text[1] || '', { x: W * (1 - m), y: H * 0.12, font: f, align: 'right', alpha: p.v, box: 1 });
      line(ctx, st, st.text[2] || '', { x: W * m, y: H * 0.93, font: f, align: 'left', alpha: p.v, box: 2 });
      line(ctx, st, st.text[3] || '', { x: W * (1 - m), y: H * 0.93, font: f, align: 'right', alpha: p.v, box: 3 });
    },
  });
  // Scrolling Credits
  def({
    id: 'scrolling-credits', name: 'Scrolling Credits', duration: 10, fields: 2, multiline: [false, true],
    defaults: ['Credits', 'Director\tName\nProducer\tName\nEditor\tName\nMusic\tName\nStarring\tName\n\nMade with\tiMovie'],
    render(ctx, W, H, st) {
      const S = st.S;
      const lines = (st.text[1] || '').split('\n');
      const lh = 52 * S * st.size;
      const total = 120 * S + lines.length * lh;
      const k = clamp(st.t / st.dur, 0, 1);
      const y0 = H + 40 * S - k * (H + total + 80 * S);
      setShadow(ctx, S, 0.8);
      line(ctx, st, T0(st), { x: W / 2, y: y0, font: font(st, 60 * S * st.size, 600), align: 'center', box: 0 });
      lines.forEach((ln, i) => {
        const y = y0 + 110 * S + i * lh;
        if (y < -60 * S || y > H + 60 * S) return;
        const parts = ln.split('\t');
        if (parts.length > 1) {
          line(ctx, st, parts[0], { x: W / 2 - 20 * S, y, font: font(st, 34 * S * st.size, 300), align: 'right', alpha: 0.85 });
          line(ctx, st, parts.slice(1).join(' '), { x: W / 2 + 20 * S, y, font: font(st, 34 * S * st.size, 600), align: 'left' });
        } else line(ctx, st, ln, { x: W / 2, y, font: font(st, 34 * S * st.size, 500), align: 'center' });
      });
      if (st.boxes) st.boxes[1] = { x: W * 0.25, y: y0 + 70 * S, w: W * 0.5, h: Math.min(H * 0.6, lines.length * lh), align: 'center', multiline: true };
    },
  });
  // Drifting
  def({
    id: 'drifting', name: 'Drifting', defaults: ['Title Text Here', ''], font: 'Avenir Next',
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.2, 1.2);
      const dx = (0.5 - st.t / st.dur) * 120 * S;
      setShadow(ctx, S, 0.6);
      line(ctx, st, T0(st), { x: W / 2 + dx, y: H * 0.52, font: font(st, 72 * S * st.size, 200), align: 'center', alpha: p.v, tracking: 3 * S, box: 0 });
      line(ctx, st, T1(st), { x: W / 2 + dx * 0.6, y: H * 0.52 + 56 * S * st.size, font: font(st, 32 * S * st.size, 300), align: 'center', alpha: p.v, box: 1 });
    },
  });
  // Sideways Drift
  def({
    id: 'sideways-drift', name: 'Sideways Drift', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S;
      const tin = 0.9, tout = 0.9;
      let x;
      if (st.t < tin) x = W * 0.5 + (1 - E.outCubic(st.t / tin)) * W * 0.7;
      else if (st.t > st.dur - tout) x = W * 0.5 - 40 * S - E.inCubic((st.t - (st.dur - tout)) / tout) * W * 0.8;
      else x = W * 0.5 - 40 * S * ((st.t - tin) / Math.max(0.01, st.dur - tin - tout));
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x, y: H * 0.8, font: font(st, 60 * S * st.size, 600), align: 'center', box: 0 });
      line(ctx, st, T1(st), { x: x + 20 * S, y: H * 0.8 + 46 * S * st.size, font: font(st, 30 * S * st.size, 400), align: 'center', box: 1 });
    },
  });
  // Zoom
  def({
    id: 'zoom', name: 'Zoom', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.9, 0.8);
      let sc = 1;
      if (p.i < 1) sc = 1 + (1 - E.outCubic(p.i)) * 3.2;
      else if (p.o < 1) sc = 0.3 + 0.7 * E.outCubic(p.o);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2);
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: W / 2, y: H * 0.5 + 20 * S, font: font(st, 70 * S * st.size, 700), align: 'center', alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: H * 0.5 + 70 * S * st.size, font: font(st, 32 * S * st.size, 400), align: 'center', alpha: p.v, box: 1 });
      ctx.restore();
    },
  });
  // Horizontal Blur
  def({
    id: 'horizontal-blur', name: 'Horizontal Blur', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.9, 0.9);
      const k = p.i < 1 ? 1 - E.outCubic(p.i) : -(1 - E.outCubic(p.o));
      const x = W / 2 - k * W * 0.35;
      const f0 = font(st, 66 * S * st.size, 600);
      setShadow(ctx, S, 0.5);
      const trail = Math.abs(k) * 120 * S;
      for (let j = 6; j >= 1; j--) {
        const off = (j / 6) * trail * Math.sign(k || 1);
        line(ctx, st, T0(st), { x: x + off, y: H * 0.52, font: f0, align: 'center', alpha: 0.12 * (1 - j / 7) * (Math.abs(k) > 0.001 ? 1 : 0) });
      }
      line(ctx, st, T0(st), { x, y: H * 0.52, font: f0, align: 'center', alpha: Math.min(p.i, p.o) > 0 ? 1 - Math.abs(k) * 0.5 : 0, box: 0 });
      line(ctx, st, T1(st), { x: x + k * 60 * S, y: H * 0.52 + 50 * S * st.size, font: font(st, 30 * S * st.size, 400), align: 'center', alpha: 1 - Math.abs(k), box: 1 });
      return { blur: Math.abs(k) * 3 * S };
    },
  });
  // Soft Edge
  def({
    id: 'soft-edge', name: 'Soft Edge', align: 'left', defaults: ['Title Text Here', 'Subtitle'],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.8, 0.8);
      const y = H * 0.78, bh = 150 * S * st.size;
      ctx.save();
      ctx.globalAlpha = p.v * 0.85;
      const g = ctx.createLinearGradient(0, y - bh / 2, 0, y + bh / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(0,0,0,0.7)'); g.addColorStop(0.7, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, y - bh / 2, W, bh);
      ctx.restore();
      const a = alignX(st, W, 'left', 0.08);
      line(ctx, st, T0(st), { x: a.x, y: y + 2 * S, font: font(st, 52 * S * st.size, 500), align: a.align, alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: a.x, y: y + 42 * S * st.size, font: font(st, 28 * S * st.size, 400), align: a.align, alpha: p.v * 0.9, box: 1 });
    },
  });
  // Lens Flare
  def({
    id: 'lens-flare', name: 'Lens Flare', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.4, 0.8);
      const fx = -W * 0.1 + W * 1.2 * E.inOutSine(clamp(st.t / 1.6, 0, 1));
      const y = H * 0.52;
      ctx.save();
      setShadow(ctx, S, 0.7);
      line(ctx, st, T0(st), { x: W / 2, y, font: font(st, 70 * S * st.size, 300), align: 'center', alpha: p.o, tracking: 4 * S, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: y + 54 * S * st.size, font: font(st, 30 * S * st.size, 400), align: 'center', alpha: p.o, box: 1 });
      if (p.i < 1) {
        ctx.globalCompositeOperation = 'destination-in';
        const g = ctx.createLinearGradient(fx - 120 * S, 0, fx + 10 * S, 0);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      const fa = clamp(1 - Math.abs(st.t - 0.8) / 1.0, 0, 1);
      if (fa > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const r = 180 * S;
        const g = ctx.createRadialGradient(fx, y - 20 * S, 0, fx, y - 20 * S, r);
        g.addColorStop(0, `rgba(255,255,240,${0.95 * fa})`); g.addColorStop(0.2, `rgba(255,220,160,${0.45 * fa})`); g.addColorStop(1, 'rgba(255,160,80,0)');
        ctx.fillStyle = g; ctx.fillRect(fx - r, y - 20 * S - r, r * 2, r * 2);
        const sg = ctx.createLinearGradient(0, 0, W, 0);
        sg.addColorStop(0, 'rgba(120,170,255,0)'); sg.addColorStop(clamp(fx / W, 0.01, 0.99), `rgba(200,220,255,${0.6 * fa})`); sg.addColorStop(1, 'rgba(120,170,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, y - 22 * S, W, 4 * S);
        for (let k = 1; k <= 4; k++) {
          const gx = W / 2 + (W / 2 - fx) * (k * 0.35), gy = H / 2 + (H / 2 - y) * k * 0.35;
          const rr = (18 + k * 12) * S;
          const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
          gg.addColorStop(0, `rgba(160,200,255,${0.18 * fa})`); gg.addColorStop(1, 'rgba(160,200,255,0)');
          ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(gx, gy, rr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    },
  });
  // Pull Focus
  def({
    id: 'pull-focus', name: 'Pull Focus', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.4, 1);
      const sc = 1.12 - 0.12 * E.outCubic(p.i);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2);
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: W / 2, y: H * 0.52, font: font(st, 72 * S * st.size, 500), align: 'center', alpha: clamp(p.v * 1.5, 0, 1), box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: H * 0.52 + 54 * S * st.size, font: font(st, 32 * S * st.size, 400), align: 'center', alpha: clamp(p.v * 1.5, 0, 1), box: 1 });
      ctx.restore();
      return { blur: (1 - E.outQuad(p.v)) * 34 * S };
    },
  });
  // Boogie Lights
  def({
    id: 'boogie-lights', name: 'Boogie Lights', defaults: ['Title Text Here', ''], font: 'Futura',
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.2, 0.8);
      const y = H * 0.52;
      const letter = (i, n) => {
        const d = (i / Math.max(1, n)) * 0.8;
        const ti = clamp((st.t - d) / 0.5, 0, 1);
        const hue = (i * 37 + st.t * 120) % 360;
        const bounce = Math.sin(st.t * 6 + i * 0.9) * 6 * S * (1 - ti * 0.6);
        return { dy: (1 - E.outBack(ti)) * 40 * S + bounce, a: ti * p.o, s: 0.6 + 0.4 * E.outBack(ti), glow: `hsla(${hue},100%,65%,0.95)`, glowBlur: 24 * S, color: '#fff' };
      };
      line(ctx, st, T0(st), { x: W / 2, y, font: font(st, 70 * S * st.size, 700), align: 'center', letter, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: y + 58 * S * st.size, font: font(st, 32 * S * st.size, 500), align: 'center', letter: (i, n) => letter(i + 3, n + 3), box: 1 });
      // floating lights
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 26; k++) {
        const h1 = IM.hash(k * 3.1), h2 = IM.hash(k * 7.7), h3 = IM.hash(k * 1.3);
        const lx = W * (0.15 + 0.7 * h1) + Math.sin(st.t * (1 + h2) + k) * 40 * S;
        const ly = y - 40 * S + Math.cos(st.t * (1.3 + h3) + k) * 90 * S;
        const r = (6 + 14 * h3) * S;
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        g.addColorStop(0, `hsla(${(h1 * 360 + st.t * 60) % 360},100%,70%,${0.5 * p.v})`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    },
  });
  // Pixie Dust
  def({
    id: 'pixie-dust', name: 'Pixie Dust', defaults: ['Title Text Here', ''], font: 'Snell Roundhand',
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1.6, 0.9);
      const y = H * 0.54;
      const f0 = font(st, 80 * S * st.size, 400, 'Snell Roundhand', false);
      const w0 = measure(ctx, T0(st), f0);
      const x0 = W / 2 - w0 / 2 - 30 * S, x1 = W / 2 + w0 / 2 + 30 * S;
      const sx = x0 + (x1 - x0) * E.inOutSine(p.i);
      const sy = y - 30 * S + Math.sin(p.i * Math.PI * 3) * 26 * S;
      ctx.save();
      setShadow(ctx, S, 0.6);
      line(ctx, st, T0(st), { x: W / 2, y, font: f0, align: 'center', alpha: p.o, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: y + 56 * S * st.size, font: font(st, 30 * S * st.size, 400), align: 'center', alpha: p.o * p.i, box: 1 });
      if (p.i < 1) {
        ctx.globalCompositeOperation = 'destination-in';
        const g = ctx.createLinearGradient(sx - 90 * S, 0, sx, 0);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      // sparkles
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const n = 70;
      for (let k = 0; k < n; k++) {
        const age = IM.hash(k * 12.9898 + 1);
        const tk = p.i - age * 0.35;
        if (tk < 0 || tk > 1) continue;
        const px = x0 + (x1 - x0) * E.inOutSine(clamp(tk, 0, 1)) + (IM.hash(k * 4.1) - 0.5) * 40 * S;
        const py = y - 30 * S + Math.sin(tk * Math.PI * 3) * 26 * S + (IM.hash(k * 9.3) - 0.5) * 70 * S + age * 60 * S;
        const life = clamp(1 - (p.i - tk) * 2.5, 0, 1) * p.o;
        const r = (2 + 5 * IM.hash(k * 2.7)) * S * (0.4 + life);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
        g.addColorStop(0, `rgba(255,250,220,${0.9 * life})`); g.addColorStop(0.3, `rgba(255,215,120,${0.5 * life})`); g.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r * 3, 0, Math.PI * 2); ctx.fill();
      }
      if (p.i > 0 && p.i < 1) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 40 * S);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.3, 'rgba(255,230,150,0.5)'); g.addColorStop(1, 'rgba(255,220,120,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 40 * S, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    },
  });
  // Organic
  function organicRender(lower) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.8, 0.7);
      const f0 = font(st, 56 * S * st.size, 700, 'Futura'), f1 = font(st, 28 * S * st.size, 500, 'Futura');
      const w = Math.max(measure(ctx, T0(st), f0), measure(ctx, T1(st), f1)) + 110 * S;
      const hh = (T1(st) ? 150 : 110) * S * st.size;
      const cx = lower ? W * 0.07 + w / 2 : W / 2, cy = lower ? H * 0.78 : H * 0.5;
      const sc = E.outBack(p.i) * (p.o < 1 ? E.outCubic(p.o) : 1);
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.rotate(-0.03);
      ctx.beginPath();
      const N = 36;
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI * 2;
        const wob = 1 + 0.06 * Math.sin(a * 5 + 1.3) + 0.04 * Math.sin(a * 9 + st.t * 0.8) + 0.03 * Math.cos(a * 3);
        const x = Math.cos(a) * (w / 2) * wob * (1 + 0.1 * Math.abs(Math.cos(a)));
        const y = Math.sin(a) * (hh / 2) * wob;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      setShadow(ctx, S, 0.6);
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#e86a2f'); g.addColorStop(1, '#f2b134');
      ctx.fillStyle = g; ctx.fill();
      noShadow(ctx);
      ctx.rotate(0.03); ctx.translate(-cx, -cy);
      line(ctx, st, T0(st), { x: cx, y: cy + (T1(st) ? -2 : 20) * S * st.size, font: f0, align: 'center', box: 0 });
      line(ctx, st, T1(st), { x: cx, y: cy + 38 * S * st.size, font: f1, align: 'center', box: 1 });
      ctx.restore();
    };
  }
  def({ id: 'organic-main', name: 'Organic Main', render: organicRender(false) });
  def({ id: 'organic-lower', name: 'Organic Lower', align: 'left', defaults: ['Title Text Here', 'Subtitle'], render: organicRender(true) });
  // Ticker
  def({
    id: 'ticker', name: 'Ticker', duration: 8, defaults: ['Title Text Here — Title Text Here — Title Text Here', 'NEWS'],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.5, 0.5);
      const bh = 64 * S * st.size, y = H * 0.86;
      ctx.save();
      ctx.globalAlpha = p.v;
      ctx.fillStyle = 'rgba(12,18,30,0.82)'; ctx.fillRect(0, y, W, bh);
      const lw = T1(st) ? measure(ctx, T1(st), font(st, 30 * S * st.size, 800)) + 50 * S : 0;
      const f0 = font(st, 32 * S * st.size, 500);
      const tw = measure(ctx, T0(st), f0);
      const speed = 160 * S;
      const x = W - ((st.t * speed) % (tw + W));
      ctx.beginPath(); ctx.rect(lw, y, W - lw, bh); ctx.clip();
      line(ctx, st, T0(st), { x, y: y + bh * 0.66, font: f0, align: 'left', box: 0 });
      ctx.restore();
      if (T1(st)) {
        ctx.save(); ctx.globalAlpha = p.v;
        ctx.fillStyle = '#d7263d'; ctx.fillRect(0, y, lw, bh);
        line(ctx, st, T1(st), { x: lw / 2, y: y + bh * 0.66, font: font(st, 30 * S * st.size, 800), align: 'center', box: 1 });
        ctx.restore();
      }
    },
  });
  // Date/Time
  def({
    id: 'date-time', name: 'Date/Time', align: 'right',
    defaults: [new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.6, 0.6);
      const a = alignX(st, W, 'right', 0.06);
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: a.x, y: H * 0.86, font: font(st, 40 * S * st.size, 500), align: a.align, alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: a.x, y: H * 0.86 + 38 * S * st.size, font: font(st, 28 * S * st.size, 300), align: a.align, alpha: p.v * 0.9, box: 1 });
    },
  });
  // Clouds (full-frame sky)
  def({
    id: 'clouds', name: 'Clouds', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1, 1);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#4f8fd9'); g.addColorStop(1, '#b8d8f2');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let k = 0; k < 16; k++) {
        const cx = ((IM.hash(k * 5.3) * 1.4 - 0.2) * W + st.t * (20 + 30 * IM.hash(k)) * S) % (W * 1.4) - W * 0.2;
        const cy = H * (0.1 + 0.8 * IM.hash(k * 2.9));
        const r = (120 + 160 * IM.hash(k * 8.1)) * S;
        for (let j = 0; j < 5; j++) {
          const ox = (j - 2) * r * 0.45, oy = Math.sin(j * 1.7 + k) * r * 0.15;
          const rg = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r * 0.6);
          rg.addColorStop(0, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r * 0.6, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.save(); ctx.shadowColor = 'rgba(40,80,140,0.6)'; ctx.shadowBlur = 20 * S;
      line(ctx, st, T0(st), { x: W / 2, y: H * 0.52, font: font(st, 80 * S * st.size, 600), align: 'center', alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: H * 0.52 + 60 * S * st.size, font: font(st, 34 * S * st.size, 400), align: 'center', alpha: p.v, box: 1 });
      ctx.restore();
    },
  });
  // Far Far Away (perspective crawl)
  def({
    id: 'far-far-away', name: 'Far Far Away', duration: 14, color: '#f5d41f', font: 'Futura', multiline: [false, true],
    defaults: ['Title Text Here', 'A long time ago, in an editing\nsuite far, far away, a movie\nwas being made with titles\nthat crawled into the stars.'],
    render(ctx, W, H, st) {
      const S = st.S;
      const lines = (st.text[1] || '').split('\n');
      const lh = 64 * S * st.size;
      const k = st.t / st.dur;
      const y0 = H * 1.05 - k * (H * 1.1 + lines.length * lh + 200 * S);
      const col = st.color || '#f5d41f';
      line(ctx, st, T0(st).toUpperCase(), { x: W / 2, y: y0, font: font(st, 70 * S * st.size, 700), align: 'center', color: col, box: 0 });
      lines.forEach((ln, i) => {
        line(ctx, st, ln, { x: W / 2, y: y0 + 110 * S + i * lh, font: font(st, 48 * S * st.size, 600), align: 'center', color: col });
      });
      if (st.boxes) st.boxes[1] = { x: W * 0.2, y: y0 + 60 * S, w: W * 0.6, h: lines.length * lh, align: 'center', multiline: true };
      // fade into distance
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      const g = ctx.createLinearGradient(0, 0, 0, H * 0.45);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.45);
      ctx.restore();
      const fade = clamp(st.t / 0.6, 0, 1) * clamp((st.dur - st.t) / 0.8, 0, 1);
      if (st.static) return { opacity: fade };
      const Hm = homography([[-0.35, 1.02], [1.35, 1.02], [0.36, 0.04], [0.64, 0.04]], [[0, 1], [1, 1], [0, 0], [1, 0]]);
      return { H: Hm, opacity: fade };
    },
  });
  // Gradient / Soft Bar
  function barRender(kind, light) {
    return function (ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.7, 0.7);
      ctx.save(); ctx.globalAlpha = p.v;
      const c = light ? '255,255,255' : '0,0,0';
      if (kind === 'gradient') {
        const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
        g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(1, `rgba(${c},${light ? 0.92 : 0.85})`);
        ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);
      } else {
        const y = H * 0.74, bh = 120 * S * st.size;
        const g = ctx.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, `rgba(${c},0.0)`); g.addColorStop(0.15, `rgba(${c},0.82)`); g.addColorStop(0.85, `rgba(${c},0.82)`); g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, y, W, bh);
      }
      ctx.restore();
      const tc = light ? (st.colorSet ? st.color : '#1d1d1f') : st.color;
      const y = kind === 'gradient' ? H * 0.86 : H * 0.74 + 66 * S * st.size;
      line(ctx, st, T0(st), { x: W / 2, y, font: font(st, 52 * S * st.size, 600), align: 'center', color: tc, alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: y + 40 * S * st.size, font: font(st, 28 * S * st.size, 400), align: 'center', color: tc, alpha: p.v * 0.9, box: 1 });
    };
  }
  def({ id: 'gradient-white', name: 'Gradient - White', color: '#1d1d1f', render: barRender('gradient', true) });
  def({ id: 'soft-bar-white', name: 'Soft Bar - White', color: '#1d1d1f', render: barRender('bar', true) });
  def({ id: 'gradient-black', name: 'Gradient - Black', render: barRender('gradient', false) });
  def({ id: 'soft-bar-black', name: 'Soft Bar - Black', render: barRender('bar', false) });
  // Paper
  def({
    id: 'paper', name: 'Paper', color: '#2b2b2b', font: 'American Typewriter', align: 'left', defaults: ['Title Text Here', 'Subtitle'],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.7, 0.6);
      const f0 = font(st, 44 * S * st.size, 400, 'American Typewriter'), f1 = font(st, 26 * S * st.size, 400, 'American Typewriter');
      const w = Math.max(measure(ctx, T0(st), f0), measure(ctx, T1(st), f1)) + 70 * S;
      const hh = (T1(st) ? 118 : 86) * S * st.size;
      const x = W * 0.07, y = H * 0.72 + (1 - E.outCubic(p.i)) * H * 0.35 + (1 - p.o) * H * 0.35;
      ctx.save();
      ctx.translate(x + w / 2, y + hh / 2); ctx.rotate(-0.025); ctx.translate(-(x + w / 2), -(y + hh / 2));
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 16 * S; ctx.shadowOffsetY = 6 * S;
      ctx.fillStyle = '#f4efe2'; ctx.fillRect(x, y, w, hh);
      noShadow(ctx);
      ctx.fillStyle = 'rgba(160,140,100,0.12)';
      for (let k = 0; k < 5; k++) ctx.fillRect(x, y + hh * (0.2 + k * 0.18), w, 1 * S);
      line(ctx, st, T0(st), { x: x + 35 * S, y: y + (T1(st) ? 52 : 56) * S * st.size, font: f0, align: 'left', box: 0 });
      line(ctx, st, T1(st), { x: x + 35 * S, y: y + 92 * S * st.size, font: f1, align: 'left', alpha: 0.8, box: 1 });
      ctx.restore();
    },
  });
  // Formal
  def({
    id: 'formal', name: 'Formal', font: 'Didot', defaults: ['Title Text Here', 'Subtitle'],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1, 1);
      const y = H * 0.5;
      const f0 = font(st, 64 * S * st.size, 400, 'Didot');
      const w = Math.max(measure(ctx, T0(st), f0, 6 * S), 300 * S) + 80 * S;
      const lp = E.inOutCubic(p.i) * p.o;
      ctx.save();
      ctx.globalAlpha = p.v;
      ctx.strokeStyle = st.color; ctx.lineWidth = 1.5 * S;
      ctx.beginPath(); ctx.moveTo(W / 2 - w / 2 * lp, y - 80 * S); ctx.lineTo(W / 2 + w / 2 * lp, y - 80 * S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 - w / 2 * lp, y + 70 * S); ctx.lineTo(W / 2 + w / 2 * lp, y + 70 * S); ctx.stroke();
      ctx.fillStyle = st.color;
      ctx.translate(W / 2, y - 80 * S); ctx.rotate(Math.PI / 4); ctx.fillRect(-5 * S, -5 * S, 10 * S, 10 * S);
      ctx.restore();
      setShadow(ctx, S, 0.5);
      line(ctx, st, T0(st), { x: W / 2, y: y + 8 * S, font: f0, align: 'center', alpha: p.v, tracking: 6 * S, box: 0 });
      line(ctx, st, T1(st).toUpperCase(), { x: W / 2, y: y + 50 * S * st.size, font: font(st, 22 * S * st.size, 400, 'Didot'), align: 'center', alpha: p.v, tracking: 8 * S, box: 1 });
    },
  });
  // Split
  def({
    id: 'split', name: 'Split', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.8, 0.8);
      const k = 1 - E.outCubic(Math.min(p.i, p.o));
      const y = H * 0.52, f0 = font(st, 76 * S * st.size, 800);
      const draw = () => {
        setShadow(ctx, S);
        line(ctx, st, T0(st).toUpperCase(), { x: W / 2, y, font: f0, align: 'center', box: 0 });
        line(ctx, st, T1(st), { x: W / 2, y: y + 56 * S * st.size, font: font(st, 32 * S * st.size, 400), align: 'center', box: 1 });
      };
      const mid = y - 26 * S;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, mid); ctx.clip(); ctx.translate(0, -k * 90 * S); ctx.globalAlpha = 1 - k; draw(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(0, mid, W, H); ctx.clip(); ctx.translate(0, k * 90 * S); ctx.globalAlpha = 1 - k; draw(); ctx.restore();
    },
  });
  // Echo
  def({
    id: 'echo', name: 'Echo', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 1, 0.9);
      const k = 1 - E.outCubic(p.i);
      const y = H * 0.52, f0 = font(st, 70 * S * st.size, 700);
      for (let j = 4; j >= 1; j--) {
        const off = (j * 36 * S) * (0.3 + k);
        line(ctx, st, T0(st), { x: W / 2 - off, y, font: f0, align: 'center', alpha: 0.16 * (5 - j) / 4 * p.v });
      }
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: W / 2 - k * 200 * S, y, font: f0, align: 'center', alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: y + 54 * S * st.size, font: font(st, 32 * S * st.size, 400), align: 'center', alpha: p.v, box: 1 });
    },
  });
  // Upper / Lower
  def({
    id: 'upper', name: 'Upper', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.7, 0.7);
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: W / 2, y: H * 0.17, font: font(st, 60 * S * st.size, 500), align: 'center', alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: H * 0.17 + 46 * S * st.size, font: font(st, 30 * S * st.size, 400), align: 'center', alpha: p.v, box: 1 });
    },
  });
  def({
    id: 'lower', name: 'Lower', defaults: ['Title Text Here', ''],
    render(ctx, W, H, st) {
      const S = st.S, p = ph(st, 0.7, 0.7);
      setShadow(ctx, S);
      line(ctx, st, T0(st), { x: W / 2, y: H * 0.88, font: font(st, 54 * S * st.size, 500), align: 'center', alpha: p.v, box: 0 });
      line(ctx, st, T1(st), { x: W / 2, y: H * 0.88 + 40 * S * st.size, font: font(st, 28 * S * st.size, 400), align: 'center', alpha: p.v, box: 1 });
    },
  });

  const map = new Map(styles.map((s) => [s.id, s]));
  IM.TitleStyles = { list: styles, get: (id) => map.get(id) || map.get('standard') };

  /**
   * Render a title item into a 2D context of size W x H at local time t.
   * Returns {blur, H, opacity} extra params for compositing.
   */
  IM.renderTitle = function (ctx, W, H, title, t, dur, opts) {
    opts = opts || {};
    const style = IM.TitleStyles.get(title.style);
    const st = {
      t: clamp(t, 0, dur), dur: Math.max(0.1, dur), S: H / 1080,
      text: title.text || [], font: title.font || style.font, fontOverride: title.font && title.font !== style.font,
      size: title.size || 1, color: title.color || style.color, colorSet: title.color && title.color !== style.color,
      alignOverride: title.align && title.align !== style.align ? title.align : null,
      bold: !!title.bold, italic: !!title.italic, outline: !!title.outline, outlineColor: title.outlineColor,
      boxes: opts.boxes || null, static: !!opts.static,
    };
    ctx.save();
    const r = style.render(ctx, W, H, st) || {};
    ctx.restore();
    return r;
  };
  /** Time at which a title is "fully on screen" for static previews and editing. */
  IM.titleRestTime = function (title, dur) {
    const s = IM.TitleStyles.get(title.style);
    if (s.id === 'scrolling-credits' || s.id === 'far-far-away') return dur * 0.35;
    if (s.id === 'ticker') return 1.5;
    return Math.min(dur / 2, Math.max(1.8, dur * 0.45));
  };
})(window.IM = window.IM || {});
