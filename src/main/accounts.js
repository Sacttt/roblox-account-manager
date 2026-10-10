'use strict';

const fs = require('fs');
const { EventEmitter } = require('events');
const { readJSON, writeJSON, debouncedWriter } = require('./json-store');
const model = require('./accounts-model');
const { normalizeCookie } = require('./roblox/api');

const HOUR = 60 * 60 * 1000;

class AccountService extends EventEmitter {
  constructor({ paths, vault, api, avatars, activity, log, getSettings }) {
    super();
    this.paths = paths;
    this.vault = vault;
    this.api = api;
    this.avatars = avatars;
    this.activity = activity;
    this.log = log;
    this.getSettings = getSettings;
    this.accounts = [];
    this.loadNotes = [];
    this.pendingRefreshes = 0;
    this.refreshQueue = Promise.resolve();
    this.fullRefresh = null;
    this.lastRefreshResult = null;
    this.writer = debouncedWriter(() => this.persist(), 150);
  }

  // ---------------------------------------------------------------- loading
  load() {
    const { data, source, recoveredFrom } = readJSON(this.paths.accounts, { version: 2, accounts: [] });
    if (source === 'backup') this.loadNotes.push(`accounts.json was damaged and was restored from its backup${recoveredFrom ? ` (damaged copy kept as ${recoveredFrom})` : ''}.`);
    if (source === 'default' && recoveredFrom) this.loadNotes.push(`accounts.json was damaged and no backup existed. The damaged file was kept as ${recoveredFrom}.`);

    if (Array.isArray(data)) {
      this.migrateLegacy(data);
    } else {
      const list = data && Array.isArray(data.accounts) ? data.accounts : [];
      this.accounts = this.dedupe(list.map(model.normalizeAccount).filter(Boolean));
    }

    // Keep session state consistent with what the vault actually holds.
    for (const a of this.accounts) {
      const has = this.vault.has(a.id);
      if (has && a.session.status === 'none') a.session = { status: 'unknown', checkedAt: null };
      if (!has && a.session.status !== 'none') a.session = { status: 'none', checkedAt: null };
      a.hasCustomIcon = !!this.avatars.iconPath(a.id);
    }
    this.vault.prune(this.accounts.map((a) => a.id));
    this.log.info(`loaded ${this.accounts.length} account(s) from ${source}`);
  }

  dedupe(list) {
    const seenIds = new Set();
    const seenUsers = new Set();
    const out = [];
    for (const a of list) {
      if (seenUsers.has(a.userId)) continue;
      if (seenIds.has(a.id)) a.id = model.newId();
      seenIds.add(a.id);
      seenUsers.add(a.userId);
      out.push(a);
    }
    return out;
  }

  /** Pre-overhaul accounts.json was a bare array with inline (encrypted) cookies. */
  migrateLegacy(legacyList) {
    // Keep a copy of the old organisation data, minus anything sensitive.
    const sanitized = legacyList.map((a) => {
      if (!a || typeof a !== 'object') return a;
      const { roblosecurity, roblosecurityEnc, ...rest } = a;
      return rest;
    });
    const backupFile = `${this.paths.accounts.replace(/\.json$/, '')}.pre-v2-backup.json`;
    if (!fs.existsSync(backupFile)) {
      try {
        writeJSON(backupFile, sanitized, { backup: false });
      } catch (e) {
        this.log.warn('could not write pre-migration backup', e);
      }
    }

    const migrated = [];
    let lostSessions = 0;
    for (const old of legacyList) {
      const r = model.migrateLegacyAccount(old);
      if (!r) continue;
      const { account } = r;
      if (migrated.some((m) => m.userId === account.userId)) continue;
      if (r.encryptedSecret) {
        if (!this.vault.adoptEncrypted(account.id, r.encryptedSecret)) {
          account.session = { status: 'none', checkedAt: null };
          lostSessions++;
        }
      } else if (r.secret) {
        this.vault.set(account.id, r.secret);
      }
      if (r.customIconDataUrl) {
        try {
          this.avatars.setIcon(account.id, r.customIconDataUrl);
          account.hasCustomIcon = true;
        } catch (e) {
          this.log.warn(`custom icon for ${account.id} could not be migrated: ${e.message}`);
        }
      }
      migrated.push(account);
    }
    this.vault.save();
    this.accounts = migrated;
    this.persist({ backup: false });
    // The old file held encrypted cookies; never leave a copy of it behind.
    try { fs.rmSync(`${this.paths.accounts}.bak`, { force: true }); } catch (_) { /* ignore */ }

    this.log.info(`migrated ${migrated.length} legacy account(s)`);
    this.loadNotes.push(`Upgraded ${migrated.length} account(s) to the new storage format.`);
    if (lostSessions) {
      this.loadNotes.push(`${lostSessions} saved session(s) were encrypted by another Windows user or PC and could not be read. Sign in to those accounts again.`);
    }
  }

