/* GLSL sources: clip processing + filters, transitions, backgrounds, compositing. GLSL ES 1.00. */
(function (IM) {
  'use strict';

  const COMMON = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_res;
const float PI = 3.14159265;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
vec3 satur(vec3 c, float s) { float l = luma(c); return mix(vec3(l), c, s); }
vec3 contr(vec3 c, float k) { return (c - 0.5) * k + 0.5; }
float easeio(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
`;

  // ---------------------------------------------------------------- clip / filters
  const CLIP_HEAD = COMMON + `
uniform sampler2D u_tex;
uniform vec4 u_rect;
uniform float u_rot;
uniform float u_flip;
uniform float u_outside;
uniform vec3 u_gains;
uniform vec3 u_levels;
uniform float u_contrast;
uniform float u_sat;
uniform float u_temp;
uniform float u_opacity;
uniform float u_amount;
vec2 rotUV(vec2 p) {
  if (u_rot > 2.5) return vec2(1.0 - p.y, p.x);
  if (u_rot > 1.5) return vec2(1.0 - p.x, 1.0 - p.y);
  if (u_rot > 0.5) return vec2(p.y, 1.0 - p.x);
  return p;
}
vec4 srcRaw(vec2 uv) {
  vec2 p = u_rect.xy + uv * u_rect.zw;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return vec4(0.0);
  vec2 s = rotUV(p);
  if (u_flip > 0.5) s.x = 1.0 - s.x;
  return texture2D(u_tex, s);
}
vec3 src(vec2 uv) { vec4 c = srcRaw(uv); return c.a > 0.001 ? c.rgb / c.a : vec3(0.0); }
vec3 adjust(vec3 c) {
  c *= u_gains;
  float l = luma(c);
  c += u_levels.x * 0.32 * (1.0 - smoothstep(0.0, 0.55, l));
  c += u_levels.z * 0.32 * smoothstep(0.45, 1.0, l);
  c = pow(max(c, vec3(0.0)), vec3(pow(2.0, -u_levels.y * 1.1)));
  c = contr(c, 1.0 + u_contrast);
  c = satur(c, u_sat);
  c *= vec3(1.0 + 0.13 * u_temp, 1.0 + 0.02 * u_temp, 1.0 - 0.15 * u_temp);
  return clamp(c, 0.0, 1.0);
}
vec3 px(vec2 uv) { return adjust(src(uv)); }
vec3 blur9(vec2 uv, float r) {
  vec2 o = vec2(r * u_res.y / u_res.x, r);
  vec3 a = px(uv) * 0.2;
  a += (px(uv + vec2(o.x, 0.0)) + px(uv - vec2(o.x, 0.0)) + px(uv + vec2(0.0, o.y)) + px(uv - vec2(0.0, o.y))) * 0.12;
  a += (px(uv + o) + px(uv - o) + px(uv + vec2(o.x, -o.y)) + px(uv + vec2(-o.x, o.y))) * 0.08;
  return a;
}
vec3 bloom(vec2 uv, float r) { return (blur9(uv, r) + blur9(uv, r * 2.3)) * 0.5; }
float vig(vec2 uv, float amt) {
  vec2 d = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  return 1.0 - amt * smoothstep(0.3, 1.0, length(d));
}
float grain(vec2 uv, float amt) { return (hash12(uv * u_res + fract(u_time * 7.13) * 431.0) - 0.5) * amt; }
vec3 sepia(vec3 c) { return clamp(vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))), 0.0, 1.0); }
float sobel(vec2 uv) {
  vec2 o = 1.3 / u_res;
  float tl = luma(px(uv + vec2(-o.x, -o.y))), t = luma(px(uv + vec2(0.0, -o.y))), tr = luma(px(uv + vec2(o.x, -o.y)));
  float l = luma(px(uv + vec2(-o.x, 0.0))), r = luma(px(uv + vec2(o.x, 0.0)));
  float bl = luma(px(uv + vec2(-o.x, o.y))), b = luma(px(uv + vec2(0.0, o.y))), br = luma(px(uv + vec2(o.x, o.y)));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return sqrt(gx * gx + gy * gy);
}
float scratches(vec2 uv) {
  float ft = floor(u_time * 14.0);
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = hash12(vec2(ft, fi * 7.1));
    float on = step(0.55, hash12(vec2(ft, fi + 21.0)));
    s += on * (1.0 - smoothstep(0.0, 0.0016, abs(uv.x - x))) * (0.4 + 0.6 * vnoise(vec2(uv.y * 30.0, ft + fi)));
  }
  float dust = step(0.9975, hash12(floor(uv * u_res / 3.0) + ft * 13.0));
  return clamp(s + dust, 0.0, 1.0);
}
float flicker(float amt) { return 1.0 - amt + amt * hash12(vec2(floor(u_time * 18.0), 3.7)); }
`;

  const FILTERS = {
    'none': 'return c;',
    'vivid': 'c = contr(c, 1.08); return clamp(satur(c, 1.45), 0.0, 1.0);',
    'vivid-warm': 'c = contr(c, 1.08); c = satur(c, 1.4); return clamp(c * vec3(1.1, 1.0, 0.84), 0.0, 1.0);',
    'vivid-cool': 'c = contr(c, 1.08); c = satur(c, 1.4); return clamp(c * vec3(0.86, 1.0, 1.12), 0.0, 1.0);',
    'dramatic': 'c = satur(c, 0.72); c = contr(c, 1.38); c = pow(max(c, 0.0), vec3(1.12)); return clamp(c, 0.0, 1.0);',
    'dramatic-warm': 'c = satur(c, 0.75); c = contr(c, 1.38); c = pow(max(c, 0.0), vec3(1.1)); return clamp(c * vec3(1.12, 1.0, 0.8), 0.0, 1.0);',
    'dramatic-cool': 'c = satur(c, 0.75); c = contr(c, 1.38); c = pow(max(c, 0.0), vec3(1.1)); return clamp(c * vec3(0.82, 0.98, 1.16), 0.0, 1.0);',
    'mono': 'return vec3(luma(c));',
    'silvertone': 'float l = luma(c); l = contr(vec3(l), 1.12).x; return clamp(vec3(l) * vec3(0.95, 0.98, 1.04) + 0.03, 0.0, 1.0);',
    'noir': 'float l = luma(c); l = smoothstep(0.08, 0.92, l); l = contr(vec3(l), 1.35).x; return clamp(vec3(l) * vig(uv, 0.55), 0.0, 1.0);',
    'black-white': 'return vec3(luma(c));',
    'sepia': 'return sepia(c);',
    'blockbuster': `float l = luma(c);
      c = mix(c * vec3(0.78, 1.04, 1.18), c, smoothstep(0.0, 0.55, l));
      c = mix(c, c * vec3(1.18, 1.0, 0.8), smoothstep(0.45, 1.0, l));
      c = contr(c, 1.18); return clamp(satur(c, 1.12), 0.0, 1.0);`,
    'dreamy': `vec3 b = bloom(uv, 0.012);
      c = mix(c, b, 0.55) + max(b - 0.45, 0.0) * 0.6;
      c = c * 1.06 + 0.05;
      float e = smoothstep(0.35, 0.95, length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0)));
      c = mix(c, vec3(1.0), e * 0.35);
      return clamp(satur(c, 0.9), 0.0, 1.0);`,
    'sci-fi': `float l = luma(c); vec3 b = bloom(uv, 0.008);
      c = vec3(l * 0.62, l * 0.95, l * 1.25) + max(luma(b) - 0.5, 0.0) * vec3(0.3, 0.6, 0.9);
      c *= 0.94 + 0.06 * sin(uv.y * u_res.y * 1.5);
      return clamp(c * vig(uv, 0.35), 0.0, 1.0);`,
    'aged-film': `vec3 s = sepia(c); s = contr(s, 0.92) + 0.03;
      s *= flicker(0.12);
      s = mix(s, vec3(0.95, 0.9, 0.78), scratches(uv) * 0.55);
      s += grain(uv, 0.12);
      return clamp(s * vig(uv, 0.6), 0.0, 1.0);`,
    'old-world': `float l = luma(c); vec3 s = vec3(l) * vec3(1.05, 0.86, 0.62) + vec3(0.06, 0.04, 0.0);
      s = contr(s, 0.86); s += grain(uv, 0.05);
      return clamp(s * vig(uv, 0.7), 0.0, 1.0);`,
    'flashback': `vec3 b = bloom(uv, 0.01);
      c = mix(c, b, 0.4); c = satur(c, 0.35); c = c * 0.85 + 0.2 + max(b - 0.55, 0.0) * 0.7;
      return clamp(c * vec3(1.02, 1.0, 0.97), 0.0, 1.0);`,
    'silent-era': `float l = luma(c); l = contr(vec3(l), 1.25).x;
      vec3 s = vec3(l) * flicker(0.16);
      s = mix(s, vec3(0.95), scratches(uv) * 0.6);
      s += grain(uv, 0.16);
      return clamp(s * vig(uv, 0.9), 0.0, 1.0);`,
    'western': `c = pow(max(c, 0.0), vec3(0.92, 1.0, 1.25)) * vec3(1.12, 1.0, 0.74);
      c = contr(satur(c, 0.8), 1.2);
      return clamp(c * vig(uv, 0.4), 0.0, 1.0);`,
    'romantic': `vec3 b = bloom(uv, 0.01);
      c = mix(c, b, 0.35) * vec3(1.08, 0.93, 0.98) + vec3(0.06, 0.0, 0.03);
      return clamp(c * vig(uv, 0.35), 0.0, 1.0);`,
    'heat-wave': `float t = luma(c);
      vec3 a = mix(vec3(0.0, 0.0, 0.25), vec3(0.35, 0.0, 0.85), smoothstep(0.0, 0.25, t));
      a = mix(a, vec3(0.95, 0.0, 0.35), smoothstep(0.22, 0.5, t));
      a = mix(a, vec3(1.0, 0.55, 0.0), smoothstep(0.48, 0.75, t));
      a = mix(a, vec3(1.0, 1.0, 0.65), smoothstep(0.72, 1.0, t));
      return a;`,
    'x-ray': `float l = 1.0 - luma(c); vec3 b = bloom(uv, 0.006);
      vec3 x = vec3(l) * vec3(0.72, 0.9, 1.08) + (1.0 - luma(b)) * vec3(0.05, 0.12, 0.2);
      return clamp(contr(x, 1.15), 0.0, 1.0);`,
    'negative': 'return 1.0 - c;',
    'camo': `float l = luma(c) + (vnoise(uv * 18.0) - 0.5) * 0.18;
      vec3 k = vec3(0.16, 0.18, 0.1);
      k = mix(k, vec3(0.32, 0.36, 0.2), step(0.3, l));
      k = mix(k, vec3(0.48, 0.44, 0.3), step(0.5, l));
      k = mix(k, vec3(0.62, 0.6, 0.45), step(0.68, l));
      return k;`,
    'duotone': 'float l = smoothstep(0.05, 0.95, luma(c)); return mix(vec3(0.08, 0.12, 0.42), vec3(1.0, 0.82, 0.32), l);',
    'comic': `vec3 q = floor(satur(c, 1.6) * 4.0 + 0.5) / 4.0;
      float e = smoothstep(0.35, 0.8, sobel(uv));
      return clamp(q * (1.0 - e), 0.0, 1.0);`,
    'comic-mono': `float l = floor(luma(c) * 4.0 + 0.5) / 4.0;
      float e = smoothstep(0.35, 0.8, sobel(uv));
      return vec3(l * (1.0 - e));`,
    'comic-sepia': `vec3 q = sepia(vec3(floor(luma(c) * 4.0 + 0.5) / 4.0));
      float e = smoothstep(0.35, 0.8, sobel(uv));
      return q * (1.0 - e);`,
    'flipped': 'return c;',
    'raster': `float cs = u_res.y / 90.0;
      vec2 p = uv * u_res; float a = 0.785398;
      mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
      vec2 rp = R * p; vec2 cell = floor(rp / cs) + 0.5; vec2 f = rp / cs - cell;
      vec2 cp = (vec2(cos(-a) * cell.x - sin(-a) * cell.y, sin(-a) * cell.x + cos(-a) * cell.y) * cs) / u_res;
      vec3 cc = px(clamp(cp, 0.0, 1.0));
      float r = sqrt(1.0 - luma(cc)) * 0.62;
      float d = smoothstep(r, r - 0.08, length(f));
      return mix(vec3(0.96, 0.95, 0.92), cc * 0.75, d);`,
    'vignette': 'return c * vig(uv, 0.75);',
    'glow': 'vec3 b = bloom(uv, 0.012); return clamp(c + max(b - 0.4, 0.0) * 1.3, 0.0, 1.0);',
    'bleach-bypass': `vec3 b = vec3(luma(c));
      vec3 o = mix(2.0 * c * b, 1.0 - 2.0 * (1.0 - c) * (1.0 - b), step(0.5, b));
      c = mix(c, o, 0.85); return clamp(satur(c, 0.5), 0.0, 1.0);`,
    '50s-tv': `vec2 j = uv + vec2((vnoise(vec2(uv.y * 80.0, u_time * 30.0)) - 0.5) * 0.004, 0.0);
      float l = luma(blur9(j, 0.0015));
      l *= 0.85 + 0.15 * sin(uv.y * u_res.y * 1.6);
      l *= 0.9 + 0.1 * smoothstep(0.0, 0.1, abs(fract(uv.y - u_time * 0.15) - 0.5));
      l += grain(uv, 0.14);
      vec2 d = abs(uv - 0.5) * 2.0; float corner = 1.0 - smoothstep(0.86, 1.0, pow(pow(d.x, 6.0) + pow(d.y, 6.0), 1.0 / 6.0));
      return clamp(vec3(l) * vec3(0.95, 1.0, 1.02) * vig(uv, 0.5) * corner, 0.0, 1.0);`,
    'film-grain': 'return clamp(c + grain(uv, 0.16), 0.0, 1.0);',
    'cartoon': `vec3 b = blur9(uv, 0.003); vec3 q = floor(satur(b, 1.35) * 6.0 + 0.5) / 6.0;
      float e = smoothstep(0.5, 0.9, sobel(uv)); return q * (1.0 - e * 0.85);`,
    'bright': 'c = c * 1.15 + 0.05; return clamp(satur(c, 1.1), 0.0, 1.0);',
  };

  function clipShader(filterId) {
    const body = FILTERS[filterId] || FILTERS['none'];
    return CLIP_HEAD + `
