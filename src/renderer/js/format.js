const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function timeAgo(ts, { short = false } = {}) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 45 * 1000) return 'just now';
  const m = Math.round(diff / 60000);
  if (m < 60) return short ? `${m}m ago` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return short ? `${h}h ago` : `${plural(h, 'hour')} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return short ? `${d}d ago` : `${plural(d, 'day')} ago`;
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function date(v) {
  if (!v) return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function bytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const displayName = (a) => a.nickname || a.displayName || a.username;

const STALE_MS = 20 * 60 * 1000;

/** Presence wording. Never claims a status Roblox did not report. */
export function presenceInfo(a) {
  const p = a.presence;
  if (!p) return { cls: 'unknown', text: 'Status unknown', title: 'Not checked yet — refresh to load live status', stale: false };
  const age = Date.now() - p.fetchedAt;
  const stale = age > STALE_MS;
  const asOf = `as of ${timeAgo(p.fetchedAt, { short: true })}`;
  const map = {
    0: ['offline', 'Offline'],
    1: ['online', 'Online'],
    2: ['ingame', p.lastLocation ? `Playing ${p.lastLocation}` : 'In game'],
    3: ['studio', 'In Roblox Studio'],
  };
  const [cls, text] = map[p.type] || ['unknown', 'Status unknown'];
  return { cls, text, title: `${text} — reported by Roblox ${asOf}`, stale, asOf };
}

export function isOnline(a) {
  return !!(a.presence && a.presence.type > 0 && Date.now() - a.presence.fetchedAt < STALE_MS);
}

export function sessionInfo(a) {
  const s = a.session || { status: 'none' };
  const checked = s.checkedAt ? `checked ${timeAgo(s.checkedAt)}` : 'not checked yet';
  switch (s.status) {
    case 'valid': return { status: 'valid', cls: 'green', label: 'Ready', icon: 'shieldCheck', title: `Saved sign-in works (${checked})` };
    case 'expired': return { status: 'expired', cls: 'red', label: 'Sign-in expired', icon: 'shieldOff', title: 'Roblox rejected the saved sign-in. Sign in again to launch.' };
    case 'unknown': return { status: 'unknown', cls: '', label: 'Saved', icon: 'shield', title: 'A sign-in is saved but has not been verified since the last restart' };
    default: return { status: 'none', cls: '', label: 'No sign-in', icon: 'key', title: 'No sign-in saved — add one to launch this account' };
  }
}

export function needsAttention(a) {
  return a.session.status === 'expired' || a.session.status === 'none' || a.profile.isBanned === true;
}

export function canLaunch(a) {
  return a.session.status !== 'none';
}

export function avatarUrl(a) {
  if (a.hasCustomIcon && a.iconVersion) return `app://ram/icon/${encodeURIComponent(a.id)}?v=${a.iconVersion}`;
  if (a.avatarVersion) return `app://ram/avatar/${a.userId}?v=${a.avatarVersion}`;
  return monogram(displayName(a));
}