  // ---------------------------------------------------------------- persistence
  persist({ backup = true } = {}) {
    try {
      writeJSON(this.paths.accounts, { version: 2, accounts: this.accounts }, { backup });
    } catch (e) {
      this.log.error('failed to save accounts', e);
      if (this.listenerCount('error') > 0) {
        this.emit('error', 'SAVE_FAILED');
      }
      this.emit('save-error', 'SAVE_FAILED');
    }
  }

  save() { this.writer.schedule(); }

  flush() { this.writer.flush(); }

  // ---------------------------------------------------------------- reads
  get(id) {
    return this.accounts.find((a) => a.id === id) || null;
  }

  require(id) {
    const a = this.get(id);
    if (!a) throw new Error('NOT_FOUND');
    return a;
  }

  findByUserId(userId) {
    return this.accounts.find((a) => a.userId === userId) || null;
  }

  toPublic(a) {
    return model.toPublic(a, {
      avatarVersion: this.avatars.avatarVersion(a.userId),
      iconVersion: a.hasCustomIcon ? this.avatars.iconVersion(a.id) : 0,
    });
  }

  list() {
    return this.accounts.map((a) => this.toPublic(a));
  }

  emitChanged(accounts) {
    const list = (Array.isArray(accounts) ? accounts : [accounts]).filter(Boolean);
    if (list.length) this.emit('changed', list.map((a) => this.toPublic(a)));
  }

  getSecret(id) {
    return this.vault.get(id);
  }

  label(a) {
    return a.nickname ? `${a.nickname} (@${a.username})` : `@${a.username}`;
  }

  // ---------------------------------------------------------------- adding
  async previewCookie(rawCookie) {
    const cookie = normalizeCookie(rawCookie);
    const { userId, username, displayName } = await this.api.getAuthenticatedUser(cookie);
    const existing = this.findByUserId(userId);
    let avatarVersion = this.avatars.avatarVersion(userId);
    if (!avatarVersion) {
      try { await this.avatars.sync([userId]); avatarVersion = this.avatars.avatarVersion(userId); } catch (_) { /* preview without image */ }
    }
    // Only public profile fields go back to the UI — never the cookie.
    return { userId, username, displayName, avatarVersion, existingAccountId: existing ? existing.id : null };
  }

  /** Stores a cookie value Roblox handed back (rotation) or accepted in a repaired form. */
  updateSecret(id, cookie) {
    const a = this.get(id);
    if (!a || !cookie || this.vault.get(id) === cookie) return;
    this.vault.set(id, cookie);
    this.log.info(`stored refreshed sign-in for ${id}`);
  }

  /**
   * Adds an account from a session cookie. If the account already exists,
   * throws DUPLICATE unless updateExisting is set, in which case its saved
   * session is replaced.
   */
  async addFromCookie({ cookie: rawCookie, nickname = '', notes = '', group = '', tags = [], updateExisting = false, source = 'cookie' }) {
    const cookie = normalizeCookie(rawCookie);
    const user = await this.api.getAuthenticatedUser(cookie);
    const existing = this.findByUserId(user.userId);
    if (existing) {
      if (!updateExisting) {
        const err = new Error('DUPLICATE');
        err.accountId = existing.id;
        throw err;
      }
      const { persisted } = this.vault.set(existing.id, user.cookie);
      existing.username = user.username || existing.username;
      existing.displayName = user.displayName || existing.displayName;
      existing.session = { status: 'valid', checkedAt: Date.now() };
      existing.updatedAt = Date.now();
      this.save();
      this.emitChanged(existing);
      this.activity.add({ type: 'session.updated', level: 'success', accountId: existing.id, message: `Saved a new sign-in for ${this.label(existing)}` });
      return { account: this.toPublic(existing), isNew: false, persisted };
    }

    const now = Date.now();
    const account = model.normalizeAccount({
      id: model.newId(),
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      nickname, notes, group, tags,
      addedAt: now,
      updatedAt: now,
      session: { status: 'valid', checkedAt: now },
    });
    try {
      const detail = await this.api.getUser(user.userId);
      account.profile = { isBanned: detail.isBanned, created: detail.created, fetchedAt: Date.now(), notFound: false };
    } catch (e) {
      this.log.warn(`profile fetch failed for new account: ${e.code || e.message}`);
    }
    const { persisted } = this.vault.set(account.id, user.cookie);
    this.accounts.push(account);
    this.save();
    this.emitChanged(account);
    this.activity.add({
      type: 'account.added', level: 'success', accountId: account.id,
      message: `Added ${this.label(account)}${source === 'web' ? ' via Roblox sign-in' : ''}`,
    });
    this.refresh({ ids: [account.id] }).catch(() => {});
    return { account: this.toPublic(account), isNew: true, persisted };
  }