vec3 filt(vec3 c, vec2 uv) { ${body} }
void main() {
  vec2 uv = v_uv;
  vec4 raw = srcRaw(uv);
  float inside = step(0.001, raw.a);
  vec3 c = inside > 0.5 ? raw.rgb / raw.a : vec3(0.0);
  c = adjust(c);
  vec3 f = filt(c, uv);
  c = mix(c, f, u_amount);
  float a = raw.a;
  if (u_outside > 0.5) { c *= inside; a = 1.0; }
  gl_FragColor = vec4(c * a, a) * u_opacity;
}`;
  }

  // ---------------------------------------------------------------- transitions
  const TR_HEAD = COMMON + `
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_p;
uniform float u_ratio;
vec4 A(vec2 uv) { return texture2D(u_from, uv); }
vec4 B(vec2 uv) { return texture2D(u_to, uv); }
bool inside(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }
vec4 Ac(vec2 uv) { return inside(uv) ? A(uv) : vec4(0.0, 0.0, 0.0, 1.0); }
vec4 Bc(vec2 uv) { return inside(uv) ? B(uv) : vec4(0.0, 0.0, 0.0, 1.0); }
const vec4 BLACK = vec4(0.0, 0.0, 0.0, 1.0);
vec4 blurA(vec2 uv, float r) {
  vec4 s = vec4(0.0); float t = 0.0;
  for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
    vec2 o = vec2(float(i), float(j)) * r / 3.0 * vec2(1.0 / u_ratio, 1.0);
    float w = exp(-float(i * i + j * j) / 8.0);
    s += A(clamp(uv + o, 0.0, 1.0)) * w; t += w;
  }
  return s / t;
}
vec4 blurB(vec2 uv, float r) {
  vec4 s = vec4(0.0); float t = 0.0;
  for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
    vec2 o = vec2(float(i), float(j)) * r / 3.0 * vec2(1.0 / u_ratio, 1.0);
    float w = exp(-float(i * i + j * j) / 8.0);
    s += B(clamp(uv + o, 0.0, 1.0)) * w; t += w;
  }
  return s / t;
}
vec2 rot2(vec2 v, float a) { return vec2(cos(a) * v.x - sin(a) * v.y, sin(a) * v.x + cos(a) * v.y); }
`;

  const PUZZLE = `
