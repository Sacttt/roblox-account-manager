'use strict';

const THEMES = ['midnight', 'amber', 'graphite', 'crimson', 'aurora', 'violet', 'arctic', 'light'];
const LAUNCHERS = ['auto', 'default', 'bloxstrap', 'fishstrap', 'client'];
const SORT_MODES = ['recent', 'name', 'username', 'added', 'status', 'group'];
const PRESENCE_INTERVALS = [0, 2, 5, 10, 15, 30, 60];
const PROFILE_INTERVALS = [0, 1, 6, 12, 24];

const isBool = (v) => typeof v === 'boolean';
const oneOf = (list) => (v) => list.includes(v);
const intIn = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const hexColor = (v) => v === '' || /^#[0-9a-f]{6}$/i.test(v);
const shortString = (max) => (v) => typeof v === 'string' && v.length <= max;

const SCHEMA = {
  // Launching
  multiRoblox: { default: true, valid: isBool },
  launcher: { default: 'auto', valid: oneOf(LAUNCHERS) },
  launchDelaySec: { default: 6, valid: intIn(2, 60) },
  lastGameTarget: { default: '', valid: shortString(500) },
  recentTargets: {
    default: [],
    valid: (v) => Array.isArray(v) && v.length <= 10 && v.every((t) => typeof t === 'string' && t.length <= 500),
  },
  // Background refresh
  presenceRefreshMinutes: { default: 5, valid: oneOf(PRESENCE_INTERVALS) },
  profileRefreshHours: { default: 6, valid: oneOf(PROFILE_INTERVALS) },
  // Appearance
  theme: { default: 'midnight', valid: oneOf(THEMES) },
  accentColor: { default: '', valid: hexColor },
  density: { default: 'comfortable', valid: oneOf(['comfortable', 'compact']) },
  reduceMotion: { default: false, valid: isBool },
  viewMode: { default: 'grid', valid: oneOf(['grid', 'list']) },
  sortMode: { default: 'recent', valid: oneOf(SORT_MODES) },
  // Behaviour
  closeToTray: { default: true, valid: isBool },
  launchAtStartup: { default: false, valid: isBool },
  startMinimized: { default: false, valid: isBool },
  notifications: { default: true, valid: isBool },
  globalHotkey: { default: '', valid: shortString(60) },
  onboardingDone: { default: false, valid: isBool },
};

function defaults() {
  const out = {};
  for (const [key, def] of Object.entries(SCHEMA)) out[key] = clone(def.default);
  return out;
}

/** Keeps only known keys with valid values; everything else falls back to defaults. */
function normalize(raw) {
  const out = defaults();
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, def] of Object.entries(SCHEMA)) {
    if (key in raw && def.valid(raw[key])) out[key] = clone(raw[key]);
  }
  return out;
}

/** Validates a renderer-supplied patch. Throws on unknown keys or bad values. */
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('INVALID_SETTINGS');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    const def = SCHEMA[key];
    if (!def) throw new Error(`UNKNOWN_SETTING:${key}`);
    if (!def.valid(value)) throw new Error(`INVALID_SETTING:${key}`);
    clean[key] = clone(value);
  }
  return clean;
}

// Old theme ids (theme.js) -> closest new palette.
const LEGACY_THEME_MAP = {
  gold: 'amber', golden: 'amber', midnight: 'midnight', cyber: 'violet', aurora: 'aurora',
  crimson: 'crimson', arctic: 'arctic', halloween: 'amber', christmas: 'crimson',
};

/** Converts a v1 settings.json (flat, pre-overhaul) into the current shape. */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaults();
  if (raw.schemaVersion === 2) return normalize(raw);

  const next = { ...raw };
  if (typeof raw.animations === 'boolean') next.reduceMotion = !raw.animations;
  if (typeof raw.avatarRefreshMinutes === 'number') {
    const m = raw.avatarRefreshMinutes;
    next.presenceRefreshMinutes = m <= 0 ? 0 : PRESENCE_INTERVALS.filter((x) => x > 0).reduce((best, x) => (Math.abs(x - m) < Math.abs(best - m) ? x : best), 5);
  }
  const legacyThemeId = raw.themeState && raw.themeState.themeId;
  if (legacyThemeId && LEGACY_THEME_MAP[legacyThemeId]) next.theme = LEGACY_THEME_MAP[legacyThemeId];
  if (typeof raw.launchDelaySec === 'number') next.launchDelaySec = Math.min(60, Math.max(2, Math.round(raw.launchDelaySec)));
  return normalize(next);
}

function toDisk(settings) {
  return { schemaVersion: 2, ...settings };
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

module.exports = {
  SCHEMA, THEMES, LAUNCHERS, SORT_MODES, PRESENCE_INTERVALS, PROFILE_INTERVALS,
  defaults, normalize, validatePatch, migrate, toDisk,
};