  // ---------------------------------------------------------------- sessions
  async setSession(id, rawCookie) {
    const a = this.require(id);
    const cookie = normalizeCookie(rawCookie);
    const user = await this.api.getAuthenticatedUser(cookie);
    if (user.userId !== a.userId) throw new Error('COOKIE_MISMATCH');
    const { persisted } = this.vault.set(a.id, user.cookie);
    a.session = { status: 'valid', checkedAt: Date.now() };
    a.updatedAt = Date.now();
    this.save();
    this.emitChanged(a);
    this.activity.add({ type: 'session.updated', level: 'success', accountId: a.id, message: `Updated the saved sign-in for ${this.label(a)}` });
    return { account: this.toPublic(a), persisted };
  }

  clearSession(id) {
    const a = this.require(id);
    this.vault.remove(a.id);
    a.session = { status: 'none', checkedAt: null };
    a.updatedAt = Date.now();
    this.save();
    this.emitChanged(a);
    this.activity.add({ type: 'session.cleared', accountId: a.id, message: `Removed the saved sign-in for ${this.label(a)}` });
    return this.toPublic(a);
  }

  clearAllSessions() {
    this.vault.removeAll();
    for (const a of this.accounts) a.session = { status: 'none', checkedAt: null };
    this.save();
    this.emitChanged(this.accounts);
    this.activity.add({ type: 'session.cleared', level: 'warning', message: 'Removed every saved sign-in' });
  }

  markSessionExpired(id) {
    const a = this.get(id);
    if (!a || a.session.status === 'expired') return;
    a.session = { status: 'expired', checkedAt: Date.now() };
    this.save();
    this.emitChanged(a);
    this.activity.add({ type: 'session.expired', level: 'warning', accountId: a.id, message: `Roblox rejected the saved sign-in for ${this.label(a)}` });
  }

  async verifySession(id) {
    const a = this.require(id);
    const cookie = this.vault.get(a.id);
    if (!cookie) {
      a.session = { status: 'none', checkedAt: null };
      this.emitChanged(a);
      return { status: 'none' };
    }
    try {
      const user = await this.api.getAuthenticatedUser(cookie);
      a.session = { status: user.userId === a.userId ? 'valid' : 'expired', checkedAt: Date.now() };
      if (user.userId === a.userId && user.cookie !== cookie) this.updateSecret(a.id, user.cookie);
    } catch (e) {
      if (e.code !== 'INVALID_COOKIE') {
        this.emitChanged(a);
        return { status: a.session.status, error: e.code || 'NETWORK_ERROR' };
      }
      a.session = { status: 'expired', checkedAt: Date.now() };
      this.activity.add({ type: 'session.expired', level: 'warning', accountId: a.id, message: `Saved sign-in for ${this.label(a)} has expired` });
    }
    this.save();
    this.emitChanged(a);
    return { status: a.session.status };
  }

  async verifyAllSessions() {
    const summary = { valid: 0, expired: 0, none: 0, failed: 0 };
    for (const a of this.accounts) {
      const r = await this.verifySession(a.id);
      if (r.error) summary.failed++;
      else summary[r.status] = (summary[r.status] || 0) + 1;
    }
    return summary;
  }

  // ---------------------------------------------------------------- organisation
  update(id, patch) {
    const a = this.require(id);
    const clean = model.sanitizePatch(patch);
    Object.assign(a, clean, { updatedAt: Date.now() });
    this.save();
    this.emitChanged(a);
    return this.toPublic(a);
  }

