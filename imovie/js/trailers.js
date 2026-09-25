/* ==========================================================================
   Trailers — Hollywood-style trailer templates (as in iMovie)
   --------------------------------------------------------------------------
   A trailer project keeps its outline (names, credits, studio, card text)
   and the clips chosen for each shot in `p.trailer`. Its clips, cards, logo,
   credits and score are regenerated from that model after every change, so
   the viewer, the frame-exact export and background rendering handle a
   trailer exactly like any other movie.
   ========================================================================== */
(function (IM) {
  'use strict';
  const Pr = IM.Project;
  const clamp = IM.clamp, E = IM.ease;

  const SHOTS = { action: 'Action', wide: 'Wide', medium: 'Medium', closeup: 'Close Up', group: 'Group', landscape: 'Landscape', twoshot: 'Two Shot' };
  const LOGOS = [
    { id: 'spotlights', name: 'Spotlights' }, { id: 'mountain', name: 'Mountain' }, { id: 'globe', name: 'Globe' },
    { id: 'rays', name: 'Sunburst' }, { id: 'shield', name: 'Shield' }, { id: 'stars', name: 'Stars' },
  ];
  const CREDITS = [
    ['director', 'Directed by'], ['editor', 'Edited by'], ['writer', 'Written by'], ['producer', 'Produced by'],
    ['executive', 'Executive Producer'], ['photography', 'Director of Photography'], ['design', 'Production Designer'],
    ['costume', 'Costume Designer'], ['casting', 'Casting by'], ['music', 'Music by'],
  ];

  // ------------------------------------------------------------------ structures
  // Shot, card and cast-card sequences timed like the templates' music.
  const S = (k, d, cast) => ({ t: 'shot', k, d, cast });
  const C = (i, d) => ({ t: 'card', i, d: d || 2.2 });
  const N = (i, d) => ({ t: 'castcard', cast: i, d: d || 1.8 });
  const ARCH = {
    epic: () => [
      { t: 'logo', d: 5 }, C(0, 2.4), S('landscape', 2.2), S('wide', 1.7), C(1, 2.2), S('medium', 1.5, 0), S('closeup', 1.3, 0), S('action', 1.2),
      C(2, 2), N(0), S('closeup', 1.2, 0), S('group', 1.3), S('wide', 1.3), C(3, 1.9), S('action', 0.9), S('medium', 0.9, 1),
      S('action', 0.8), S('closeup', 0.9, 1), C(4, 1.8), S('action', 0.6), S('action', 0.6), S('wide', 0.7), S('action', 0.6),
      { t: 'title', d: 4 }, S('closeup', 1.6, 0), { t: 'credits', d: 5.5 },
    ],
    light: () => [
      { t: 'logo', d: 4 }, C(0, 2.2), S('wide', 1.8), S('medium', 1.6, 0), C(1, 2.2), N(0), S('closeup', 1.5, 0), S('group', 1.6),
      S('action', 1.3), C(2, 2), S('medium', 1.4, 1), S('closeup', 1.3, 1), S('wide', 1.5), C(3, 2), S('group', 1.2), S('action', 1),
      S('action', 1), S('twoshot', 1.3), C(4, 2), S('closeup', 1.1, 0), S('action', 0.9), { t: 'title', d: 3.8 }, S('group', 1.8), { t: 'credits', d: 5 },
    ],
    dark: () => [
      { t: 'logo', d: 4.6 }, C(0, 2.6), S('landscape', 2.4), S('medium', 1.8, 0), C(1, 2.4), S('closeup', 1.3, 0), S('wide', 1.6),
      C(2, 2.2), N(0, 1.6), S('action', 0.9), S('closeup', 0.8, 0), S('action', 0.7), C(3, 1.8), S('medium', 0.9, 1), S('action', 0.5),
      S('closeup', 0.5, 1), S('action', 0.5), S('action', 0.5), C(4, 2), { t: 'title', d: 4.2 }, S('closeup', 1.2, 0), { t: 'credits', d: 5 },
    ],
    story: () => [
      { t: 'logo', d: 4.2 }, C(0, 2.8), S('wide', 2.4), S('medium', 2, 0), C(1, 2.6), N(0), S('closeup', 2, 0), N(1), S('closeup', 2, 1),
      C(2, 2.4), S('twoshot', 2.4), S('landscape', 2.2), C(3, 2.4), S('medium', 1.8, 1), S('closeup', 1.7, 0), S('twoshot', 2),
      C(4, 2.4), { t: 'title', d: 4.4 }, S('twoshot', 2.2), { t: 'credits', d: 5.5 },
    ],
    journey: () => [
      { t: 'logo', d: 4.2 }, C(0, 2.4), S('landscape', 2.4), S('wide', 1.9), C(1, 2.2), S('medium', 1.5, 0), S('closeup', 1.3, 0),
      S('action', 1.3), C(2, 2.2), S('landscape', 1.8), S('group', 1.5), S('action', 1.1), C(3, 2), S('wide', 1.3), S('action', 0.9),
      S('closeup', 1, 1), S('landscape', 1.5), C(4, 2), { t: 'title', d: 4 }, S('landscape', 2), { t: 'credits', d: 5 },
    ],
  };

  // ------------------------------------------------------------------ templates
  const TEMPLATES = [];
  const tpl = (id, name, arch, theme, o) => TEMPLATES.push(Object.assign({ id, name, arch, theme, cast: [1, 6], logo: 'spotlights', filter: 'none', scale: 'min', bpm: 96, key: 50 }, o));
  tpl('adrenaline', 'Adrenaline', 'epic', 'metal', { mood: 'action', font: 'Impact', color: '#f1f3f5', accent: '#ff5a1f', bpm: 128, key: 52, logo: 'rays', filter: 'dramatic', cards: ['Get ready', 'For the ride', 'Of a lifetime', 'Faster', 'Higher'] });
  tpl('blockbuster', 'Blockbuster', 'epic', 'metal', { mood: 'epic', font: 'Copperplate', color: '#e9edf2', accent: '#8fb3d9', bpm: 92, key: 50, cards: ['This summer', 'One hero', 'Will rise', 'Against all odds', 'Nothing will be the same'] });
  tpl('bollywood', 'Bollywood', 'light', 'bollywood', { mood: 'light', font: 'Papyrus', color: '#ffd76a', accent: '#e0115f', bpm: 112, key: 57, scale: 'maj', logo: 'rays', cast: [2, 4], cards: ['Love', 'Drama', 'Dance', 'Destiny', 'A story of two hearts'] });
  tpl('coming-of-age', 'Coming of Age', 'story', 'playful', { mood: 'documentary', font: 'Marker Felt', color: '#ffffff', accent: '#3a86ff', bpm: 100, key: 55, scale: 'maj', logo: 'stars', cast: [1, 4], cards: ['Growing up', 'Is never easy', 'But sometimes', 'You find your way', 'One step at a time'] });
  tpl('documentary', 'Documentary', 'journey', 'clean', { mood: 'documentary', font: 'Helvetica Neue', color: '#ffffff', accent: '#f2b705', bpm: 88, key: 53, logo: 'globe', cards: ['The true story', 'Of a journey', 'Told by those', 'Who lived it', 'An untold story'] });
  tpl('epic-drama', 'Epic Drama', 'epic', 'metal', { mood: 'epic', font: 'Didot', color: '#f3ead8', accent: '#c8a45a', bpm: 84, key: 48, logo: 'shield', cards: ['In a world', 'Where nothing is certain', 'One choice', 'Will change', 'Everything'] });
  tpl('expedition', 'Expedition', 'journey', 'clean', { mood: 'epic', font: 'Futura', color: '#ffffff', accent: '#3fa34d', bpm: 96, key: 50, logo: 'mountain', cards: ['Beyond the horizon', 'Into the unknown', 'One team', 'One goal', 'Adventure awaits'] });
  tpl('fairy-tale', 'Fairy Tale', 'light', 'elegant', { mood: 'romantic', font: 'Snell Roundhand', color: '#fff6d8', accent: '#b784f5', bpm: 90, key: 57, scale: 'maj', logo: 'stars', filter: 'dreamy', cards: ['Once upon a time', 'In a land far away', 'Magic awaited', 'A true love', 'Happily ever after'] });
  tpl('family', 'Family', 'light', 'playful', { mood: 'light', font: 'Chalkboard', color: '#ffffff', accent: '#ff8c42', bpm: 108, key: 55, scale: 'maj', logo: 'stars', cards: ['Every family', 'Has a story', 'This is ours', 'Laughter', 'And love'] });
  tpl('friendship', 'Friendship', 'light', 'playful', { mood: 'light', font: 'Noteworthy', color: '#ffffff', accent: '#2ec4b6', bpm: 112, key: 57, scale: 'maj', cast: [2, 6], logo: 'rays', cards: ['Friends', 'Through thick and thin', 'Side by side', 'Forever', 'The best of times'] });
  tpl('heroes', 'Heroes', 'epic', 'metal', { mood: 'epic', font: 'Arial Black', color: '#f5f7fa', accent: '#1f6feb', bpm: 100, key: 50, logo: 'shield', cards: ['Every city', 'Needs a hero', 'This one', 'Is ready', 'To save the day'] });
  tpl('indie', 'Indie', 'story', 'clean', { mood: 'documentary', font: 'American Typewriter', color: '#f7f1e3', accent: '#e76f51', bpm: 92, key: 55, scale: 'maj', logo: 'stars', filter: 'film-grain', cast: [1, 4], cards: ['A little story', 'About big dreams', 'And small moments', 'Made with heart', 'Coming soon'] });
  tpl('love-story', 'Love Story', 'story', 'elegant', { mood: 'romantic', font: 'Baskerville', color: '#fff4ea', accent: '#e56b6f', bpm: 76, key: 55, scale: 'maj', cast: [2, 2], logo: 'stars', filter: 'romantic', cards: ['Two hearts', 'One chance', 'A love', 'Worth waiting for', 'Forever begins now'] });
  tpl('narrative', 'Narrative', 'story', 'clean', { mood: 'documentary', font: 'Optima', color: '#ffffff', accent: '#9aa5b1', bpm: 84, key: 53, logo: 'globe', cast: [1, 4], cards: ['Every life', 'Has a story', 'This is one', 'Worth telling', 'Told as it happened'] });
  tpl('noir', 'Noir', 'dark', 'retro', { mood: 'dark', font: 'Didot', color: '#f2f2f2', accent: '#bdbdbd', bpm: 72, key: 48, logo: 'shield', filter: 'noir', cast: [1, 3], cards: ['The city', 'Keeps its secrets', 'One detective', 'One last case', 'Trust no one'] });
  tpl('pets', 'Pets', 'light', 'playful', { mood: 'light', font: 'Marker Felt', color: '#ffffff', accent: '#ffb703', bpm: 118, key: 60, scale: 'maj', cast: [1, 1], logo: 'rays', cards: ['Every family', 'Has a best friend', 'This one', 'Is extraordinary', 'Paws for applause'] });
  tpl('retro', 'Retro', 'light', 'retro', { mood: 'retro', font: 'Futura', color: '#fdf0d5', accent: '#e76f51', bpm: 104, key: 55, logo: 'rays', filter: 'aged-film', cards: ['Back in the day', 'Things were simpler', 'Groovier', 'Cooler', 'Now playing'] });
  tpl('romantic-comedy', 'Romantic Comedy', 'story', 'elegant', { mood: 'light', font: 'Georgia', color: '#ffffff', accent: '#ff6b9a', bpm: 108, key: 57, scale: 'maj', cast: [2, 2], logo: 'rays', cards: ['She had a plan', 'He had other ideas', 'Love', 'Is complicated', 'Get ready to fall'] });
  tpl('scary', 'Scary', 'dark', 'grunge', { mood: 'dark', font: 'Courier', color: '#f4f4f4', accent: '#b00000', bpm: 70, key: 46, logo: 'mountain', filter: 'bleach-bypass', cards: ['It started', 'With a whisper', 'Nobody believed', 'Until it was too late', 'Don’t look back'] });
  tpl('sci-fi', 'Sci-Fi', 'dark', 'scifi', { mood: 'scifi', font: 'Futura', color: '#bff4ff', accent: '#26d9ff', bpm: 96, key: 50, logo: 'globe', filter: 'sci-fi', cards: ['In the year 2150', 'Humanity reached', 'For the stars', 'What they found', 'Changed everything'] });
  tpl('spy', 'Spy', 'dark', 'clean', { mood: 'action', font: 'Menlo', color: '#ffffff', accent: '#d62828', bpm: 116, key: 50, logo: 'globe', filter: 'dramatic-cool', cards: ['Classified', 'Top secret', 'One agent', 'One mission', 'No way out'] });
  tpl('superhero', 'Superhero', 'epic', 'metal', { mood: 'action', font: 'Impact', color: '#ffffff', accent: '#e63946', bpm: 120, key: 52, logo: 'shield', cards: ['Not every hero', 'Wears a cape', 'But this one', 'Is different', 'Unleash the power'] });
  tpl('swashbuckler', 'Swashbuckler', 'epic', 'metal', { mood: 'epic', font: 'Papyrus', color: '#f3e3b5', accent: '#c9a227', bpm: 110, key: 50, logo: 'mountain', filter: 'western', cards: ['On the high seas', 'One crew', 'Seeks adventure', 'Treasure', 'And glory'] });
  tpl('teen', 'Teen', 'light', 'playful', { mood: 'retro', font: 'Marker Felt', color: '#ffffff', accent: '#8338ec', bpm: 116, key: 57, scale: 'maj', cast: [1, 6], logo: 'stars', cards: ['High school', 'Will never', 'Be the same', 'One summer', 'Changed everything'] });
  tpl('tearjerker', 'Tearjerker', 'story', 'elegant', { mood: 'romantic', font: 'Hoefler Text', color: '#ffffff', accent: '#8d99ae', bpm: 70, key: 53, cast: [1, 4], logo: 'stars', filter: 'dreamy', cards: ['Some moments', 'Stay with you', 'Forever', 'A story', 'Of hope'] });
  tpl('travel', 'Travel', 'journey', 'playful', { mood: 'documentary', font: 'Avenir Next', color: '#ffffff', accent: '#00a6fb', bpm: 104, key: 55, scale: 'maj', logo: 'globe', cards: ['Pack your bags', 'New places', 'New faces', 'The journey', 'Of a lifetime'] });
  const byId = new Map(TEMPLATES.map((t) => [t.id, t]));
  TEMPLATES.forEach((T) => { T.segments = ARCH[T.arch](); });

  // ------------------------------------------------------------------ drawing helpers
  const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
  function rgba(hex, a) { const [r, g, b] = IM.hexToRgb(hex).map((v) => Math.round(v * 255)); return `rgba(${r},${g},${b},${a})`; }
  function fade(st, i, o) { const a = clamp(st.t / (i || 0.35), 0, 1), b = clamp((st.dur - st.t) / (o || 0.35), 0, 1); return Math.min(a, b); }
  function fitFont(ctx, text, family, weight, maxW, px, italic) {
    let f = `${italic ? 'italic ' : ''}${weight} ${px.toFixed(2)}px ${IM.fontStack(family)}`;
    ctx.font = f;
    const w = ctx.measureText(text).width;
    if (w > maxW) { px *= maxW / w; f = `${italic ? 'italic ' : ''}${weight} ${px.toFixed(2)}px ${IM.fontStack(family)}`; }
    return { f, px };
  }
  function backdrop(ctx, W, H, T, st) {
    const t = st.t, A = T.accent;
    switch (T.theme) {
      case 'metal': {
        const g = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, W * 0.7);
        g.addColorStop(0, '#1a2129'); g.addColorStop(1, '#000');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(W / 2, H * 1.1);
        for (let i = 0; i < 9; i++) {
          const a = -Math.PI / 2 + (i - 4) * 0.17 + Math.sin(t * 0.3 + i) * 0.03;
          ctx.save(); ctx.rotate(a);
          const lg = ctx.createLinearGradient(0, 0, 0, -H * 1.3);
          lg.addColorStop(0, rgba(A, 0.10)); lg.addColorStop(1, rgba(A, 0));
          ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(-W * 0.01, 0); ctx.lineTo(W * 0.012, 0); ctx.lineTo(W * 0.06, -H * 1.3); ctx.lineTo(-W * 0.06, -H * 1.3); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        break;
      }
      case 'grunge': {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const fr = Math.floor(t * 24);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 70; i++) { const x = hash(fr * 13.1 + i) * W, y = hash(fr * 7.7 + i * 3.3) * H, r = 0.6 + hash(i + fr) * 2.2; ctx.fillRect(x, y, r * H / 1080, r * H / 1080); }
        if (hash(fr * 3.1) > 0.93) { ctx.fillStyle = rgba(A, 0.06); ctx.fillRect(0, 0, W, H); }
        break;
      }
      case 'elegant': {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#120a0c'); g.addColorStop(1, '#2a1418');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
          const x = (hash(i * 3.7) * 1.2 - 0.1 + t * 0.012 * (0.5 + hash(i))) % 1.1 * W, y = hash(i * 9.1) * H, r = (40 + hash(i * 1.3) * 90) * H / 1080;
          const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
          rg.addColorStop(0, rgba(A, 0.10)); rg.addColorStop(1, rgba(A, 0));
          ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'playful': {
        ctx.fillStyle = A; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        const sp = 90 * H / 1080;
        for (let y = -1; y < H / sp + 1; y++) for (let x = -1; x < W / sp + 1; x++) {
          const ox = ((y % 2) * sp / 2 + t * 18 * H / 1080) % sp;
          ctx.beginPath(); ctx.arc(x * sp + ox, y * sp, 7 * H / 1080, 0, 7); ctx.fill();
        }
        break;
      }
      case 'clean': {
        ctx.fillStyle = '#0c0d0f'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = rgba(A, 0.18); ctx.lineWidth = Math.max(1, H / 900);
        for (let i = 0; i < 6; i++) { const y = H * (0.2 + i * 0.13) + Math.sin(t * 0.4 + i) * 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        break;
      }
      case 'retro': {
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, W * 0.7);
        g.addColorStop(0, '#2c2419'); g.addColorStop(1, '#070504');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const fr = Math.floor(t * 18);
        ctx.fillStyle = 'rgba(255,240,210,0.07)';
        for (let i = 0; i < 3; i++) { const x = hash(fr * 5.3 + i) * W; ctx.fillRect(x, 0, Math.max(1, H / 700), H); }
        break;
      }
      case 'scifi': {
        ctx.fillStyle = '#02060d'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = rgba(A, 0.14); ctx.lineWidth = Math.max(1, H / 1000);
        const sp = 60 * H / 1080, off = (t * 30 * H / 1080) % sp;
        for (let x = 0; x <= W; x += sp) { ctx.beginPath(); ctx.moveTo(x, H * 0.55); ctx.lineTo(W / 2 + (x - W / 2) * 3, H); ctx.stroke(); }
        for (let y = H * 0.55 + off; y < H; y += sp * ((y - H * 0.5) / (H * 0.5)) + 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        break;
      }
      case 'bollywood': {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#7a0a3b'); g.addColorStop(1, '#d95d0f');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,215,106,0.8)';
        for (let i = 0; i < 40; i++) { const x = hash(i * 1.7) * W, y = hash(i * 4.9) * H, tw = 0.5 + 0.5 * Math.sin(t * 5 + i); const r = (1 + tw * 2.5) * H / 1080; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
        break;
      }
      default: ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    }
  }
  /** Draw `text` centred at y in the template's look. big: movie title. */
  function cardText(ctx, W, H, T, st, text, big) {
    const t = st.t, dur = st.dur, Sc = H / 1080;
    const theme = T.theme;
    const upper = theme === 'metal' || theme === 'clean' || theme === 'scifi' || theme === 'grunge';
    const s = upper ? text.toUpperCase() : text;
    const base = (big ? 150 : 104) * Sc;
    const a = fade(st, theme === 'elegant' ? 0.9 : 0.3, 0.35);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cx = W / 2, cy = H * 0.5;
    if (theme === 'metal' || theme === 'bollywood') {
      const k = clamp(t / dur, 0, 1);
      const sc = 1.1 - 0.1 * E.outCubic(k);
      const { f, px } = fitFont(ctx, s, T.font, 900, W * 0.84 / sc, base);
      ctx.translate(cx, cy); ctx.scale(sc, sc);
      ctx.font = f;
      const g = ctx.createLinearGradient(0, -px * 0.55, 0, px * 0.55);
      if (theme === 'metal') { g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, T.color); g.addColorStop(0.55, '#6f7780'); g.addColorStop(1, '#e8eef3'); }
      else { g.addColorStop(0, '#fff3c4'); g.addColorStop(0.5, '#e7b43b'); g.addColorStop(1, '#fff0b0'); }
      ctx.globalAlpha = a;
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 18 * Sc; ctx.shadowOffsetY = 4 * Sc;
      ctx.fillStyle = g; ctx.fillText(s, 0, 0);
      // specular glint travelling across the letters (drawn with the glyphs as its shape)
      const w = ctx.measureText(s).width;
      const sx = -w / 2 - w * 0.3 + (w * 1.6) * clamp((t - 0.2) / 1.2, 0, 1);
      ctx.shadowColor = 'transparent';
      const sg = ctx.createLinearGradient(sx - px, 0, sx + px, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.7)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg; ctx.fillText(s, 0, 0);
    } else if (theme === 'grunge') {
      const fr = Math.floor(t * 24);
      const fl = hash(fr * 1.3) > 0.88 ? 0.35 : 1;
      const { f } = fitFont(ctx, s, T.font, 700, W * 0.86, base);
      ctx.font = f; ctx.globalAlpha = a * fl;
      ctx.fillStyle = T.color;
      ctx.fillText(s, cx + (hash(fr) - 0.5) * 4 * Sc, cy + (hash(fr + 9) - 0.5) * 3 * Sc);
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 120; i++) { const x = cx + (hash(i * 3.1) - 0.5) * W * 0.8, y = cy + (hash(i * 5.3) - 0.5) * base; ctx.fillRect(x, y, (1 + hash(i) * 5) * Sc, (1 + hash(i * 2) * 3) * Sc); }
    } else if (theme === 'elegant') {
      const { f } = fitFont(ctx, s, T.font, 400, W * 0.86, base * 0.95, T.font !== 'Snell Roundhand');
      ctx.font = f; ctx.globalAlpha = a;
      ctx.shadowColor = rgba(T.accent, 0.8); ctx.shadowBlur = 26 * Sc;
      ctx.fillStyle = T.color;
      ctx.fillText(s, cx, cy - 16 * Sc * E.outCubic(clamp(t / dur, 0, 1)) + 8 * Sc);
    } else if (theme === 'playful') {
      const { f, px } = fitFont(ctx, s, T.font, 700, W * 0.86, base * 1.2);
      ctx.font = f;
      const chars = Array.from(s);
      const ws = chars.map((ch) => ctx.measureText(ch).width);
      let x = cx - ws.reduce((q, w) => q + w, 0) / 2;
      const cols = ['#ffffff', '#fff3b0', '#ffffff', '#d6f5ff'];
      chars.forEach((ch, i) => {
        const k = clamp((t - i * 0.04) / 0.35, 0, 1);
        const sc = k < 1 ? E.outBack ? E.outBack(k) : k : 1;
        ctx.save();
        ctx.translate(x + ws[i] / 2, cy); ctx.scale(sc, sc);
        ctx.globalAlpha = Math.min(k * 2, 1) * clamp((dur - t) / 0.3, 0, 1);
        ctx.lineWidth = px * 0.1; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineJoin = 'round';
        ctx.strokeText(ch, 0, 0);
        ctx.fillStyle = cols[i % cols.length]; ctx.fillText(ch, 0, 0);
        ctx.restore();
        x += ws[i];
      });
    } else if (theme === 'clean') {
      const { f, px } = fitFont(ctx, s, T.font, 300, W * 0.8, base * 0.72);
      ctx.font = f;
      const k = E.outCubic(clamp(t / 0.8, 0, 1));
      const tracking = (8 + 10 * clamp(t / dur, 0, 1)) * Sc;
      const chars = Array.from(s); const ws = chars.map((ch) => ctx.measureText(ch).width + tracking);
      const total = ws.reduce((q, w) => q + w, 0) - tracking;
      let x = cx - total / 2 + (1 - k) * 60 * Sc;
      ctx.globalAlpha = a; ctx.fillStyle = T.color; ctx.textAlign = 'left';
      chars.forEach((ch, i) => { ctx.fillText(ch, x, cy); x += ws[i]; });
      ctx.fillStyle = T.accent;
      ctx.fillRect(cx - total / 2, cy + px * 0.7, total * k, Math.max(2, 3 * Sc));
    } else if (theme === 'retro') {
      const n = Math.floor(clamp(t / 0.05, 0, s.length));
      const { f } = fitFont(ctx, s, T.font, 700, W * 0.84, base * 0.9);
      ctx.font = f; ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(s.slice(0, n), cx + 5 * Sc, cy + 5 * Sc);
      ctx.fillStyle = T.color; ctx.fillText(s.slice(0, n), cx, cy);
    } else if (theme === 'scifi') {
      const { f } = fitFont(ctx, s, T.font, 500, W * 0.84, base * 0.8);
      ctx.font = f; ctx.globalAlpha = a * (hash(Math.floor(t * 30)) > 0.95 ? 0.5 : 1);
      const k = E.outCubic(clamp(t / 0.7, 0, 1));
      ctx.beginPath(); ctx.rect(0, cy - base * 0.6 * k, W, base * 1.2 * k); ctx.clip();
      ctx.shadowColor = T.accent; ctx.shadowBlur = 24 * Sc;
      ctx.fillStyle = T.color; ctx.fillText(s, cx, cy);
      ctx.fillText(s, cx, cy);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ styles (internal title styles)
  function defineStyles(T) {
    IM.TitleStyles.define({
      id: 'trailer-card:' + T.id, name: T.name + ' Card', hidden: true, fields: 1, defaults: [T.cards[0]], font: T.font, color: T.color, duration: 2.2,
      render(ctx, W, H, st) { backdrop(ctx, W, H, T, st); cardText(ctx, W, H, T, st, st.text[0] || '', false); },
    });
    IM.TitleStyles.define({
      id: 'trailer-title:' + T.id, name: T.name + ' Title', hidden: true, fields: 1, defaults: ['Movie Title'], font: T.font, color: T.color, duration: 4,
      render(ctx, W, H, st) { backdrop(ctx, W, H, T, st); cardText(ctx, W, H, T, st, st.text[0] || '', true); },
    });
  }
  TEMPLATES.forEach(defineStyles);

  // studio logo: text[0] = studio name, text[1] = logo style
  IM.TitleStyles.define({
    id: 'trailer-logo', name: 'Studio Logo', hidden: true, fields: 2, defaults: ['Studio Name', 'spotlights'], font: 'Didot', color: '#ffffff', duration: 4.5,
    render(ctx, W, H, st) {
      const name = (st.text[0] || '').toUpperCase(), kind = st.text[1] || 'spotlights';
      const t = st.t, Sc = H / 1080;
      const a = fade(st, 0.8, 0.6);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#02030a'); sky.addColorStop(1, kind === 'mountain' ? '#1a2440' : '#0b1026');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = a;
      if (kind === 'spotlights') {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
          const bx = W * (0.2 + i * 0.2), ang = Math.sin(t * 0.9 + i * 1.7) * 0.5;
          ctx.save(); ctx.translate(bx, H); ctx.rotate(ang);
          const g = ctx.createLinearGradient(0, 0, 0, -H * 1.2);
          g.addColorStop(0, 'rgba(210,225,255,0.35)'); g.addColorStop(1, 'rgba(210,225,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-8 * Sc, 0); ctx.lineTo(8 * Sc, 0); ctx.lineTo(80 * Sc, -H * 1.2); ctx.lineTo(-80 * Sc, -H * 1.2); ctx.fill();
          ctx.restore();
        }
        ctx.globalCompositeOperation = 'source-over';
      } else if (kind === 'mountain') {
        ctx.fillStyle = '#e8edf7';
        for (let i = 0; i < 22; i++) { const ang = -Math.PI * (0.1 + 0.8 * i / 21) + t * 0.02, r = H * 0.33; ctx.beginPath(); ctx.arc(W / 2 + Math.cos(ang) * r * 1.2, H * 0.52 + Math.sin(ang) * r, 4 * Sc, 0, 7); ctx.fill(); }
        const g = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.75);
        g.addColorStop(0, '#dfe7f5'); g.addColorStop(1, '#4b5a78');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(W * 0.32, H * 0.72); ctx.lineTo(W * 0.5, H * 0.3); ctx.lineTo(W * 0.68, H * 0.72); ctx.fill();
      } else if (kind === 'globe') {
        const r = H * 0.28, cx = W / 2, cy = H * 0.5;
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
        g.addColorStop(0, '#2c6fbf'); g.addColorStop(1, '#071a36');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(160,210,255,0.45)'; ctx.lineWidth = 1.5 * Sc;
        for (let i = 0; i < 8; i++) { const ph = ((i / 8 + t * 0.05) % 1) * Math.PI; const rx = Math.abs(Math.cos(ph)) * r; ctx.beginPath(); ctx.ellipse(cx, cy, rx, r, 0, 0, 7); ctx.stroke(); }
        for (let j = -2; j <= 2; j++) { const y = cy + j * r * 0.33; const rx = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy))); ctx.beginPath(); ctx.ellipse(cx, y, rx, rx * 0.12, 0, 0, 7); ctx.stroke(); }
      } else if (kind === 'rays') {
        ctx.save(); ctx.translate(W / 2, H * 0.5); ctx.rotate(t * 0.05);
        for (let i = 0; i < 24; i++) { ctx.rotate(Math.PI / 12); ctx.fillStyle = i % 2 ? 'rgba(255,196,80,0.16)' : 'rgba(255,230,160,0.08)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, -40 * Sc); ctx.lineTo(W, 40 * Sc); ctx.fill(); }
        ctx.restore();
      } else if (kind === 'shield') {
        const cx = W / 2, cy = H * 0.47, w = H * 0.32, hh = H * 0.4;
        const g = ctx.createLinearGradient(0, cy - hh / 2, 0, cy + hh / 2);
        g.addColorStop(0, '#f6e7b0'); g.addColorStop(1, '#8a6d2b');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - w / 2, cy - hh / 2); ctx.lineTo(cx + w / 2, cy - hh / 2); ctx.lineTo(cx + w / 2, cy + hh * 0.1); ctx.quadraticCurveTo(cx + w / 2, cy + hh * 0.4, cx, cy + hh / 2); ctx.quadraticCurveTo(cx - w / 2, cy + hh * 0.4, cx - w / 2, cy + hh * 0.1); ctx.closePath(); ctx.fill();
      } else if (kind === 'stars') {
        for (let i = 0; i < 120; i++) { const x = hash(i * 2.3) * W, y = hash(i * 7.1) * H; const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i)); ctx.fillStyle = `rgba(255,255,255,${tw})`; ctx.fillRect(x, y, 2 * Sc, 2 * Sc); }
      }
      // studio name
      const { f } = fitFont(ctx, name, 'Didot', 700, W * 0.8, 110 * Sc);
      ctx.font = f; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const ny = kind === 'mountain' || kind === 'shield' ? H * 0.82 : H * 0.5;
      const mg = ctx.createLinearGradient(0, ny - 60 * Sc, 0, ny + 60 * Sc);
      mg.addColorStop(0, '#ffffff'); mg.addColorStop(0.5, '#c9d2dc'); mg.addColorStop(0.51, '#8e98a3'); mg.addColorStop(1, '#f4f7fa');
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 20 * Sc; ctx.shadowOffsetY = 5 * Sc;
      ctx.fillStyle = mg; ctx.fillText(name, W / 2, ny);
      ctx.restore();
    },
  });
  // cast card: text[0] = name, text[1] = template id
  IM.TitleStyles.define({
    id: 'trailer-cast', name: 'Cast Card', hidden: true, fields: 2, defaults: ['Name', 'blockbuster'], duration: 1.8,
    render(ctx, W, H, st) { const T = byId.get(st.text[1]) || TEMPLATES[0]; backdrop(ctx, W, H, T, st); cardText(ctx, W, H, T, st, st.text[0] || '', false); },
  });
  // credits: text = [title, date, template id, ...credit lines]
  IM.TitleStyles.define({
    id: 'trailer-credits', name: 'Trailer Credits', hidden: true, fields: 3, defaults: ['Movie Title', 'Coming Soon', 'blockbuster'], duration: 5,
    render(ctx, W, H, st) {
      const T = byId.get(st.text[2]) || TEMPLATES[0], Sc = H / 1080;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const a = fade(st, 0.6, 0.8);
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      // movie title
      let r = fitFont(ctx, (st.text[0] || '').toUpperCase(), T.font, 800, W * 0.7, 96 * Sc);
      ctx.font = r.f; ctx.fillStyle = T.color; ctx.fillText((st.text[0] || '').toUpperCase(), W / 2, H * 0.36);
      // billing block (condensed)
      const lines = st.text.slice(3).filter(Boolean);
      const rows = []; for (let i = 0; i < lines.length; i += 3) rows.push(lines.slice(i, i + 3).join('    '));
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      rows.forEach((row, i) => {
        ctx.save(); ctx.translate(W / 2, H * 0.52 + i * 40 * Sc); ctx.scale(0.72, 1.18);
        r = fitFont(ctx, row.toUpperCase(), 'Helvetica Neue', 500, W * 0.86 / 0.72, 26 * Sc);
        ctx.font = r.f; ctx.fillText(row.toUpperCase(), 0, 0);
        ctx.restore();
      });
      // release date
      r = fitFont(ctx, (st.text[1] || '').toUpperCase(), T.font, 600, W * 0.6, 54 * Sc);
      ctx.font = r.f; ctx.fillStyle = T.accent; ctx.fillText((st.text[1] || '').toUpperCase(), W / 2, H * 0.52 + rows.length * 40 * Sc + 90 * Sc);
      ctx.restore();
    },
  });
  // empty shot: text = [shot kind label, cast name, kind id]
  IM.TitleStyles.define({
    id: 'trailer-placeholder', name: 'Placeholder', hidden: true, fields: 3, defaults: ['Medium', '', 'medium'], duration: 1.5,
    render(ctx, W, H, st) {
      const Sc = H / 1080, kind = st.text[2] || 'medium';
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#3a3a3c'); g.addColorStop(1, '#1f1f21');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      const person = (x, y, s) => {
        ctx.beginPath(); ctx.arc(x, y - s * 0.62, s * 0.2, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - s * 0.36, y + s * 0.4); ctx.quadraticCurveTo(x - s * 0.36, y - s * 0.34, x, y - s * 0.36); ctx.quadraticCurveTo(x + s * 0.36, y - s * 0.34, x + s * 0.36, y + s * 0.4); ctx.fill();
      };
      const cx = W / 2, cy = H * 0.5;
      if (kind === 'closeup') { ctx.beginPath(); ctx.arc(cx, cy - H * 0.02, H * 0.2, 0, 7); ctx.fill(); ctx.fillRect(cx - H * 0.26, cy + H * 0.2, H * 0.52, H * 0.4); }
      else if (kind === 'medium') person(cx, cy + H * 0.12, H * 0.62);
      else if (kind === 'twoshot') { person(cx - H * 0.22, cy + H * 0.14, H * 0.55); person(cx + H * 0.22, cy + H * 0.14, H * 0.55); }
      else if (kind === 'group') { for (let i = -2; i <= 2; i++) person(cx + i * H * 0.2, cy + H * 0.16 + Math.abs(i) * H * 0.03, H * 0.42); }
      else if (kind === 'wide') { ctx.fillRect(0, cy + H * 0.2, W, H * 0.3); person(cx, cy + H * 0.12, H * 0.24); }
      else if (kind === 'landscape') { ctx.beginPath(); ctx.moveTo(0, H * 0.8); ctx.lineTo(W * 0.3, H * 0.45); ctx.lineTo(W * 0.5, H * 0.65); ctx.lineTo(W * 0.72, H * 0.38); ctx.lineTo(W, H * 0.8); ctx.fill(); ctx.beginPath(); ctx.arc(W * 0.78, H * 0.22, H * 0.07, 0, 7); ctx.fill(); }
      else { // action
        ctx.save(); ctx.translate(cx, cy + H * 0.1); ctx.rotate(-0.25); person(0, 0, H * 0.5); ctx.restore();
        for (let i = 0; i < 4; i++) ctx.fillRect(cx - H * 0.62 - i * H * 0.05, cy - H * 0.1 + i * H * 0.08, H * 0.28, H * 0.018);
      }
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = `600 ${(46 * Sc).toFixed(2)}px ${IM.fontStack('Helvetica Neue')}`;
      ctx.fillText(st.text[0] || '', cx, H * 0.9);
      if (st.text[1]) { ctx.font = `400 ${(34 * Sc).toFixed(2)}px ${IM.fontStack('Helvetica Neue')}`; ctx.fillText(st.text[1], cx, H * 0.9 - 56 * Sc); }
    },
  });

  // ------------------------------------------------------------------ model
  function monthYear() {
    const d = new Date(); d.setMonth(d.getMonth() + 2);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  function create(templateId, name) {
    const T = byId.get(templateId) || TEMPLATES[0];
    const nCast = T.cast[0];
    const names = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Riley', 'Casey'];
    const p = Pr.create(name || T.name, null);
    p.kind = 'trailer';
    p.trailer = {
      template: T.id, title: T.name === 'Pets' ? 'Best Friends' : 'Movie Title', date: monthYear(),
      cast: Array.from({ length: nCast }, (x, i) => ({ name: T.id === 'pets' ? 'Buddy' : names[i], gender: i % 2 ? 'female' : 'male' })),
      studio: 'Studio Name', logo: T.logo,
      credits: { director: 'Your Name', editor: 'Your Name', writer: 'Your Name', producer: 'Your Name', executive: '', photography: '', design: '', costume: '', casting: '', music: '' },
      cards: {}, fills: {},
    };
    rebuild(p);
    return p;
  }
  /** Card text for segment i. */
  function cardTextOf(p, i) {
    const T = byId.get(p.trailer.template), sg = T.segments[i];
    const v = p.trailer.cards[i];
    return v != null ? v : T.cards[sg.i] || '';
  }
  function castName(p, i) { const c = p.trailer.cast[i]; return c ? c.name : ''; }
  /** Shot segments a template actually uses (cast-specific shots drop out when there are fewer cast members). */
  function segmentsOf(p) {
    const T = byId.get(p.trailer.template);
    const n = p.trailer.cast.length;
    return T.segments.map((sg, i) => Object.assign({ index: i }, sg, sg.cast != null && sg.cast >= n ? { cast: n - 1 } : {}))
      .filter((sg) => !(sg.t === 'castcard' && sg.cast >= n));
  }
  /** Bring manual clip adjustments made in the viewer (color, crop, volume…) back into the model. */
  function syncFromClips(p) {
    const tr = p.trailer;
    for (const it of p.clips) {
      const m = /^trl-(\d+)$/.exec(it.id);
      if (!m) continue;
      const f = tr.fills[m[1]];
      if (!f || it.mediaId !== f.mediaId) continue;
      f.video = IM.clone(it.video);
      f.volume = it.audio.mute ? 0 : it.audio.volume;
      if (it.type === 'video' && Math.abs((it.speed || 1) - 1) < 1e-6) f.srcIn = it.srcIn;
    }
  }
  /** Regenerate the trailer's clips, cards, credits and score from its model. */
  function rebuild(p) {
    const tr = p.trailer, T = byId.get(tr.template) || TEMPLATES[0];
    const fps = Pr.fps(p);
    const segs = segmentsOf(p);
    const clips = [];
    let f = 0;
    const hits = [];
    let logoEnd = 0, titleAt = 0, creditsAt = 0;
    for (const sg of segs) {
      const id = 'trl-' + sg.index;
      const nF = Math.max(1, Math.round(sg.d * fps)), d = nF / fps;
      let it;
      if (sg.t === 'shot') {
        const fill = tr.fills[sg.index];
        const m = fill && IM.lib.get(fill.mediaId);
        if (m && m.kind !== 'audio') {
          if (m.kind === 'image') {
            it = Pr.itemFromMedia(m, 0, 0, Object.assign({}, IM.prefs, { photoDuration: d }));
            it.srcOut = d;
          } else {
            const room = Math.max(0, (m.duration || 0) - 0.05);
            let a = clamp(fill.srcIn || 0, 0, Math.max(0, room - d));
            it = Pr.itemFromMedia(m, a, a + d);
            if (room < d) { a = 0; it.srcIn = 0; it.srcOut = room; it.speed = room / d; it.preservePitch = true; }
          }
          if (fill.video) it.video = Object.assign(it.video, IM.clone(fill.video));
          it.audio.volume = fill.volume != null ? fill.volume : 0;
          it.audio.mute = !it.audio.volume;
        } else {
          it = Pr.makeTitle('trailer-placeholder', { text: [SHOTS[sg.k], sg.cast != null ? castName(p, sg.cast) : '', sg.k] });
          it.srcOut = d;
        }
      } else {
        if (sg.t === 'logo') it = Pr.makeTitle('trailer-logo', { text: [tr.studio, tr.logo || T.logo] });
        else if (sg.t === 'card') { it = Pr.makeTitle('trailer-card:' + T.id, { text: [cardTextOf(p, sg.index)] }); hits.push(f / fps); }
        else if (sg.t === 'castcard') { it = Pr.makeTitle('trailer-cast', { text: [castName(p, sg.cast).toUpperCase(), T.id] }); hits.push(f / fps); }
        else if (sg.t === 'title') { it = Pr.makeTitle('trailer-title:' + T.id, { text: [tr.title] }); titleAt = f / fps; }
        else if (sg.t === 'credits') {
          const lines = CREDITS.map(([k, label]) => (tr.credits[k] ? label + ' ' + tr.credits[k] : '')).filter(Boolean);
          const starring = tr.cast.map((c) => c.name).filter(Boolean);
          if (starring.length) lines.unshift('Starring ' + starring.join(', '));
          it = Pr.makeTitle('trailer-credits', { text: [tr.title, tr.date, T.id, ...lines] });
          creditsAt = f / fps;
        }
        it.srcIn = 0; it.srcOut = d;
      }
      it.id = id;
      it.name = sg.t === 'shot' ? (SHOTS[sg.k] + (sg.cast != null ? ' – ' + castName(p, sg.cast) : '')) : it.name;
      if (sg.t === 'logo') logoEnd = (f + nF) / fps;
      clips.push(it);
      f += nF;
    }
    const total = f / fps;
    p.clips = clips;
    p.connected = [];
    const scoreId = IM.AudioGen.trailerScore({
      name: T.name + ' Trailer', duration: +total.toFixed(4), mood: T.mood, bpm: T.bpm, key: T.key, scale: T.scale, seed: T.id.length,
      cues: { logoEnd: +logoEnd.toFixed(4), hits: hits.map((x) => +x.toFixed(4)), titleAt: +titleAt.toFixed(4), creditsAt: +creditsAt.toFixed(4) },
    });
    const sm = IM.builtinMedia(scoreId);
    const music = Pr.itemFromMedia(sm, 0, total);
    music.id = 'trl-music';
    music.name = T.name + ' Trailer';
    p.music = [music];
    p.settings.filter = T.filter || 'none';
    p.settings.theme = null;
    Pr.invalidate(p);
  }
  /** Called inside every edit of a trailer project. */
  function afterEdit(p) {
    if (p.kind !== 'trailer' || !p.trailer) return;
    syncFromClips(p);
    rebuild(p);
  }
  /** Make a loaded trailer ready (registers its score). */
  function ensure(p) { if (p && p.kind === 'trailer' && p.trailer) rebuild(p); }
  /** Turn a trailer into a regular movie (its current clips, cards and music). */
  function toMovie(p) {
    delete p.trailer;
    p.kind = 'movie';
    p.clips.forEach((c) => { c.id = IM.uid('c'); });
    p.music.forEach((c) => { c.id = IM.uid('c'); });
    Pr.invalidate(p);
  }
  function duration(T) { return T.segments.reduce((s, sg) => s + sg.d, 0); }

  IM.trailers = Object.assign(IM.trailers || {}, {
    TEMPLATES, SHOTS, LOGOS, CREDITS, get: (id) => byId.get(id), create, rebuild, afterEdit, ensure, toMovie, segmentsOf, cardTextOf, castName, duration,
  });
})(window.IM = window.IM || {});