float knob(float h) { return h > 0.5 ? 1.0 : -1.0; }
bool inPiece(vec2 q, vec2 cell, vec2 grid) {
  // q in cell local coordinates (0..1), with margins to allow knobs
  float r = 0.15; float off = 0.13;
  bool inside = q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0;
  float kr = cell.x < grid.x - 1.0 ? knob(hash12(cell + vec2(0.5, 3.1))) : 0.0;
  float kl = cell.x > 0.0 ? -knob(hash12(cell - vec2(1.0, 0.0) + vec2(0.5, 3.1))) : 0.0;
  float kb = cell.y < grid.y - 1.0 ? knob(hash12(cell + vec2(7.3, 0.5))) : 0.0;
  float kt = cell.y > 0.0 ? -knob(hash12(cell - vec2(0.0, 1.0) + vec2(7.3, 0.5))) : 0.0;
  if (kr > 0.5 && length(q - vec2(1.0 + off, 0.5)) < r) inside = true;
  if (kr < -0.5 && length(q - vec2(1.0 - off, 0.5)) < r) inside = false;
  if (kl > 0.5 && length(q - vec2(-off, 0.5)) < r) inside = true;
  if (kl < -0.5 && length(q - vec2(off, 0.5)) < r) inside = false;
  if (kb > 0.5 && length(q - vec2(0.5, 1.0 + off)) < r) inside = true;
  if (kb < -0.5 && length(q - vec2(0.5, 1.0 - off)) < r) inside = false;
  if (kt > 0.5 && length(q - vec2(0.5, -off)) < r) inside = true;
  if (kt < -0.5 && length(q - vec2(0.5, off)) < r) inside = false;
  return inside;
}
vec4 puzzle(vec2 uv, float dir) {
  vec2 grid = vec2(8.0, 5.0);
  float p = u_p;
  vec4 col = A(uv);
  float best = -1.0;
  for (int ci = 0; ci < 8; ci++) {
    for (int dj = -1; dj <= 1; dj++) {
      float cx = float(ci);
      float cy = floor(uv.y * grid.y) + float(dj);
      if (cy < 0.0 || cy >= grid.y) continue;
      vec2 cell = vec2(cx, cy);
      float order = dir > 0.0 ? (grid.x - 1.0 - cx) : cx;
      float delay = order / grid.x * 0.45 + hash12(cell * 1.7) * 0.12;
      float k = clamp((p - delay) / 0.42, 0.0, 1.0);
      k = 1.0 - pow(1.0 - k, 3.0);
      float offx = (1.0 - k) * (1.25 + order / grid.x) * dir;
      vec2 pos = uv - vec2(offx, 0.0);
      vec2 q = pos * grid - cell;
      if (k > 0.0 && inPiece(q, cell, grid)) {
        float edge = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
        vec4 c = B(clamp(pos, 0.0, 1.0));
        c.rgb *= 0.88 + 0.12 * smoothstep(0.0, 0.06, edge);
        if (order > best) { col = c; best = order; }
      }
    }
  }
  return col;
}`;

  const PAGECURL = `