  /** Bulk organisation edits: favorite/pinned/group set, or add/remove a tag. */
  bulkUpdate(ids, op) {
    const targets = this.accounts.filter((a) => ids.includes(a.id));
    if (!op || typeof op !== 'object') throw new Error('INVALID_PATCH');
    for (const a of targets) {
      if ('favorite' in op) a.favorite = op.favorite === true;
      if ('pinned' in op) a.pinned = op.pinned === true;
      if ('group' in op) a.group = model.cleanText(String(op.group || ''), model.LIMITS.group);
      if (op.addTag) a.tags = model.cleanTags([...a.tags, op.addTag]);
      if (op.removeTag) a.tags = a.tags.filter((t) => t.toLowerCase() !== String(op.removeTag).toLowerCase());
      a.updatedAt = Date.now();
    }
    this.save();
    this.emitChanged(targets);
    return targets.length;
  }

  renameGroup(from, to) {
    const name = model.cleanText(String(to || ''), model.LIMITS.group);
    const targets = this.accounts.filter((a) => a.group === from);
    for (const a of targets) { a.group = name; a.updatedAt = Date.now(); }
    this.save();
    this.emitChanged(targets);
    return targets.length;
  }

  remove(ids) {
    const removing = this.accounts.filter((a) => ids.includes(a.id));
    if (!removing.length) return 0;
    this.accounts = this.accounts.filter((a) => !ids.includes(a.id));
    for (const a of removing) {
      this.vault.remove(a.id);
      this.avatars.removeIcon(a.id);
      if (!this.findByUserId(a.userId)) {
        try { fs.rmSync(this.avatars.avatarFile(a.userId), { force: true }); } catch (_) { /* ignore */ }
      }
    }
    this.save();
    this.emit('removed', removing.map((a) => a.id));
    this.activity.add({
      type: 'account.removed', level: 'warning',
      message: removing.length === 1 ? `Removed ${this.label(removing[0])} and its saved sign-in` : `Removed ${removing.length} accounts and their saved sign-ins`,
    });
    return removing.length;
  }

  setCustomIcon(id, dataUrl) {
    const a = this.require(id);
    this.avatars.setIcon(a.id, dataUrl);
    a.hasCustomIcon = true;
    a.updatedAt = Date.now();
    this.save();
    this.emitChanged(a);
    return this.toPublic(a);
  }

  clearCustomIcon(id) {
    const a = this.require(id);
    this.avatars.removeIcon(a.id);
    a.hasCustomIcon = false;
    this.save();
    this.emitChanged(a);
    return this.toPublic(a);
  }

  markLaunched(id) {
    const a = this.get(id);
    if (!a) return;
    a.lastLaunchedAt = Date.now();
    a.launchCount = (a.launchCount || 0) + 1;
    if (a.session.status !== 'valid') a.session = { status: 'valid', checkedAt: Date.now() };
    this.save();
    this.emitChanged(a);
  }

  // ---------------------------------------------------------------- refresh
  fallbackCookie() {
    for (const a of this.accounts) {
      if (a.session.status === 'valid') {
        const c = this.vault.get(a.id);
        if (c) return c;
      }
    }
    return null;
  }

  get isRefreshing() {
    return this.pendingRefreshes > 0;
  }

  /**
   * Refreshes names, ban status, presence and avatars using batched requests.
   * Runs are serialized; a full refresh requested while another full refresh
   * is queued or running shares that run instead of repeating the requests.
   */
  refresh(opts = {}) {
    const isFull = !opts.ids && !opts.presenceOnly;
    if (isFull && this.fullRefresh && (!opts.full || this.fullRefreshForced)) return this.fullRefresh;
    this.pendingRefreshes = (this.pendingRefreshes || 0) + 1;
    this.emit('refresh-state', { running: true });
    const run = (this.refreshQueue || Promise.resolve()).then(() => this.doRefresh(opts)).finally(() => {
      this.pendingRefreshes--;
      if (isFull && this.fullRefresh === run) {
        this.fullRefresh = null;
        this.fullRefreshForced = false;
      }
      if (!this.pendingRefreshes) this.emit('refresh-state', { running: false, at: Date.now() });
    });
    this.refreshQueue = run.catch(() => {});
    if (isFull) {
      this.fullRefresh = run;
      this.fullRefreshForced = !!opts.full;
    }
    return run;
  }

