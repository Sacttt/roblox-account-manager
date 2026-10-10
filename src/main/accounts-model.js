'use strict';

const crypto = require('crypto');

const LIMITS = { nickname: 60, notes: 4000, group: 40, tag: 24, tags: 12, username: 40, displayName: 60 };
const SESSION_STATUSES = ['none', 'valid', 'expired', 'unknown'];

function newId() {
  return `acc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // Strip control characters except newlines/tabs; trim to the limit.
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function cleanTags(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const t of v) {
    const tag = cleanText(String(t || ''), LIMITS.tag).replace(/\s+/g, ' ');
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

function toUserId(v) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function toTime(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
}

function normalizePresence(p) {
  if (!p || typeof p !== 'object') return null;
  const type = Number.isInteger(p.type) && p.type >= 0 && p.type <= 3 ? p.type : null;
  const fetchedAt = toTime(p.fetchedAt);
  if (type === null || !fetchedAt) return null;
  return {
    type,
    lastLocation: cleanText(p.lastLocation || '', 120),
    placeId: toUserId(p.placeId),
    fetchedAt,
  };
}

/** Coerces a stored (current-format) account into a fully valid record, or null. */
function normalizeAccount(a) {
  if (!a || typeof a !== 'object') return null;
  const userId = toUserId(a.userId);
  const username = cleanText(a.username, LIMITS.username);
  if (!userId || !username) return null;
  const profile = a.profile && typeof a.profile === 'object' ? a.profile : {};
  const session = a.session && typeof a.session === 'object' ? a.session : {};
  return {
    id: typeof a.id === 'string' && /^[\w-]{3,64}$/.test(a.id) ? a.id : newId(),
    userId,
    username,
    displayName: cleanText(a.displayName, LIMITS.displayName) || username,
    nickname: cleanText(a.nickname, LIMITS.nickname),
    notes: cleanText(a.notes, LIMITS.notes),
    group: cleanText(a.group, LIMITS.group),
    tags: cleanTags(a.tags),
    favorite: a.favorite === true,
    pinned: a.pinned === true,
    addedAt: toTime(a.addedAt) || Date.now(),
    updatedAt: toTime(a.updatedAt) || Date.now(),
    lastLaunchedAt: toTime(a.lastLaunchedAt),
    launchCount: Number.isInteger(a.launchCount) && a.launchCount >= 0 ? a.launchCount : 0,
    profile: {
      isBanned: typeof profile.isBanned === 'boolean' ? profile.isBanned : null,
      created: typeof profile.created === 'string' ? profile.created.slice(0, 40) : null,
      fetchedAt: toTime(profile.fetchedAt),
    },
    presence: normalizePresence(a.presence),
    session: {
      status: SESSION_STATUSES.includes(session.status) ? session.status : 'none',
      checkedAt: toTime(session.checkedAt),
    },
    hasCustomIcon: a.hasCustomIcon === true,
  };
}

/**
 * Converts one pre-overhaul account (accounts.json was a bare array) into the
 * current shape. Secrets and inline custom icons are returned separately so
 * the caller can move them into the vault / icon folder.
 */
function migrateLegacyAccount(old) {
  if (!old || typeof old !== 'object') return null;
  const secret = typeof old.roblosecurity === 'string' && old.roblosecurity.length > 20 ? old.roblosecurity : null;
  const encryptedSecret = typeof old.roblosecurityEnc === 'string' ? old.roblosecurityEnc : null;
  const customIconDataUrl = typeof old.customAvatar === 'string' && old.customAvatar.startsWith('data:image/') ? old.customAvatar : null;
  const hasAnySecret = !!(secret || encryptedSecret);

  const account = normalizeAccount({
    id: old.id,
    userId: old.userId,
    username: old.username,
    displayName: old.displayName,
    nickname: old.nickname,
    notes: old.notes,
    group: old.group,
    tags: old.tags,
    favorite: !!old.favorite,
    pinned: !!old.pinned,
    addedAt: old.addedAt,
    updatedAt: old.updatedAt,
    lastLaunchedAt: old.lastLaunched,
    launchCount: old.lastLaunched ? 1 : 0,
    // Old builds wrote status:'active' even for imported, never-checked
    // accounts, so only a recorded ban is trusted; the rest is re-checked.
    profile: { isBanned: old.status === 'banned' ? true : null, created: null, fetchedAt: null },
    presence: null,
    session: { status: hasAnySecret ? (old.cookieExpired ? 'expired' : 'unknown') : 'none', checkedAt: null },
    hasCustomIcon: false,
  });
  if (!account) return null;
  return { account, secret, encryptedSecret, customIconDataUrl };
}

const EDITABLE = {
  nickname: (v) => cleanText(v, LIMITS.nickname),
  notes: (v) => cleanText(v, LIMITS.notes),
  group: (v) => cleanText(v, LIMITS.group),
  tags: (v) => cleanTags(v),
  favorite: (v) => v === true,
  pinned: (v) => v === true,
};

/** Validates a UI edit. Only organisation fields can be changed this way. */
function sanitizePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('INVALID_PATCH');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    const fn = EDITABLE[key];
    if (!fn) throw new Error(`FIELD_NOT_EDITABLE:${key}`);
    if ((key === 'favorite' || key === 'pinned') && typeof value !== 'boolean') throw new Error(`INVALID_FIELD:${key}`);
    if (key === 'tags' && !Array.isArray(value)) throw new Error('INVALID_FIELD:tags');
    if (['nickname', 'notes', 'group'].includes(key) && typeof value !== 'string') throw new Error(`INVALID_FIELD:${key}`);
    clean[key] = fn(value);
  }
  return clean;
}

/** What the renderer is allowed to see. Never includes secrets. */
function toPublic(a, { avatarVersion = 0, iconVersion = 0 } = {}) {
  return { ...a, avatarVersion, iconVersion };
}

module.exports = {
  LIMITS, SESSION_STATUSES, newId, normalizeAccount, migrateLegacyAccount, sanitizePatch, toPublic, cleanText, cleanTags, toUserId,
};