vec4 pagecurl(vec2 uv, float dir) {
  // dir = 1 : curl from right edge toward the left; -1 : from left edge toward the right
  float p = easeio(u_p);
  vec2 d = normalize(vec2(-dir, -0.28));
  vec2 P = vec2(uv.x * u_ratio, uv.y);
  vec2 corner = dir > 0.0 ? vec2(u_ratio, 1.0) : vec2(0.0, 1.0);
  float maxD = dot(vec2(dir > 0.0 ? 0.0 : u_ratio, 0.0) - corner, d);
  float R = 0.12;
  float f = mix(-0.02, maxD + R * PI + 0.05, p);
  float x = dot(P - corner, d);
  vec2 perp = vec2(-d.y, d.x);
  float y = dot(P - corner, perp);
  vec2 toUV = vec2(1.0 / u_ratio, 1.0);
  // regions (x measured from the corner along d; curl happens where x < f)
  if (x > f) {
    // flat part of page A (possibly covered by flap)
    float s = f - x; // negative
    // back flap lying on top: paper originally at xs = f + (x - f) ... mirrored over roll
    float xs = 2.0 * f - x - PI * R;
    if (xs < 0.0 || xs > f) {
      return A(uv);
    }
    vec2 pp = corner + d * xs + perp * y;
    vec2 puv = pp * toUV;
    if (!inside(puv)) return A(uv);
    vec4 c = A(puv); c.rgb = mix(c.rgb, vec3(0.92), 0.65);
    return c;
  }
  if (x > f - R) {
    // on the cylinder: two candidate paper points
    float a = asin(clamp((f - x) / R, -1.0, 1.0));
    float s2 = f - (PI - a) * R; // top (back side)
    vec2 pp2 = corner + d * s2 + perp * y;
    vec2 puv2 = pp2 * toUV;
    if (s2 >= 0.0 && inside(puv2)) {
      vec4 c = A(puv2); c.rgb = mix(c.rgb, vec3(0.92), 0.6) * (0.75 + 0.25 * sin(a));
      return c;
    }
    float s1 = f - a * R;
    vec2 pp1 = corner + d * s1 + perp * y;
    vec2 puv1 = pp1 * toUV;
    if (s1 >= 0.0 && inside(puv1)) {
      vec4 c = A(puv1); c.rgb *= 0.7 + 0.3 * cos(a);
      return c;
    }
  }
  // revealed page B with a soft shadow near the curl
  vec4 b = B(uv);
  float sh = smoothstep(f - R - 0.12, f - R, x);
  b.rgb *= 1.0 - 0.35 * sh * step(0.001, p) * step(p, 0.999);
  return b;
}`;

  const TRANSITIONS = {
    'cross-dissolve': 'return mix(A(uv), B(uv), u_p);',
    'cross-blur': 'float r = sin(u_p * PI) * 0.035; return mix(blurA(uv, r), blurB(uv, r), smoothstep(0.25, 0.75, u_p));',
    'cross-zoom': `float s = sin(u_p * PI) * 0.42;
      vec2 c = vec2(0.5); float dis = smoothstep(0.35, 0.65, u_p);
      vec4 acc = vec4(0.0); float tot = 0.0;
      for (int i = 0; i < 20; i++) {
        float t = float(i) / 20.0;
        vec2 q = mix(uv, c, t * s);
        float w = 1.0 - t * 0.5;
        acc += mix(A(q), B(q), dis) * w; tot += w;
      }
      vec4 col = acc / tot; col.rgb += sin(u_p * PI) * 0.12; return col;`,
    'ripple': `vec2 d = (uv - 0.5) * vec2(u_ratio, 1.0);
      float r = length(d); vec2 dir = d / max(r, 0.0001);
      float amp = 0.028 * sin(u_p * PI);
      vec2 off = dir * sin(r * 42.0 - u_p * 28.0) * amp * vec2(1.0 / u_ratio, 1.0);
      return mix(A(clamp(uv + off, 0.0, 1.0)), B(clamp(uv + off, 0.0, 1.0)), smoothstep(0.2, 0.8, u_p));`,
    'fade-black': 'return u_p < 0.5 ? mix(A(uv), BLACK, u_p * 2.0) : mix(BLACK, B(uv), (u_p - 0.5) * 2.0);',
    'fade-white': 'vec4 W = vec4(1.0); return u_p < 0.5 ? mix(A(uv), W, u_p * 2.0) : mix(W, B(uv), (u_p - 0.5) * 2.0);',
    'slide-left': 'float e = easeio(u_p); return uv.x < 1.0 - e ? A(uv + vec2(e, 0.0)) : B(uv - vec2(1.0 - e, 0.0));',
    'slide-right': 'float e = easeio(u_p); return uv.x > e ? A(uv - vec2(e, 0.0)) : B(uv + vec2(1.0 - e, 0.0));',
    'wipe-left': 'float e = u_p; float m = smoothstep(1.0 - e - 0.004, 1.0 - e + 0.004, uv.x); return mix(A(uv), B(uv), m);',
    'wipe-right': 'float e = u_p; float m = 1.0 - smoothstep(e - 0.004, e + 0.004, uv.x); return mix(A(uv), B(uv), m);',
    'wipe-up': 'float e = u_p; float m = smoothstep(1.0 - e - 0.004, 1.0 - e + 0.004, uv.y); return mix(A(uv), B(uv), m);',
    'wipe-down': 'float e = u_p; float m = 1.0 - smoothstep(e - 0.004, e + 0.004, uv.y); return mix(A(uv), B(uv), m);',
    'circle-open': `float maxR = length(vec2(0.5 * u_ratio, 0.5)) * 1.02;
      float r = easeio(u_p) * maxR; float d = length((uv - 0.5) * vec2(u_ratio, 1.0));
      return mix(B(uv), A(uv), smoothstep(r - 0.004, r + 0.004, d));`,
    'circle-close': `float maxR = length(vec2(0.5 * u_ratio, 0.5)) * 1.02;
      float r = (1.0 - easeio(u_p)) * maxR; float d = length((uv - 0.5) * vec2(u_ratio, 1.0));
      return mix(A(uv), B(uv), smoothstep(r - 0.004, r + 0.004, d));`,
    'doorway': `float e = easeio(u_p);
      vec2 ub = (uv - 0.5) / mix(0.72, 1.0, e) + 0.5;
      vec4 col = Bc(ub); col.rgb *= mix(0.35, 1.0, e);
      float w = 0.5 * (1.0 - e);
      if (uv.x < w) {
        float f = uv.x / w; float s = mix(1.0, 1.0 + 0.45 * sin(e * PI * 0.5), f);
        float v = (uv.y - 0.5) / s + 0.5;
        if (v >= 0.0 && v <= 1.0) { col = A(vec2(f * 0.5, v)); col.rgb *= 1.0 - 0.45 * e * f; }
      } else if (uv.x > 1.0 - w) {
        float f = (1.0 - uv.x) / w; float s = mix(1.0, 1.0 + 0.45 * sin(e * PI * 0.5), f);
        float v = (uv.y - 0.5) / s + 0.5;
        if (v >= 0.0 && v <= 1.0) { col = A(vec2(1.0 - f * 0.5, v)); col.rgb *= 1.0 - 0.45 * e * f; }
      }
      return col;`,
    'swap': `float e = easeio(u_p); float k = sin(e * PI);
      float sa = mix(1.0, 0.62, k); float sb = sa;
      vec2 pa = vec2(0.5 - 0.3 * k, 0.5); vec2 pb = vec2(0.5 + 0.3 * k, 0.5);
      vec2 qa = (uv - pa) / sa + 0.5; vec2 qb = (uv - pb) / sb + 0.5;
      bool ia = inside(qa); bool ib = inside(qb);
      vec4 ca = A(qa); vec4 cb = B(qb);
      ca.rgb *= e < 0.5 ? 1.0 : 0.6 + 0.4 * (1.0 - k);
      cb.rgb *= e < 0.5 ? 0.6 + 0.4 * (1.0 - k) : 1.0;
      if (e < 0.5) { if (ia) return ca; if (ib) return cb; }
      else { if (ib) return cb; if (ia) return ca; }
      return BLACK;`,
    'cube': `float th = easeio(u_p) * PI * 0.5;
      float hw = u_ratio * 0.5;
      vec3 C = vec3(0.0, 0.0, 2.2);
      vec3 P = vec3((uv.x - 0.5) * u_ratio, 0.5 - uv.y, 0.0);
      vec3 d = P - C;
      vec3 ctr = vec3(0.0, 0.0, -hw - 0.55 * sin(th * 2.0) * hw);
      vec3 nA = vec3(-sin(th), 0.0, cos(th)); vec3 tA = vec3(cos(th), 0.0, sin(th));
      vec3 nB = vec3(cos(th), 0.0, sin(th)); vec3 tB = vec3(sin(th), 0.0, -cos(th));
      vec3 cA = ctr + hw * nA; vec3 cB = ctr + hw * nB;
      vec4 col = BLACK; float best = 1e9;
      float dn = dot(d, nA);
      if (dn < 0.0) {
        float t = dot(cA - C, nA) / dn; vec3 H = C + t * d;
        vec2 q = vec2(dot(H - cA, tA) / (2.0 * hw) + 0.5, 0.5 - H.y);
        if (inside(q) && t < best) { best = t; col = A(q); col.rgb *= 0.55 + 0.45 * cos(th); }
      }
      dn = dot(d, nB);
      if (dn < 0.0) {
        float t = dot(cB - C, nB) / dn; vec3 H = C + t * d;
        vec2 q = vec2(dot(H - cB, tB) / (2.0 * hw) + 0.5, 0.5 - H.y);
        if (inside(q) && t < best) { best = t; col = B(q); col.rgb *= 0.55 + 0.45 * sin(th); }
      }
      return col;`,
    'mosaic': `vec2 grid = vec2(12.0, 7.0);
      vec2 cell = floor(uv * grid); vec2 f = fract(uv * grid) - 0.5;
      float delay = hash12(cell * 1.31) * 0.55;
      float k = clamp((u_p - delay) / 0.45, 0.0, 1.0);
      float ang = easeio(k) * PI; float sx = cos(ang);
      if (abs(f.x) > abs(sx) * 0.5 + 0.0001) return BLACK;
      float lx = f.x / max(abs(sx), 0.0001);
      vec2 q = (cell + vec2(lx, f.y) + 0.5) / grid;
      vec4 c = sx >= 0.0 ? A(clamp(q, 0.0, 1.0)) : B(clamp(q, 0.0, 1.0));
      c.rgb *= 0.7 + 0.3 * abs(sx);
      return c;`,
    'spin-in': `float e = easeio(u_p);
      vec2 d = (uv - 0.5) * vec2(u_ratio, 1.0);
      vec2 q = rot2(d, (1.0 - e) * PI * 1.5) / max(e, 0.0001);
      q = q / vec2(u_ratio, 1.0) + 0.5;
      vec4 a = A(uv); a.rgb *= 1.0 - 0.5 * e;
      return inside(q) && e > 0.001 ? B(q) : a;`,
    'spin-out': `float e = easeio(u_p); float s = 1.0 - e;
      vec2 d = (uv - 0.5) * vec2(u_ratio, 1.0);
      vec2 q = rot2(d, -e * PI * 1.5) / max(s, 0.0001);
      q = q / vec2(u_ratio, 1.0) + 0.5;
      vec4 b = B(uv); b.rgb *= 0.5 + 0.5 * e;
      return inside(q) && s > 0.001 ? A(q) : b;`,
    'puzzle-left': 'return puzzle(uv, 1.0);',
    'puzzle-right': 'return puzzle(uv, -1.0);',
    'page-curl-left': 'return pagecurl(uv, 1.0);',
    'page-curl-right': 'return pagecurl(uv, -1.0);',
  };

  function transitionShader(type) {
    const body = TRANSITIONS[type] || TRANSITIONS['cross-dissolve'];
    return TR_HEAD + (type.startsWith('puzzle') ? PUZZLE : '') + (type.startsWith('page-curl') ? PAGECURL : '') + `