  async doRefresh({ ids = null, full = false, presenceOnly = false } = {}) {
    const targets = ids ? this.accounts.filter((a) => ids.includes(a.id)) : [...this.accounts];
    const result = { total: targets.length, errors: {}, at: Date.now() };
    if (!targets.length) return result;
    const userIds = [...new Set(targets.map((a) => a.userId))];
    const byUser = (userId) => targets.filter((a) => a.userId === userId);

    const step = async (name, fn) => {
      try { await fn(); } catch (e) { result.errors[name] = e.code || e.message || 'ERROR'; this.log.warn(`refresh ${name} failed: ${result.errors[name]}`); }
    };

    await step('presence', async () => {
      const presence = await this.api.getPresence(userIds, { fallbackCookie: this.fallbackCookie() });
      for (const [userId, p] of presence) for (const a of byUser(userId)) a.presence = p;
    });

    if (!presenceOnly) {
      await step('names', async () => {
        const users = await this.api.getUsersBatch(userIds);
        for (const [userId, u] of users) {
          for (const a of byUser(userId)) {
            if (u.username) a.username = u.username;
            if (u.displayName) a.displayName = u.displayName;
          }
        }
      });

      const maxAge = Math.max(1, this.getSettings().profileRefreshHours || 6) * HOUR;
      const stale = targets.filter((a) => full || ids || !a.profile.fetchedAt || Date.now() - a.profile.fetchedAt > maxAge);
      await step('profiles', async () => {
        let firstError = null;
        for (const a of stale) {
          try {
            const d = await this.api.getUser(a.userId);
            a.profile = { isBanned: d.isBanned, created: d.created, fetchedAt: Date.now(), notFound: false };
          } catch (e) {
            if (e.code === 'NOT_FOUND') {
              a.profile = { ...a.profile, fetchedAt: Date.now(), notFound: true };
              continue;
            }
            firstError = firstError || e;
            if (e.code === 'RATE_LIMITED') break;
          }
        }
        if (firstError) throw firstError;
      });

      await step('avatars', async () => {
        await this.avatars.sync(userIds, { force: full });
      });
    }

    const survivingTargets = targets.filter((a) => this.accounts.some((acc) => acc.id === a.id));
    this.save();
    if (survivingTargets.length) {
      this.emitChanged(survivingTargets);
    }
    result.ok = Object.keys(result.errors).length === 0;
    if (!ids) this.lastRefreshResult = result;
    return result;
  }

  // ---------------------------------------------------------------- import/export
  exportRecords() {
    // Records never contain secrets; those live only in the vault.
    return this.accounts.map((a) => ({
      userId: a.userId, username: a.username, displayName: a.displayName, nickname: a.nickname, notes: a.notes,
      group: a.group, tags: a.tags, favorite: a.favorite, pinned: a.pinned, addedAt: a.addedAt,
      lastLaunchedAt: a.lastLaunchedAt, launchCount: a.launchCount,
    }));
  }

  /**
   * Imports organisation records. New accounts are added without a session;
   * existing ones (same Roblox user) get their organisation fields merged
   * only when mergeExisting is set.
   */
  importRecords(records, { mergeExisting = false } = {}) {
    const summary = { added: 0, merged: 0, skipped: 0, invalid: 0 };
    const changed = [];
    for (const r of records) {
      const candidate = model.normalizeAccount({ ...r, id: model.newId(), session: { status: 'none' }, presence: null, profile: {} });
      if (!candidate) { summary.invalid++; continue; }
      const existing = this.findByUserId(candidate.userId);
      if (existing) {
        if (!mergeExisting) { summary.skipped++; continue; }
        for (const key of ['nickname', 'notes', 'group']) if (candidate[key]) existing[key] = candidate[key];
        existing.tags = model.cleanTags([...candidate.tags, ...existing.tags]);
        existing.favorite = existing.favorite || candidate.favorite;
        existing.pinned = existing.pinned || candidate.pinned;
        existing.updatedAt = Date.now();
        changed.push(existing);
        summary.merged++;
        continue;
      }
      this.accounts.push(candidate);
      changed.push(candidate);
      summary.added++;
    }
    this.save();
    this.emitChanged(changed);
    if (summary.added) this.refresh({ ids: changed.map((a) => a.id) }).catch(() => {});
    return summary;
  }
}

module.exports = { AccountService };
