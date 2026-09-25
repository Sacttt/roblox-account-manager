'use strict';
/*
 * Centralized Theme Engine (requirement #17).
 *
 * One module owns the entire visual identity. It works by overriding the CSS
 * custom properties the rest of the app already uses (--bg-base, --panel,
 * --accent, …), so nothing else in the UI hard-codes a holiday or a palette.
 *
 *   Theme -> color tokens  -> :root variables (whole UI recolors)
 *          -> effects       -> body classes (frames, card decorations)
 *          -> background     -> canvas particle layer
 *          -> lighting (RGB) -> animated accent override
 *          -> calendar rules -> seasonal auto / early activation
 *
 * Persistence rides on the existing settings store (window.api.updateSettings),
 * so no new main-process code is required.
 */
(function () {
  // ---------- color helpers ----------
  function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return { r: 240, g: 178, b: 66 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; }
  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
  }
  function lighten(hex, t) { return mix(hex, '#ffffff', t); }
  function darken(hex, t) { return mix(hex, '#000000', t); }

  // ---------- built-in themes ----------
  // Each theme is a compact palette; deriveVars() expands it into the full set
  // of CSS variables the app consumes.
  const BUILTIN = [
    { id: 'gold',    name: 'Golden Default', icon: '✨', kind: 'built-in',
      colors: { bg: '#08090d', panel: '#12141c', card: '#161924', border: '#ffffff14', text: '#f3f5f9', dim: '#9aa1b5', accent: '#f0b242', glow: 0.35 }, bgType: 'gradient' },
    { id: 'midnight', name: 'Midnight', icon: '🌑', kind: 'built-in',
      colors: { bg: '#05070f', panel: '#0b1020', card: '#0e1526', border: '#22304814', text: '#eaf0ff', dim: '#8492b5', accent: '#3b82f6', glow: 0.30 }, bgType: 'stars' },
    { id: 'cyber',   name: 'Cyber Neon', icon: '👾', kind: 'built-in',
      colors: { bg: '#0a0612', panel: '#140a24', card: '#180d2c', border: '#7c3aed26', text: '#f0e9ff', dim: '#a794c9', accent: '#a855f7', accent2: '#22d3ee', glow: 0.40 }, bgType: 'cybergrid' },
    { id: 'aurora',  name: 'Aurora', icon: '🌌', kind: 'built-in',
      colors: { bg: '#04120f', panel: '#0a1f1c', card: '#0c2622', border: '#34d39926', text: '#e6fff7', dim: '#84b5a8', accent: '#34d399', accent2: '#818cf8', glow: 0.34 }, bgType: 'aurora' },
    { id: 'crimson', name: 'Crimson', icon: '🔥', kind: 'built-in',
      colors: { bg: '#0d0506', panel: '#1c0b0e', card: '#240d11', border: '#f43f5e26', text: '#fff0f2', dim: '#c99aa2', accent: '#f43f5e', glow: 0.36 }, bgType: 'particles' },
    { id: 'arctic',  name: 'Arctic', icon: '❄️', kind: 'built-in',
      colors: { bg: '#0a1016', panel: '#111c26', card: '#152230', border: '#7dd3fc26', text: '#eef6ff', dim: '#93a8bd', accent: '#38bdf8', glow: 0.28 }, bgType: 'snow' },
    { id: 'golden',  name: 'Golden Luxury', icon: '👑', kind: 'built-in',
      colors: { bg: '#0a0800', panel: '#171200', card: '#1e1704', border: '#f0b24226', text: '#fff8e6', dim: '#c9b98a', accent: '#f5c451', glow: 0.38 }, bgType: 'particles' },
    { id: 'halloween', name: 'Halloween', icon: '🎃', kind: 'built-in', seasonal: true,
      colors: { bg: '#0c0710', panel: '#180d1c', card: '#1e1024', border: '#f9731626', text: '#ffeede', dim: '#b596a8', accent: '#f97316', accent2: '#a855f7', glow: 0.34 }, bgType: 'particles', frame: 'halloween', cardDecor: 'halloween',
      calendar: { start: '10-01', end: '11-01' } },
    { id: 'christmas', name: 'Christmas', icon: '🎄', kind: 'built-in', seasonal: true,
      colors: { bg: '#050f0a', panel: '#0a1c12', card: '#0c2216', border: '#22c55e26', text: '#eafff9', dim: '#8bbda3', accent: '#ef4444', accent2: '#22c55e', glow: 0.32 }, bgType: 'snow', frame: 'christmas', cardDecor: 'christmas',
      calendar: { start: '12-01', end: '01-02' } }
  ];

  // Extra seasonal-only themes (not shown as everyday built-ins, used by the
  // calendar engine and the seasonal list).
  const SEASONAL = [
    { id: 'newyear', name: "New Year's", icon: '🎆', seasonal: true,
      colors: { bg: '#07080f', panel: '#10131f', card: '#141827', border: '#facc1526', text: '#fbfaff', dim: '#9aa1c0', accent: '#facc15', accent2: '#e5e7eb', glow: 0.34 }, bgType: 'particles', frame: 'gold',
      calendar: { start: '12-31', end: '01-02' }, priority: 10 },
    { id: 'valentines', name: "Valentine's", icon: '❤️', seasonal: true,
      colors: { bg: '#120510', panel: '#210a1b', card: '#280c21', border: '#f472b626', text: '#fff0f7', dim: '#c99ab4', accent: '#f472b6', glow: 0.32 }, bgType: 'particles', frame: 'valentines', cardDecor: 'valentines',
      calendar: { start: '02-07', end: '02-15' } },
    { id: 'stpatrick', name: "St. Patrick's", icon: '☘️', seasonal: true,
      colors: { bg: '#04120a', panel: '#0a2015', card: '#0c2618', border: '#22c55e26', text: '#eafff2', dim: '#8bbda0', accent: '#22c55e', glow: 0.30 }, bgType: 'particles',
      calendar: { start: '03-15', end: '03-18' } },
    { id: 'spring', name: 'Spring', icon: '🌸', seasonal: true,
      colors: { bg: '#0a1210', panel: '#132018', card: '#16261d', border: '#f9a8d426', text: '#f2fff6', dim: '#9ab5a4', accent: '#f9a8d4', accent2: '#86efac', glow: 0.26 }, bgType: 'leaves', frame: 'spring', cardDecor: 'spring',
      calendar: { start: '03-20', end: '06-01' }, priority: 1 },
    { id: 'easter', name: 'Easter', icon: '🐰', seasonal: true,
      colors: { bg: '#0d1012', panel: '#171d22', card: '#1b232a', border: '#c4b5fd26', text: '#f6f2ff', dim: '#a8a0bd', accent: '#c4b5fd', accent2: '#fca5a5', glow: 0.26 }, bgType: 'particles',
      calendar: { start: '03-29', end: '04-05' }, priority: 5 },
    { id: 'summer', name: 'Summer', icon: '☀️', seasonal: true,
      colors: { bg: '#04101a', panel: '#0a1e2e', card: '#0c2436', border: '#38bdf826', text: '#eafaff', dim: '#8fb0c2', accent: '#38bdf8', accent2: '#fb923c', glow: 0.30 }, bgType: 'waves', frame: 'summer',
      calendar: { start: '06-01', end: '09-01' }, priority: 1 },
    { id: 'independence', name: 'Independence Day', icon: '🎆', seasonal: true,
      colors: { bg: '#060812', panel: '#0d1224', card: '#10162c', border: '#3b82f626', text: '#f5f8ff', dim: '#94a1c0', accent: '#ef4444', accent2: '#3b82f6', glow: 0.34 }, bgType: 'particles',
      calendar: { start: '07-01', end: '07-05' }, priority: 8 },
    { id: 'autumn', name: 'Autumn', icon: '🍂', seasonal: true,
      colors: { bg: '#100b06', panel: '#1e150c', card: '#261a0f', border: '#f9731626', text: '#fff3e6', dim: '#c2a586', accent: '#f97316', accent2: '#eab308', glow: 0.30 }, bgType: 'leaves', frame: 'autumn', cardDecor: 'autumn',
      calendar: { start: '09-01', end: '11-30' }, priority: 1 },
    { id: 'thanksgiving', name: 'Thanksgiving', icon: '🦃', seasonal: true,
      colors: { bg: '#100b06', panel: '#1e150c', card: '#261a0f', border: '#d9770626', text: '#fff3e6', dim: '#c2a586', accent: '#d97706', glow: 0.30 }, bgType: 'leaves',
      calendar: { start: '11-20', end: '11-30' }, priority: 6 },
    { id: 'lunar', name: 'Lunar New Year', icon: '🏮', seasonal: true,
      colors: { bg: '#120607', panel: '#210b0d', card: '#280d10', border: '#ef444426', text: '#fff0f0', dim: '#c99a9c', accent: '#ef4444', accent2: '#f5c451', glow: 0.34 }, bgType: 'particles',
      calendar: { start: '01-29', end: '02-05' }, priority: 7 },
    { id: 'winter', name: 'Winter', icon: '☃️', seasonal: true,
      colors: { bg: '#080f16', panel: '#0f1c28', card: '#132230', border: '#7dd3fc26', text: '#eef6ff', dim: '#93a8bd', accent: '#7dd3fc', glow: 0.26 }, bgType: 'snow', frame: 'winter', cardDecor: 'winter',
      calendar: { start: '01-02', end: '03-20' }, priority: 0 }
  ];

  const LIGHTING_MODES = ['static', 'rgb', 'rainbow', 'aurora', 'cyber', 'fire', 'ocean', 'sunset', 'seasonal'];
  const FRAMES = ['none', 'default', 'neon', 'rgb', 'gold', 'silver', 'halloween', 'christmas', 'winter', 'valentines', 'spring', 'summer', 'autumn', 'cyberpunk', 'galaxy', 'fire', 'ice', 'rainbow'];
  const BACKGROUNDS = ['static', 'gradient', 'animated-gradient', 'aurora', 'stars', 'snow', 'rain', 'leaves', 'particles', 'galaxy', 'cybergrid', 'waves', 'seasonal'];
  const PERF = ['off', 'low', 'medium', 'high'];

  // ---------- state ----------
  const defaultState = {
    themeId: 'gold',
    lighting: { mode: 'static', speed: 40, brightness: 60, saturation: 70, glow: 35 },
    effects: { seasonalTheme: true, seasonalBackground: true, frames: true, particles: true, snowfall: true, animatedLights: true, rgb: false, sounds: false },
    frame: 'none',
    background: { type: 'gradient', perf: 'medium' },
    seasonal: { auto: true, allowEarly: true, autoSwitch: true, returnAfter: true, animations: true, sounds: false, earlyId: null, countdown: true },
    custom: [],   // user-created themes
    schedule: []  // [{id, themeId, start:'MM-DD', end:'MM-DD'}]
  };
  let state = JSON.parse(JSON.stringify(defaultState));
  let styleEl = null, canvas = null, ctx = null, rafBg = 0, rafRgb = 0, particles = [], previewBackup = null;
  let reducedMotion = false;

  function allThemes() { return BUILTIN.concat(SEASONAL, state.custom || []); }
  function findTheme(id) { return allThemes().find(t => t.id === id) || BUILTIN[0]; }

  // ---------- variable application ----------
  function deriveVars(c) {
    const accent = c.accent || '#f0b242';
    const accentLight = c.accentLight || lighten(accent, 0.35);
    const accent2 = c.accent2 || accent;
    const glow = typeof c.glow === 'number' ? c.glow : 0.35;
    return {
      '--bg-base': c.bg,
      '--bg-deep': darken(c.bg, 0.35),
      '--panel-solid': c.panel,
      '--panel': rgba(c.panel, 0.75),
      '--panel-card': rgba(c.card, 0.85),
      '--panel-card-hover': rgba(lighten(c.card, 0.06), 0.95),
      '--panel-elevated': rgba(lighten(c.card, 0.05), 0.92),
      '--border': c.border || rgba('#ffffff', 0.08),
      '--border-hover': rgba('#ffffff', 0.16),
      '--border-highlight': rgba(accent, 0.35),
      '--text': c.text || '#f3f5f9',
      '--text-secondary': c.dim || '#9aa1b5',
      '--text-muted': darken(c.dim || '#9aa1b5', 0.25),
      '--accent': accent,
      '--accent-light': accentLight,
      '--accent-glow': rgba(accent, glow),
      '--accent-dim': rgba(accent, 0.12),
      '--accent-gradient': `linear-gradient(135deg, ${accentLight} 0%, ${accent} 55%, ${accent2} 100%)`,
      '--accent-gradient-hover': `linear-gradient(135deg, ${lighten(accentLight, 0.1)} 0%, ${lighten(accent, 0.08)} 100%)`
    };
  }
  function writeVars(vars) {
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'ram-theme-vars'; document.head.appendChild(styleEl); }
    const body = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ');
    styleEl.textContent = `:root { ${body} }`;
  }

  // ---------- lighting / RGB ----------
  function lightingPalette(mode) {
    switch (mode) {
      case 'rainbow': return null; // full hue sweep
      case 'aurora': return ['#34d399', '#3b82f6', '#a855f7'];
      case 'cyber': return ['#3b82f6', '#a855f7', '#22d3ee'];
      case 'fire': return ['#ef4444', '#f97316', '#facc15'];
      case 'ocean': return ['#0ea5e9', '#22d3ee', '#2563eb'];
      case 'sunset': return ['#f97316', '#ec4899', '#a855f7'];
      default: return null;
    }
  }
  function stopRgb() { if (rafRgb) cancelAnimationFrame(rafRgb); rafRgb = 0; }
  function startRgb(mode) {
    stopRgb();
    if (reducedMotion) return;
    const L = state.lighting;
    const sat = L.saturation, light = 35 + (L.brightness / 100) * 30;
    const pal = lightingPalette(mode);
    const speed = Math.max(2, L.speed) / 100; // cycles/sec-ish
    const start = performance.now();
    const step = (now) => {
      const t = ((now - start) / 1000) * speed;
      let accent;
      if (mode === 'rainbow' || mode === 'rgb') {
        accent = hslToHex((t * 120) % 360, sat, light);
      } else if (pal) {
        const p = (t % 1) * pal.length; const i = Math.floor(p), f = p - i;
        accent = mix(pal[i % pal.length], pal[(i + 1) % pal.length], f);
      } else { return; }
      const glow = (state.lighting.glow || 35) / 100;
      writeVars(Object.assign({}, currentVars, {
        '--accent': accent,
        '--accent-light': lighten(accent, 0.3),
        '--accent-glow': rgba(accent, glow),
        '--accent-dim': rgba(accent, 0.12),
        '--border-highlight': rgba(accent, 0.35),
        '--accent-gradient': `linear-gradient(135deg, ${lighten(accent, 0.3)} 0%, ${accent} 100%)`
      }));
      rafRgb = requestAnimationFrame(step);
    };
    rafRgb = requestAnimationFrame(step);
  }

  // ---------- animated background ----------
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'theme-bg-canvas';
    document.body.insertBefore(canvas, document.body.firstChild);
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  }
  function resizeCanvas() { if (!canvas) return; canvas.width = innerWidth; canvas.height = innerHeight; }
  function stopBg() { if (rafBg) cancelAnimationFrame(rafBg); rafBg = 0; if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height); }
  function perfCount(perf) { return { off: 0, low: 30, medium: 70, high: 140 }[perf] ?? 70; }

  function initBackground() {
    ensureCanvas();
    stopBg();
    let type = state.background.type;
    if (type === 'seasonal') { const s = getActiveSeasonal() || findTheme(state.themeId); type = s.bgType || 'gradient'; }
    const perf = state.background.perf;
    document.body.classList.toggle('has-anim-bg', type !== 'static' && perf !== 'off');
    if (perf === 'off' || reducedMotion || type === 'static' || type === 'gradient') {
      // static or plain gradient: draw a soft radial once, no animation
      if (canvas) { drawGradient(); }
      return;
    }
    const n = perfCount(perf);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f0b242';
    particles = makeParticles(type, n, accent);
    const loop = () => { drawFrame(type, accent); rafBg = requestAnimationFrame(loop); };
    loop();
  }
  function drawGradient() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#08090d';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f0b242';
    const g = ctx.createRadialGradient(canvas.width * 0.8, 0, 0, canvas.width * 0.8, 0, canvas.height * 1.2);
    g.addColorStop(0, rgba(accent, 0.10)); g.addColorStop(1, bg);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  function makeParticles(type, n, accent) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        r: Math.random() * 2.4 + 0.6, s: Math.random() * 1 + 0.3,
        d: Math.random() * Math.PI * 2, tw: Math.random() * Math.PI * 2,
        hue: Math.random() * 60
      });
    }
    return arr;
  }
  function drawFrame(type, accent) {
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#08090d';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const t = performance.now() / 1000;

    if (type === 'aurora' || type === 'animated-gradient') {
      for (let i = 0; i < 3; i++) {
        const x = (Math.sin(t * 0.2 + i) * 0.5 + 0.5) * w;
        const g = ctx.createRadialGradient(x, h * (0.2 + i * 0.15), 0, x, h * (0.2 + i * 0.15), h * 0.6);
        const col = [accent, '#3b82f6', '#a855f7'][i % 3];
        g.addColorStop(0, rgba(col, 0.16)); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      return;
    }
    if (type === 'cybergrid') {
      ctx.strokeStyle = rgba(accent, 0.14); ctx.lineWidth = 1;
      const off = (t * 30) % 40;
      for (let x = -40 + off; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = -40 + off; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      return;
    }
    if (type === 'waves') {
      ctx.strokeStyle = rgba(accent, 0.20); ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = h * (0.5 + k * 0.12) + Math.sin(x * 0.01 + t * (1 + k * 0.3)) * 22;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return;
    }

    // particle-based: snow / rain / leaves / stars / particles / galaxy
    for (const p of particles) {
      if (type === 'rain') {
        p.y += p.s * 12; p.x += 1;
        if (p.y > h) { p.y = -10; p.x = Math.random() * w; }
        ctx.strokeStyle = rgba('#9ec5ff', 0.35); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 1, p.y + 10); ctx.stroke();
      } else if (type === 'snow') {
        p.y += p.s * 1.3; p.x += Math.sin(t + p.d) * 0.5;
        if (p.y > h) { p.y = -6; p.x = Math.random() * w; }
        ctx.fillStyle = rgba('#ffffff', 0.8); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      } else if (type === 'leaves') {
        p.y += p.s * 1.6; p.x += Math.sin(t * 1.2 + p.d) * 1.2;
        if (p.y > h) { p.y = -10; p.x = Math.random() * w; }
        ctx.fillStyle = rgba(mix('#f97316', '#eab308', (p.hue / 60)), 0.7);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r + 2, p.r, p.d + t, 0, 7); ctx.fill();
      } else if (type === 'galaxy') {
        p.tw += 0.05; const a = 0.4 + Math.sin(p.tw) * 0.3;
        ctx.fillStyle = rgba(mix('#a855f7', '#22d3ee', p.hue / 60), a);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      } else { // stars / particles
        p.tw += 0.04;
        const a = type === 'stars' ? (0.3 + Math.sin(p.tw) * 0.35) : 0.5;
        if (type === 'particles') { p.y -= p.s * 0.4; p.x += Math.sin(t + p.d) * 0.3; if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; } }
        ctx.fillStyle = rgba(accent, a); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
    }
  }

  // ---------- seasonal calendar ----------
  function mmddToNum(s) { const [m, d] = s.split('-').map(Number); return m * 100 + d; }
  function inRange(todayNum, start, end) {
    const s = mmddToNum(start), e = mmddToNum(end);
    return s <= e ? (todayNum >= s && todayNum < e) : (todayNum >= s || todayNum < e); // wrap (e.g. winter)
  }
  function seasonalThemes() { return allThemes().filter(t => t.seasonal && t.calendar); }
  function getActiveSeasonal(date) {
    const now = date || new Date();
    const num = (now.getMonth() + 1) * 100 + now.getDate();
    const active = seasonalThemes().filter(t => inRange(num, t.calendar.start, t.calendar.end));
    if (!active.length) return null;
    return active.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  }
  function daysUntil(startMMDD) {
    const now = new Date(); const [m, d] = startMMDD.split('-').map(Number);
    let target = new Date(now.getFullYear(), m - 1, d);
    if (target < now) target = new Date(now.getFullYear() + 1, m - 1, d);
    return target - now;
  }
  function fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return `${d}d · ${String(h).padStart(2, '0')}h · ${String(m).padStart(2, '0')}m`;
  }

  // ---------- apply ----------
  let currentVars = {};
  function applyTheme(theme, opts) {
    opts = opts || {};
    const vars = deriveVars(theme.colors || {});
    currentVars = vars;
    // smooth transition: briefly enable color transitions on everything
    if (!reducedMotion && !opts.silent) {
      document.body.classList.add('theme-anim');
      setTimeout(() => document.body.classList.remove('theme-anim'), 600);
    }
    writeVars(vars);

    // effects -> body classes
    const eff = state.effects;
    document.body.classList.toggle('fx-frames', eff.frames);
    document.body.classList.toggle('fx-decor', eff.seasonalTheme && !!theme.cardDecor);
    document.body.setAttribute('data-decor', (eff.seasonalTheme && theme.cardDecor) ? theme.cardDecor : '');
    // avatar frame: explicit user choice wins, else theme's frame
    const frame = (state.frame && state.frame !== 'none') ? state.frame : (eff.frames ? (theme.frame || 'none') : 'none');
    document.body.setAttribute('data-frame', frame);

    // lighting
    stopRgb();
    let mode = state.lighting.mode;
    if (state.effects.rgb && mode === 'static') mode = 'rgb';
    if (!state.effects.rgb) mode = 'static';
    if (mode === 'seasonal') { const s = getActiveSeasonal(); mode = s ? 'aurora' : 'static'; }
    if (mode !== 'static') startRgb(mode);

    // background
    initBackground();

    if (!opts.preview) { state.themeId = theme.id; saveConfig(); }
    updatePanelActive();
  }

  // ---------- persistence ----------
  function saveConfig() {
    try { if (window.api && window.api.updateSettings) window.api.updateSettings({ themeState: state }); } catch (_) {}
  }

  // ---------- public init ----------
  function init(settings) {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (settings && settings.themeState) {
      try { state = Object.assign(JSON.parse(JSON.stringify(defaultState)), settings.themeState); } catch (_) {}
    }
    // seasonal auto-activation
    let theme = findTheme(state.themeId);
    if (state.seasonal.auto && state.effects.seasonalTheme) {
      const early = state.seasonal.earlyId ? findTheme(state.seasonal.earlyId) : null;
      const active = getActiveSeasonal();
      if (early && state.seasonal.allowEarly) theme = early;
      else if (active && state.seasonal.autoSwitch) theme = active;
    }
    applyTheme(theme, { silent: true });
    renderPanel();
    // live countdown refresh
    setInterval(() => { const el = document.getElementById('season-countdown'); if (el && el.dataset.start) el.textContent = fmtCountdown(daysUntil(el.dataset.start)); }, 60000);
  }

  // ---------- Themes panel UI ----------
  function swatch(hex) { return `<span class="tw-sw" style="background:${hex}"></span>`; }
  function themeCard(t) {
    const c = t.colors;
    return `<button class="theme-card ${t.id === state.themeId ? 'active' : ''}" data-theme="${t.id}" title="${t.name}">
      <span class="theme-card-preview" style="background:linear-gradient(135deg, ${c.bg}, ${c.panel})">
        ${swatch(c.accent)}${swatch(c.accent2 || lighten(c.accent, 0.3))}${swatch(c.text)}
      </span>
      <span class="theme-card-name">${t.icon || ''} ${t.name}</span>
    </button>`;
  }
  function toggleRow(id, label, on) {
    return `<label class="switch-row"><div class="switch-info"><strong>${label}</strong></div>
      <input type="checkbox" data-fx="${id}" ${on ? 'checked' : ''}/><span class="switch"></span></label>`;
  }
  function renderPanel() {
    const host = document.getElementById('themes-panel');
    if (!host) return;
    const seasonList = seasonalThemes().map(t => {
      const active = getActiveSeasonal();
      const isActive = active && active.id === t.id;
      const ms = daysUntil(t.calendar.start);
      const early = state.seasonal.earlyId === t.id;
      return `<div class="season-item">
        <div class="season-head"><span>${t.icon} ${t.name}</span>
          ${isActive ? '<span class="season-badge live">Active now</span>' : `<span class="season-badge">Starts ${t.calendar.start}</span>`}</div>
        <div class="season-actions">
          <button class="btn ghost small" data-preview="${t.id}">Preview</button>
          <button class="btn ghost small" data-apply="${t.id}">Apply</button>
          ${!isActive ? `<button class="btn ${early ? 'primary' : 'ghost'} small" data-early="${t.id}">${early ? 'Early access on' : 'Activate early'}</button>` : ''}
        </div>
        ${(!isActive && early) ? `<div class="season-early">Early Access · <span id="season-countdown" data-start="${t.calendar.start}">${fmtCountdown(ms)}</span></div>` : ''}
      </div>`;
    }).join('');

    const lib = (state.custom || []).map(t => `<div class="lib-item">
      <span class="lib-name">${t.icon || '🎨'} ${t.name}</span>
      <span class="lib-actions">
        <button class="btn ghost small" data-apply="${t.id}">Apply</button>
        <button class="btn ghost small" data-edit="${t.id}">Edit</button>
        <button class="btn ghost small" data-dup="${t.id}">Duplicate</button>
        <button class="btn ghost small" data-export="${t.id}">Export</button>
        <button class="btn ghost danger small" data-del="${t.id}">Delete</button>
      </span></div>`).join('') || '<p class="settings-desc">No custom themes yet. Create one below.</p>';

    host.innerHTML = `
      <div class="settings-header"><h2>Themes &amp; Customization</h2><p>Give the app a living seasonal identity — or a completely custom look. Preview never changes your saved theme until you Apply.</p></div>

      <div class="theme-section"><h3>Built-in themes</h3><div class="theme-grid">${BUILTIN.map(themeCard).join('')}</div></div>

      <div class="theme-section"><h3>Seasonal</h3>
        <label class="switch-row"><div class="switch-info"><strong>Automatic seasonal themes</strong><span>Switch automatically around each holiday.</span></div>
          <input type="checkbox" data-season="auto" ${state.seasonal.auto ? 'checked' : ''}/><span class="switch"></span></label>
        <label class="switch-row"><div class="switch-info"><strong>Allow early activation</strong></div>
          <input type="checkbox" data-season="allowEarly" ${state.seasonal.allowEarly ? 'checked' : ''}/><span class="switch"></span></label>
        <label class="switch-row"><div class="switch-info"><strong>Return to previous theme after season</strong></div>
          <input type="checkbox" data-season="returnAfter" ${state.seasonal.returnAfter ? 'checked' : ''}/><span class="switch"></span></label>
        <label class="switch-row"><div class="switch-info"><strong>Show countdown</strong></div>
          <input type="checkbox" data-season="countdown" ${state.seasonal.countdown ? 'checked' : ''}/><span class="switch"></span></label>
        <div class="season-list">${seasonList}</div>
      </div>

      <div class="theme-section"><h3>Lighting / RGB</h3>
        <div class="select-wrapper"><select id="lighting-mode">${LIGHTING_MODES.map(m => `<option value="${m}" ${state.lighting.mode === m ? 'selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select></div>
        ${['speed', 'brightness', 'saturation', 'glow'].map(k => `<div class="slider-row"><label>${k[0].toUpperCase() + k.slice(1)}</label>
          <input type="range" min="1" max="100" value="${state.lighting[k]}" data-light="${k}"/></div>`).join('')}
        <p class="settings-desc">RGB stays subtle by design. Turn it on with the RGB toggle in Effects.</p>
      </div>

      <div class="theme-section"><h3>Avatar frames</h3>
        <div class="frame-grid">${FRAMES.map(f => `<button class="frame-chip ${state.frame === f ? 'active' : ''}" data-frame="${f}">${f}</button>`).join('')}</div>
      </div>

      <div class="theme-section"><h3>Animated background</h3>
        <div class="select-wrapper"><select id="bg-type">${BACKGROUNDS.map(b => `<option value="${b}" ${state.background.type === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="select-wrapper"><select id="bg-perf">${PERF.map(p => `<option value="${p}" ${state.background.perf === p ? 'selected' : ''}>Performance: ${p}</option>`).join('')}</select></div>
      </div>

      <div class="theme-section"><h3>Effects</h3>
        ${toggleRow('seasonalTheme', 'Seasonal theme', state.effects.seasonalTheme)}
        ${toggleRow('seasonalBackground', 'Seasonal background', state.effects.seasonalBackground)}
        ${toggleRow('frames', 'Profile frames', state.effects.frames)}
        ${toggleRow('particles', 'Particles', state.effects.particles)}
        ${toggleRow('snowfall', 'Snowfall', state.effects.snowfall)}
        ${toggleRow('animatedLights', 'Animated lights', state.effects.animatedLights)}
        ${toggleRow('rgb', 'RGB', state.effects.rgb)}
        ${toggleRow('sounds', 'Sounds', state.effects.sounds)}
      </div>

      <div class="theme-section"><h3>My Themes</h3>
        <div class="lib-list">${lib}</div>
        <div class="settings-actions">
          <button class="btn primary" id="theme-create-btn">+ Create Custom Theme</button>
          <button class="btn ghost" id="theme-import-btn">Import Theme</button>
        </div>
      </div>`;

    bindPanel(host);
  }

  function updatePanelActive() {
    document.querySelectorAll('.theme-card').forEach(el => el.classList.toggle('active', el.dataset.theme === state.themeId));
  }

  function bindPanel(host) {
    host.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { applyTheme(findTheme(b.dataset.theme)); });
    host.querySelectorAll('[data-preview]').forEach(b => b.onclick = () => previewTheme(findTheme(b.dataset.preview)));
    host.querySelectorAll('[data-apply]').forEach(b => b.onclick = () => { applyTheme(findTheme(b.dataset.apply)); });
    host.querySelectorAll('[data-early]').forEach(b => b.onclick = () => {
      state.seasonal.earlyId = (state.seasonal.earlyId === b.dataset.early) ? null : b.dataset.early;
      if (state.seasonal.earlyId) applyTheme(findTheme(state.seasonal.earlyId)); else saveConfig();
      renderPanel();
    });
    host.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(findTheme(b.dataset.edit)));
    host.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => duplicateTheme(b.dataset.dup));
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { state.custom = state.custom.filter(t => t.id !== b.dataset.del); saveConfig(); renderPanel(); });
    host.querySelectorAll('[data-export]').forEach(b => b.onclick = () => exportTheme(b.dataset.export));
    host.querySelectorAll('[data-fx]').forEach(c => c.onchange = () => { state.effects[c.dataset.fx] = c.checked; saveConfig(); applyTheme(findTheme(state.themeId)); });
    host.querySelectorAll('[data-season]').forEach(c => c.onchange = () => { state.seasonal[c.dataset.season] = c.checked; saveConfig(); });
    host.querySelectorAll('[data-light]').forEach(r => r.oninput = () => { state.lighting[r.dataset.light] = Number(r.value); saveConfig(); if (state.effects.rgb) applyTheme(findTheme(state.themeId)); });
    host.querySelectorAll('[data-frame]').forEach(b => b.onclick = () => { state.frame = b.dataset.frame; saveConfig(); document.body.setAttribute('data-frame', b.dataset.frame === 'none' ? '' : b.dataset.frame); host.querySelectorAll('[data-frame]').forEach(x => x.classList.toggle('active', x === b)); });
    const lm = host.querySelector('#lighting-mode'); if (lm) lm.onchange = () => { state.lighting.mode = lm.value; if (lm.value !== 'static') state.effects.rgb = true; saveConfig(); applyTheme(findTheme(state.themeId)); };
    const bt = host.querySelector('#bg-type'); if (bt) bt.onchange = () => { state.background.type = bt.value; saveConfig(); initBackground(); };
    const bp = host.querySelector('#bg-perf'); if (bp) bp.onchange = () => { state.background.perf = bp.value; saveConfig(); initBackground(); };
    const cb = host.querySelector('#theme-create-btn'); if (cb) cb.onclick = () => openEditor(null);
    const ib = host.querySelector('#theme-import-btn'); if (ib) ib.onclick = () => importTheme();
  }

  // preview: apply without saving, then auto-revert unless applied
  function previewTheme(theme) {
    if (!previewBackup) previewBackup = state.themeId;
    applyTheme(theme, { preview: true });
    if (window.__ramToast) window.__ramToast(`Previewing ${theme.name}. Click Apply to keep it.`, 'info');
    clearTimeout(previewTheme._t);
    previewTheme._t = setTimeout(() => { if (previewBackup) { applyTheme(findTheme(previewBackup), { preview: true }); previewBackup = null; } }, 6000);
  }

  // ---------- custom theme editor ----------
  function duplicateTheme(id) {
    const src = findTheme(id);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'custom_' + Date.now(); copy.kind = 'custom'; copy.seasonal = false; copy.calendar = null; copy.name = src.name + ' Copy';
    state.custom.push(copy); saveConfig(); renderPanel();
  }
  function exportTheme(id) {
    const t = findTheme(id);
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${t.name.replace(/\s+/g, '-')}.ramtheme.json`; a.click();
  }
  function importTheme() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { const t = JSON.parse(rd.result); if (!t.colors) throw 0; t.id = 'custom_' + Date.now(); t.kind = 'custom'; t.seasonal = false; state.custom.push(t); saveConfig(); renderPanel(); if (window.__ramToast) window.__ramToast('Theme imported.', 'success'); }
        catch (_) { if (window.__ramToast) window.__ramToast('That file is not a valid theme.', 'error'); }
      };
      rd.readAsText(f);
    };
    inp.click();
  }
  const EDIT_FIELDS = [
    ['bg', 'Background'], ['panel', 'Sidebar / panel'], ['card', 'Card'], ['border', 'Border'],
    ['text', 'Text'], ['dim', 'Secondary text'], ['accent', 'Accent'], ['accent2', 'Accent 2'], ['accentLight', 'Accent light']
  ];
  function openEditor(theme) {
    const editing = theme && theme.kind === 'custom';
    const base = theme ? JSON.parse(JSON.stringify(theme)) : { id: 'custom_' + Date.now(), kind: 'custom', name: 'My Theme', icon: '🎨', colors: JSON.parse(JSON.stringify(findTheme(state.themeId).colors)), bgType: 'gradient', frame: 'none' };
    if (!editing && theme) { base.id = 'custom_' + Date.now(); base.kind = 'custom'; base.name = theme.name + ' Custom'; base.seasonal = false; base.calendar = null; }
    let overlay = document.getElementById('theme-editor-overlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'theme-editor-overlay'; overlay.className = 'modal-overlay'; document.body.appendChild(overlay); }
    overlay.hidden = false;
    overlay.innerHTML = `<div class="modal glass-modal theme-editor">
      <div class="modal-header"><div><h2>${editing ? 'Edit' : 'Create'} Theme</h2><p class="modal-sub">Live preview updates as you edit. Nothing is saved until you press Save.</p></div>
        <button class="btn ghost small" id="te-close">Close</button></div>
      <div class="te-body">
        <div class="te-fields">
          <label class="field-label">Name</label><input class="text-input" id="te-name" value="${base.name}"/>
          <label class="field-label">Icon (emoji)</label><input class="text-input" id="te-icon" value="${base.icon || ''}" maxlength="4"/>
          ${EDIT_FIELDS.map(([k, lbl]) => `<div class="te-color"><label>${lbl}</label>
            <input type="color" data-c="${k}" value="${toHex(base.colors[k] || '#888888')}"/>
            <input type="text" class="text-input te-hex" data-h="${k}" value="${base.colors[k] || ''}"/></div>`).join('')}
          <label class="field-label">Glow intensity</label><input type="range" min="0" max="100" id="te-glow" value="${Math.round((base.colors.glow ?? 0.35) * 100)}"/>
          <label class="field-label">Background style</label>
          <div class="select-wrapper"><select id="te-bg">${BACKGROUNDS.filter(b => b !== 'seasonal').map(b => `<option value="${b}" ${base.bgType === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        </div>
        <div class="te-preview"><div class="te-preview-inner" id="te-preview">
          <div class="tep-side"></div>
          <div class="tep-main"><div class="tep-card"></div><div class="tep-card"></div><div class="tep-btn">Launch</div></div>
        </div></div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" id="te-reset">Reset</button>
        <button class="btn primary" id="te-save">Save Theme</button>
      </div></div>`;

    const draft = base;
    const applyPreview = () => { writePreviewInto(document.getElementById('te-preview'), draft.colors); };
    overlay.querySelectorAll('[data-c]').forEach(inp => inp.oninput = () => { draft.colors[inp.dataset.c] = inp.value; const hx = overlay.querySelector(`[data-h="${inp.dataset.c}"]`); if (hx) hx.value = inp.value; applyPreview(); });
    overlay.querySelectorAll('[data-h]').forEach(inp => inp.oninput = () => { draft.colors[inp.dataset.h] = inp.value; const cp = overlay.querySelector(`[data-c="${inp.dataset.h}"]`); if (cp && /^#?[0-9a-f]{6}$/i.test(inp.value)) cp.value = toHex(inp.value); applyPreview(); });
    overlay.querySelector('#te-glow').oninput = e => { draft.colors.glow = Number(e.target.value) / 100; applyPreview(); };
    overlay.querySelector('#te-bg').onchange = e => { draft.bgType = e.target.value; };
    overlay.querySelector('#te-name').oninput = e => draft.name = e.target.value;
    overlay.querySelector('#te-icon').oninput = e => draft.icon = e.target.value;
    overlay.querySelector('#te-close').onclick = () => { overlay.hidden = true; };
    overlay.querySelector('#te-reset').onclick = () => { openEditor(theme); };
    overlay.querySelector('#te-save').onclick = () => {
      draft.name = (draft.name || 'My Theme').trim();
      const i = state.custom.findIndex(t => t.id === draft.id);
      if (i >= 0) state.custom[i] = draft; else state.custom.push(draft);
      saveConfig(); overlay.hidden = true; renderPanel(); applyTheme(draft);
      if (window.__ramToast) window.__ramToast(`Saved "${draft.name}".`, 'success');
    };
    applyPreview();
  }
  function writePreviewInto(el, c) {
    if (!el) return;
    el.style.setProperty('--p-bg', c.bg); el.style.setProperty('--p-panel', c.panel); el.style.setProperty('--p-card', c.card);
    el.style.setProperty('--p-accent', c.accent); el.style.setProperty('--p-text', c.text); el.style.setProperty('--p-border', c.border || '#ffffff22');
  }
  function toHex(v) { if (/^#[0-9a-f]{6}$/i.test(v)) return v; if (/^#[0-9a-f]{3}$/i.test(v)) { const h = v.slice(1); return '#' + h.split('').map(x => x + x).join(''); } const m = String(v).match(/[0-9a-f]{6}/i); return m ? '#' + m[0] : '#888888'; }

  // ---------- expose ----------
  window.RAMTheme = { init, applyTheme, findTheme, renderPanel, openEditor, getActiveSeasonal };
})();