vec4 transition(vec2 uv) { ${body} }
void main() { gl_FragColor = transition(v_uv); }`;
  }

  // ---------------------------------------------------------------- backgrounds
  const BG_HEAD = COMMON + `
uniform vec3 u_c1;
uniform vec3 u_c2;
vec2 aspectUV(vec2 uv) { return vec2(uv.x * u_res.x / u_res.y, uv.y); }
`;
  const BACKGROUNDS = {
    'solid': 'return u_c1;',
    'gradient': 'return mix(u_c1, u_c2, smoothstep(0.0, 1.0, uv.y));',
    'gradient-radial': 'float d = length((uv - vec2(0.5, 0.42)) * vec2(u_res.x / u_res.y, 1.0)); return mix(u_c1, u_c2, smoothstep(0.0, 0.95, d));',
    'blueprint': `vec2 p = aspectUV(uv) * 12.0;
      vec2 g = abs(fract(p) - 0.5); float minor = 1.0 - smoothstep(0.0, 0.03, 0.5 - max(g.x, g.y));
      vec2 G = abs(fract(p / 4.0) - 0.5); float major = 1.0 - smoothstep(0.0, 0.012, 0.5 - max(G.x, G.y));
      vec3 base = mix(vec3(0.06, 0.22, 0.5), vec3(0.1, 0.32, 0.62), fbm(uv * 3.0));
      base += (fbm(uv * 40.0) - 0.5) * 0.05;
      return base + minor * 0.12 + major * 0.35;`,
    'pinstripes': `float x = uv.x * u_res.x / u_res.y * 34.0;
      float l = 1.0 - smoothstep(0.0, 0.06, abs(fract(x) - 0.5) - 0.44);
      vec3 base = mix(u_c1, u_c1 * 0.8, uv.y);
      return base + l * 0.09 + (fbm(uv * 60.0) - 0.5) * 0.03;`,
    'stripes': `float x = (uv.x * u_res.x / u_res.y + uv.y) * 6.0;
      float s = smoothstep(0.48, 0.52, fract(x));
      return mix(u_c1, u_c2, s) * (0.92 + 0.08 * (1.0 - uv.y));`,
    'organic': `vec2 p = aspectUV(uv) * 2.2;
      float n = fbm(p + vec2(fbm(p + u_time * 0.02), fbm(p - 1.3)));
      vec3 a = mix(u_c1, u_c2, smoothstep(0.25, 0.75, n));
      return a * (0.85 + 0.25 * fbm(p * 6.0));`,
    'paper': `vec2 p = aspectUV(uv);
      float n = fbm(p * 90.0) * 0.5 + fbm(p * 7.0) * 0.5;
      float fib = vnoise(vec2(p.x * 300.0, p.y * 18.0));
      vec3 c = vec3(0.95, 0.93, 0.87) - (n - 0.5) * 0.08 - fib * 0.02;
      float d = length((uv - 0.5) * vec2(1.2, 1.0)); c *= 1.0 - 0.18 * smoothstep(0.4, 0.9, d);
      return c;`,
    'formal': `vec2 p = aspectUV(uv) * 5.0; vec2 f = fract(p) - 0.5; vec2 id = floor(p);
      f = mod(id.x + id.y, 2.0) > 0.5 ? f : f * vec2(-1.0, 1.0);
      float r = length(f); float a = atan(f.y, f.x);
      float motif = smoothstep(0.02, 0.0, abs(r - 0.28 - 0.08 * cos(a * 4.0)) - 0.012);
      motif += smoothstep(0.02, 0.0, abs(r - 0.12 - 0.04 * sin(a * 8.0)) - 0.008);
      motif += smoothstep(0.03, 0.0, abs(abs(f.x) + abs(f.y) - 0.48) - 0.006) * 0.6;
      vec3 base = u_c1 * (0.85 + 0.15 * fbm(uv * 8.0));
      return mix(base, u_c2, clamp(motif, 0.0, 1.0) * 0.55);`,
    'curtain': `float x = uv.x * u_res.x / u_res.y;
      float folds = 0.5 + 0.5 * sin(x * 20.0 + sin(x * 3.0) * 2.0 + sin(uv.y * 3.0 + x) * 0.3);
      vec3 c = vec3(0.45, 0.02, 0.04) * (0.35 + 0.9 * folds);
      c += vec3(0.25, 0.04, 0.02) * pow(folds, 8.0);
      float val = smoothstep(0.14, 0.13, uv.y + 0.02 * sin(x * 10.0));
      c = mix(c, vec3(0.55, 0.05, 0.06) * (0.6 + 0.4 * sin(x * 40.0)), val);
      c *= 0.7 + 0.3 * smoothstep(1.0, 0.3, uv.y);
      return c * (1.0 - 0.3 * smoothstep(0.3, 0.9, abs(uv.x - 0.5) * 2.0));`,
    'pastel': `vec2 p = aspectUV(uv);
      float t = u_time * 0.05;
      vec3 c1 = vec3(0.98, 0.78, 0.86), c2 = vec3(0.75, 0.86, 0.99), c3 = vec3(0.86, 0.96, 0.82), c4 = vec3(0.99, 0.94, 0.76);
      float n1 = fbm(p * 1.3 + t), n2 = fbm(p * 1.1 - t + 5.0);
      return mix(mix(c1, c2, smoothstep(0.3, 0.7, n1)), mix(c3, c4, smoothstep(0.3, 0.7, n1)), smoothstep(0.35, 0.65, n2));`,
    'clouds': `vec2 p = aspectUV(uv);
      vec3 sky = mix(vec3(0.33, 0.58, 0.92), vec3(0.72, 0.86, 0.98), uv.y);
      float t = u_time * 0.03;
      float n = fbm(p * 2.2 + vec2(t, 0.0)) * 0.65 + fbm(p * 5.0 + vec2(t * 1.6, 0.0)) * 0.35;
      float cl = smoothstep(0.45, 0.78, n);
      vec3 cloud = mix(vec3(0.82, 0.86, 0.92), vec3(1.0), smoothstep(0.5, 0.9, n));
      return mix(sky, cloud, cl);`,
    'underwater': `vec2 p = aspectUV(uv);
      vec3 base = mix(vec3(0.05, 0.55, 0.72), vec3(0.0, 0.12, 0.3), uv.y);
      float t = u_time * 0.6;
      vec2 q = p * 5.0;
      float c = 0.0;
      for (int i = 0; i < 3; i++) { float fi = float(i); q += vec2(sin(q.y * 1.3 + t + fi), cos(q.x * 1.1 - t * 0.8 + fi)) * 0.35; c += abs(sin(q.x + q.y)); }
      float caus = pow(1.0 - clamp(c / 3.0, 0.0, 1.0), 4.0) * (1.0 - uv.y);
      float rays = pow(max(0.0, sin((p.x - uv.y * 0.35) * 9.0 + sin(t * 0.3) * 2.0)), 12.0) * (1.0 - uv.y) * 0.25;
      vec2 bp = p * vec2(9.0, 5.0) + vec2(0.0, u_time * 0.4); vec2 bi = floor(bp); vec2 bf = fract(bp) - 0.5;
      float bub = step(0.85, hash12(bi)) * smoothstep(0.12, 0.08, abs(length(bf) - 0.12));
      return base + caus * 0.35 + rays + bub * 0.25;`,
    'aurora': `vec2 p = aspectUV(uv);
      vec3 c = mix(vec3(0.0, 0.02, 0.08), vec3(0.02, 0.1, 0.18), uv.y);
      float st = step(0.996, hash12(floor(p * 220.0))) * (0.5 + 0.5 * sin(u_time * 2.0 + hash12(floor(p * 220.0)) * 20.0));
      c += st * (1.0 - uv.y);
      float t = u_time * 0.1;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float y = 0.28 + fi * 0.09 + 0.08 * sin(p.x * 2.0 + t * (1.0 + fi) + fi * 2.0) + 0.05 * fbm(vec2(p.x * 3.0 + t, fi));
        float band = exp(-pow((uv.y - y) * 9.0, 2.0)) * (0.5 + 0.5 * fbm(vec2(p.x * 8.0 - t * 2.0, fi * 3.0)));
        c += band * mix(vec3(0.1, 0.9, 0.5), vec3(0.4, 0.3, 0.9), fi / 2.0) * 0.7;
      }
      return c;`,
    'stars': `vec2 p = aspectUV(uv);
      vec3 c = mix(vec3(0.01, 0.01, 0.05), vec3(0.05, 0.02, 0.12), fbm(p * 2.0 + u_time * 0.01));
      c += vec3(0.15, 0.05, 0.2) * pow(fbm(p * 3.0 - u_time * 0.02), 3.0) * 2.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 g = p * (60.0 + fi * 50.0) + vec2(u_time * (0.2 + fi * 0.3), 0.0);
        vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float h = hash12(id + fi * 17.0);
        float s = step(0.93, h) * smoothstep(0.08 - fi * 0.02, 0.0, length(f)) * (0.6 + 0.4 * sin(u_time * 3.0 + h * 50.0));
        c += s;
      }
      return c;`,
    'bokeh': `vec2 p = aspectUV(uv);
      vec3 c = mix(u_c1, u_c2, uv.y) * 0.5;
      for (int i = 0; i < 18; i++) {
        float fi = float(i);
        vec2 ctr = vec2(hash12(vec2(fi, 1.0)) * u_res.x / u_res.y, fract(hash12(vec2(fi, 2.0)) - u_time * (0.01 + 0.02 * hash12(vec2(fi, 3.0)))));
        float r = 0.04 + 0.08 * hash12(vec2(fi, 4.0));
        float d = length(p - ctr);
        vec3 col = mix(vec3(1.0, 0.7, 0.3), vec3(0.4, 0.7, 1.0), hash12(vec2(fi, 5.0)));
        c += col * smoothstep(r, r * 0.85, d) * 0.22;
      }
      return c;`,
    'chalkboard': `vec2 p = aspectUV(uv);
      vec3 c = vec3(0.12, 0.2, 0.16) + (fbm(p * 4.0) - 0.5) * 0.08;
      c += smoothstep(0.62, 0.9, fbm(p * 2.5 + 3.0)) * 0.08;
      c += (hash12(floor(p * 400.0)) - 0.5) * 0.03;
      float frame = smoothstep(0.035, 0.03, min(min(uv.x, 1.0 - uv.x) * u_res.x / u_res.y, min(uv.y, 1.0 - uv.y)));
      return mix(c, vec3(0.45, 0.3, 0.16) * (0.8 + 0.3 * vnoise(p * vec2(80.0, 4.0))), frame);`,
    'watercolor': `vec2 p = aspectUV(uv);
      vec3 paper = vec3(0.97, 0.96, 0.93) - fbm(p * 70.0) * 0.05;
      float n1 = fbm(p * 1.6 + 1.0); float n2 = fbm(p * 1.8 + 7.0);
      vec3 w1 = mix(paper, u_c1, smoothstep(0.45, 0.62, n1) * 0.6);
      vec3 w2 = mix(w1, u_c2, smoothstep(0.48, 0.66, n2) * 0.5);
      float edge = smoothstep(0.6, 0.62, n1) - smoothstep(0.62, 0.66, n1);
      return w2 - edge * 0.08;`,
    'sunset': `vec3 top = vec3(0.2, 0.1, 0.35), mid = vec3(0.95, 0.45, 0.35), bot = vec3(1.0, 0.8, 0.45);
      vec3 c = mix(top, mid, smoothstep(0.0, 0.6, uv.y)); c = mix(c, bot, smoothstep(0.55, 1.0, uv.y));
      vec2 sp = (uv - vec2(0.5, 0.78)) * vec2(u_res.x / u_res.y, 1.0);
      c += vec3(1.0, 0.85, 0.5) * smoothstep(0.14, 0.1, length(sp));
      return c;`,
    'tiles': `vec2 p = aspectUV(uv) * 7.0; vec2 f = fract(p); vec2 id = floor(p);
      float g = smoothstep(0.0, 0.04, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
      vec3 c = mix(u_c1, u_c2, hash12(id) * 0.35) * (0.9 + 0.1 * vnoise(p * 3.0));
      return mix(vec3(0.85, 0.83, 0.8), c, g);`,
    'wood': `vec2 p = aspectUV(uv);
      float r = fbm(vec2(p.x * 2.0, p.y * 18.0)) * 6.0 + p.y * 30.0;
      float ring = 0.5 + 0.5 * sin(r);
      vec3 c = mix(vec3(0.42, 0.25, 0.12), vec3(0.62, 0.4, 0.2), ring);
      c *= 0.85 + 0.15 * smoothstep(0.02, 0.0, abs(fract(p.x * 4.0) - 0.5) - 0.49);
      return c * (0.9 + 0.1 * fbm(p * 30.0));`,
  };

  function backgroundShader(kind) {
    const body = BACKGROUNDS[kind] || BACKGROUNDS['solid'];
    return BG_HEAD + `
vec3 bg(vec2 uv) { ${body} }
void main() { gl_FragColor = vec4(clamp(bg(v_uv), 0.0, 1.0), 1.0); }`;
  }

  // ---------------------------------------------------------------- compositing
  const COPY = COMMON + `
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_fade;
void main() { vec4 c = texture2D(u_tex, v_uv); c.rgb *= (1.0 - u_fade); gl_FragColor = c * u_opacity; }`;

  // layer placed in a sub-rectangle with border + shadow (Picture in Picture), or full frame (u_dst = 0,0,1,1)
  const PLACE = COMMON + `
uniform sampler2D u_tex;
uniform vec4 u_dst;
uniform float u_opacity;
uniform float u_border;
uniform vec3 u_borderColor;
uniform float u_shadow;
void main() {
  vec2 uv = v_uv;
  vec2 q = (uv - u_dst.xy) / u_dst.zw;
  vec2 bw = vec2(u_border) / u_res / u_dst.zw;
  vec4 col = vec4(0.0);
  if (u_shadow > 0.0) {
    vec2 sq = (uv - u_dst.xy - vec2(0.004, 0.008)) / u_dst.zw;
    vec2 dd = max(max(-sq, sq - 1.0), 0.0) * u_dst.zw * u_res / u_res.y;
    float sd = length(dd);
    float sa = (1.0 - smoothstep(0.0, 0.03, sd)) * 0.55 * u_shadow;
    col = vec4(0.0, 0.0, 0.0, sa);
  }
  if (q.x >= -bw.x && q.y >= -bw.y && q.x <= 1.0 + bw.x && q.y <= 1.0 + bw.y) {
    if (q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) col = texture2D(u_tex, q);
    else col = vec4(u_borderColor, 1.0);
  }
  gl_FragColor = col * u_opacity;
}`;

  const SPLIT = COMMON + `
uniform sampler2D u_base;
uniform sampler2D u_ov;
uniform float u_side;
uniform float u_slide;
uniform float u_opacity;
void main() {
  vec2 uv = v_uv;
  float s = u_slide;
  vec4 base, ov; bool inOv;
  if (u_side < 0.5) { // overlay on left
    float edge = 0.5 * s; inOv = uv.x < edge;
    ov = texture2D(u_ov, vec2(uv.x - edge + 0.75, uv.y));
    base = texture2D(u_base, vec2(clamp(uv.x - 0.25 * s, 0.0, 1.0), uv.y));
  } else if (u_side < 1.5) { // right
    float edge = 1.0 - 0.5 * s; inOv = uv.x > edge;
    ov = texture2D(u_ov, vec2(uv.x - edge + 0.25, uv.y));
    base = texture2D(u_base, vec2(clamp(uv.x + 0.25 * s, 0.0, 1.0), uv.y));
  } else if (u_side < 2.5) { // top
    float edge = 0.5 * s; inOv = uv.y < edge;
    ov = texture2D(u_ov, vec2(uv.x, uv.y - edge + 0.75));
    base = texture2D(u_base, vec2(uv.x, clamp(uv.y - 0.25 * s, 0.0, 1.0)));
  } else { // bottom
    float edge = 1.0 - 0.5 * s; inOv = uv.y > edge;
    ov = texture2D(u_ov, vec2(uv.x, uv.y - edge + 0.25));
    base = texture2D(u_base, vec2(uv.x, clamp(uv.y + 0.25 * s, 0.0, 1.0)));
  }
  gl_FragColor = inOv ? mix(base, ov, u_opacity) : base;
}`;

  const CHROMA = COMMON + `
uniform sampler2D u_tex;
uniform vec3 u_key;
uniform float u_soft;
uniform float u_tol;
uniform float u_opacity;
uniform vec4 u_crop;
vec2 cc(vec3 c) { return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }
void main() {
  vec2 uv = v_uv;
  if (uv.x < u_crop.x || uv.y < u_crop.y || uv.x > u_crop.z || uv.y > u_crop.w) { gl_FragColor = vec4(0.0); return; }
  vec4 c = texture2D(u_tex, uv);
  if (c.a < 0.001) { gl_FragColor = vec4(0.0); return; }
  vec3 rgb = c.rgb / c.a;
  float d = distance(cc(rgb), cc(u_key));
  float a = smoothstep(u_tol, u_tol + 0.02 + u_soft * 0.12, d);
  // spill suppression
  if (u_key.g > u_key.r && u_key.g > u_key.b) rgb.g = mix(min(rgb.g, max(rgb.r, rgb.b) * 1.02), rgb.g, a * a);
  else if (u_key.b > u_key.r) rgb.b = mix(min(rgb.b, max(rgb.r, rgb.g) * 1.02), rgb.b, a * a);
  a *= c.a * u_opacity;
  gl_FragColor = vec4(rgb * a, a);
}`;

  // title layer: optional blur and projective transform (for Far Far Away etc.)
  const TITLE = COMMON + `
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_blur;
uniform float u_useH;
uniform mat3 u_H;
vec4 samp(vec2 uv) {
  vec2 t = uv;
  if (u_useH > 0.5) { vec3 q = u_H * vec3(uv, 1.0); if (q.z <= 0.0) return vec4(0.0); t = q.xy / q.z; }
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) return vec4(0.0);
  return texture2D(u_tex, t);
}
void main() {
  vec4 c;
  if (u_blur > 0.25) {
    c = vec4(0.0); float tot = 0.0;
    for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
      float w = exp(-float(i * i + j * j) / 6.0);
      c += samp(v_uv + vec2(float(i), float(j)) * u_blur / 3.0 / u_res) * w; tot += w;
    }
    c /= tot;
  } else c = samp(v_uv);
  gl_FragColor = c * u_opacity;
}`;

  IM.Shaders = {
    clip: clipShader,
    transition: transitionShader,
    background: backgroundShader,
    COPY, PLACE, SPLIT, CHROMA, TITLE,
    FILTER_IDS: Object.keys(FILTERS),
    TRANSITION_IDS: Object.keys(TRANSITIONS),
    BACKGROUND_KINDS: Object.keys(BACKGROUNDS),
  };
})(window.IM = window.IM || {});
