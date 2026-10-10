// Theme palettes. Each sets the neutral tones; the accent can be overridden.
export const THEMES = {
  midnight: { name: 'Midnight', accent: '#f5b43c', bg0: '#0b0c10', bg1: '#101116', bg2: '#14161b', s1: '#1a1c22', s2: '#20232a', s3: '#282b33', text: '#eceef2', text2: '#a7acb8', text3: '#6e7482' },
  graphite: { name: 'Graphite', accent: '#7c9cff', bg0: '#0e0e0f', bg1: '#141415', bg2: '#18181a', s1: '#1e1e21', s2: '#252528', s3: '#2e2e32', text: '#ededee', text2: '#a8a8ae', text3: '#717178' },
  amber: { name: 'Amber', accent: '#f0b242', bg0: '#0d0b07', bg1: '#13100a', bg2: '#17140d', s1: '#1e1a12', s2: '#262117', s3: '#30291d', text: '#f6f0e4', text2: '#b9ae97', text3: '#7d735f' },
  crimson: { name: 'Crimson', accent: '#f43f5e', bg0: '#0e0809', bg1: '#140c0e', bg2: '#181012', s1: '#1f1518', s2: '#271a1e', s3: '#312126', text: '#f6eef0', text2: '#b9a2a7', text3: '#7e6a6f' },
  aurora: { name: 'Aurora', accent: '#34d399', bg0: '#070d0c', bg1: '#0c1312', bg2: '#0f1716', s1: '#141e1c', s2: '#1a2624', s3: '#22302d', text: '#e9f5f1', text2: '#9cb5ad', text3: '#677d76' },
  violet: { name: 'Violet', accent: '#a78bfa', bg0: '#0b0a10', bg1: '#110f17', bg2: '#15131c', s1: '#1b1824', s2: '#221e2d', s3: '#2b2638', text: '#efedf6', text2: '#aaa4bd', text3: '#726c85' },
  arctic: { name: 'Arctic', accent: '#38bdf8', bg0: '#080c10', bg1: '#0d1217', bg2: '#11171d', s1: '#161e26', s2: '#1c2630', s3: '#24303c', text: '#ebf3f9', text2: '#9fb0bf', text3: '#687987' },
  light: { name: 'Light', light: true, accent: '#c98a12', bg0: '#e9ebef', bg1: '#f3f4f6', bg2: '#f8f9fa', s1: '#ffffff', s2: '#f1f2f5', s3: '#e4e6eb', text: '#16181d', text2: '#4f5563', text3: '#808695' },
};

export const ACCENTS = ['#f5b43c', '#7c9cff', '#a78bfa', '#f472b6', '#f43f5e', '#fb923c', '#34d399', '#38bdf8'];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;

export function applyTheme(settings) {
  const theme = THEMES[settings.theme] || THEMES.midnight;
  const accent = settings.accentColor || theme.accent;
  const accentFg = luminance(accent) > 0.36 ? '#15110a' : '#ffffff';
  const root = document.documentElement.style;
  const vars = {
    '--bg-0': theme.bg0, '--bg-1': theme.bg1, '--bg-2': theme.bg2,
    '--surface': theme.s1, '--surface-2': theme.s2, '--surface-3': theme.s3,
    '--text': theme.text, '--text-2': theme.text2, '--text-3': theme.text3,
    '--accent': accent, '--accent-fg': accentFg,
    '--accent-soft': rgba(accent, theme.light ? 0.14 : 0.14),
    '--accent-ring': rgba(accent, 0.5),
    '--border': theme.light ? 'rgba(15, 18, 25, 0.09)' : 'rgba(255, 255, 255, 0.07)',
    '--border-strong': theme.light ? 'rgba(15, 18, 25, 0.16)' : 'rgba(255, 255, 255, 0.13)',
    '--overlay': theme.light ? 'rgba(20, 24, 32, 0.32)' : 'rgba(5, 6, 9, 0.62)',
    '--shadow': theme.light ? '0 8px 24px rgba(20, 24, 32, 0.10)' : '0 10px 30px rgba(0, 0, 0, 0.35)',
    '--shadow-lg': theme.light ? '0 20px 50px rgba(20, 24, 32, 0.16)' : '0 24px 60px rgba(0, 0, 0, 0.5)',
  };
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  document.documentElement.style.colorScheme = theme.light ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', !!theme.light);
  document.body.classList.toggle('density-compact', settings.density === 'compact');
  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
}
