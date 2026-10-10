'use strict';

const FORMAT = 'roblox-account-manager-backup';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ACCOUNTS = 5000;
const SECRET_KEYS = /^(roblosecurity|roblosecurityenc|cookie|cookies|session|ticket|password|token)$/i;

/** A backup holds organisation data and preferences only — never sign-in cookies. */
function buildBackup({ appVersion, accounts, settings, presets }) {
  return {
    format: FORMAT,
    version: 2,
    appVersion,
    createdAt: new Date().toISOString(),
    containsSecrets: false,
    accounts,
    settings,
    presets,
  };
}

function containsSecretFields(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return false;
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k) && v) return true;
    if (typeof v === 'object' && containsSecretFields(v, depth + 1)) return true;
  }
  return false;
}

function fromLegacyRecord(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    nickname: r.nickname,
    notes: r.notes,
    group: r.group,
    tags: Array.isArray(r.tags) ? r.tags : [],
    favorite: r.favorite === true,
    pinned: r.pinned === true,
    addedAt: r.addedAt,
    lastLaunchedAt: r.lastLaunchedAt || r.lastLaunched || null,
    launchCount: r.launchCount,
  };
}

/**
 * Parses an import file: a v2 backup, or the old app's exported account array.
 * Returns { accounts, settings, presets, warnings } or throws INVALID_BACKUP.
 */
function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('INVALID_BACKUP');
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('BACKUP_TOO_LARGE');
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) { throw new Error('INVALID_BACKUP'); }

  const warnings = [];
  let accounts;
  let settings = null;
  let presets = null;

  if (Array.isArray(data)) {
    accounts = data;
  } else if (data && typeof data === 'object' && data.format === FORMAT) {
    if (!Array.isArray(data.accounts)) throw new Error('INVALID_BACKUP');
    accounts = data.accounts;
    settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : null;
    presets = Array.isArray(data.presets) ? data.presets : null;
  } else {
    throw new Error('INVALID_BACKUP');
  }

  if (accounts.length > MAX_ACCOUNTS) throw new Error('BACKUP_TOO_LARGE');
  if (accounts.some((a) => containsSecretFields(a))) {
    warnings.push('This file contains sign-in cookies. They were ignored — sessions are never imported. Keep that file private or delete it.');
  }
  const records = accounts.map(fromLegacyRecord).filter(Boolean);
  return { accounts: records, settings, presets, warnings };
}

module.exports = { buildBackup, parseBackup, FORMAT, containsSecretFields };