const MONO_COLORS = ['#3b4252', '#3d3a52', '#2f4a4a', '#4a3a33', '#33424f', '#4a3346'];
export function monogram(name) {
  const letter = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = MONO_COLORS[hash % MONO_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${bg}"/><text x="32" y="41" font-size="27" fill="#e8eaf0" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-weight="600">${esc(letter)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MESSAGES = {
  GAME_REQUIRED: 'Pick a game first — enter a Place ID or paste a game link in the launch bar.',
  GAME_TARGET_INVALID: "That doesn't look like a Roblox game. Use a Place ID (numbers only) or a roblox.com/games/… link.",
  SHARE_LINK_UNSUPPORTED: 'Share links (roblox.com/share?code=…) can\'t be launched directly. Open the link in your browser, then copy the full address that contains "privateServerLinkCode".',
  NO_SESSION: 'No saved sign-in for this account. Open it and sign in again.',
  NO_ACCOUNTS: 'Select at least one account.',
  TOO_MANY_ACCOUNTS: 'You can launch up to 100 accounts at once.',
  RECENTLY_LAUNCHED: 'This account was launched moments ago.',
  LAUNCH_BUSY: 'A launch is already in progress. Wait for it to finish or cancel it.',
  ROBLOX_ALREADY_RUNNING: 'Roblox is already open. Multi Roblox has to start before the first Roblox window.',
  MULTI_ROBLOX_OFF: 'Turn on Multi Roblox (Settings → Launching) to open several accounts at once.',
  MULTI_ROBLOX_TIMEOUT: 'Multi Roblox could not start in time. Try again, or restart your PC if Roblox is stuck in the background.',
  MULTI_ROBLOX_MUTEX_FAILED: 'Multi Roblox could not take Roblox\'s single-window lock. Close Roblox completely and try again.',
  ROBLOX_NOT_INSTALLED: "Roblox doesn't seem to be installed. Install it from roblox.com/download, or choose another launcher in Settings.",
  LAUNCHER_NOT_FOUND: 'The selected launcher is not installed. Choose another one in Settings → Launching.',
  LAUNCHER_FAILED: 'The launcher could not be started. Check that it is installed correctly.',
  UNSUPPORTED_PLATFORM: 'Launching Roblox is only supported on Windows.',
  COOKIE_INVALID: 'Roblox rejected the saved sign-in. Sign in to this account again.',
  INVALID_COOKIE: 'Roblox did not accept that cookie. It may have expired — copy a fresh one or use "Sign in with Roblox".',
  INVALID_COOKIE_FORMAT: 'That is not a .ROBLOSECURITY cookie value. Paste only the cookie value.',
  COOKIE_MISMATCH: 'That cookie belongs to a different Roblox account.',
  DUPLICATE: 'This account is already in your list.',
  AUTH_TICKET_FAILED: 'Roblox did not issue a launch ticket. Wait a few seconds and try again.',
  AUTH_TICKET_DENIED: 'Roblox refused the launch ticket for this account. Sign in again, or check the account on roblox.com.',
  RATE_LIMITED: 'Roblox is limiting requests right now. Wait a minute and try again.',
  NETWORK_ERROR: "Couldn't reach Roblox. Check your internet connection.",
  TIMEOUT: 'Roblox took too long to respond. Try again.',
  BAD_RESPONSE: 'Roblox sent an unexpected response. Try again later.',
  UNAUTHORIZED: 'Roblox requires you to sign in again.',
  NOT_FOUND: 'That item no longer exists.',
  IMAGE_TOO_LARGE: 'That image is larger than 2 MB.',
  INVALID_IMAGE: 'Use a PNG, JPG, GIF or WebP image.',
  INVALID_BACKUP: "That file isn't a Roblox Account Manager backup.",
  BACKUP_TOO_LARGE: 'That backup file is too large.',
  IMPORT_EXPIRED: 'Choose the backup file again.',
  PRESET_INVALID: 'Give the preset a name and a valid game.',
  PRESET_LIMIT: 'You can save up to 60 games.',
  FORBIDDEN: 'That action was blocked for security reasons.',
  CANCELLED: 'Cancelled.',
  SAVE_FAILED: "Couldn't save your data to disk. Check free space and permissions.",
};

export function errorMessage(err) {
  const code = (err && (err.code || err.message)) || 'INTERNAL_ERROR';
  if (MESSAGES[code]) return MESSAGES[code];
  if (/^HTTP_5\d\d$/.test(code)) return 'Roblox is having problems right now. Try again later.';
  if (/^HTTP_\d+$/.test(code)) return `Roblox returned an error (${code.slice(5)}).`;
  if (/^MULTI_ROBLOX/.test(code)) return 'Multi Roblox could not start. Close Roblox and try again.';
  if (/^(UNKNOWN|INVALID)_SETTING/.test(code)) return 'That setting could not be saved.';
  return 'Something went wrong. Details are in Settings → Diagnostics.';
}
