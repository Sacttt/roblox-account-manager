'use strict';

/**
 * Stores Roblox session cookies encrypted with the OS credential protection
 * Electron exposes as safeStorage (DPAPI on Windows, scoped to the signed-in
 * Windows user). Secrets live in their own file so account metadata, backups
 * and exports never contain them.
 *
 * If OS encryption is unavailable, secrets are kept in memory for the session
 * only and are never written to disk in plaintext.
 */

const fs = require('fs');
const { readJSON, writeJSON } = require('./json-store');

const TEST_PREFIX = 'test-insecure:';

class Vault {
  constructor({ file, safeStorage, log, allowInsecureTestCodec = false }) {
    this.file = file;
    this.safeStorage = safeStorage;
    this.log = log;
    this.allowTestCodec = allowInsecureTestCodec;
    this.entries = {};      // id -> { enc, updatedAt }
    this.memoryOnly = {};   // id -> plaintext, used only when encryption is unavailable
  }

  get encryptionAvailable() {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return false;
      // On Linux without a keyring Electron falls back to a fixed key, which is not real protection.
      const backend = typeof this.safeStorage.getSelectedStorageBackend === 'function'
        ? this.safeStorage.getSelectedStorageBackend() : null;
      return backend !== 'basic_text';
    } catch (_) {
      return false;
    }
  }

  get persistent() {
    return this.encryptionAvailable || this.allowTestCodec;
  }

  load() {
    const { data, source } = readJSON(this.file, { version: 1, entries: {} });
    this.entries = data && typeof data.entries === 'object' && data.entries ? data.entries : {};
    if (source === 'backup') this.log.warn('secrets.json was unreadable; restored from backup');
  }

  save() {
    writeJSON(this.file, { version: 1, entries: this.entries }, { mode: 0o600 });
  }

  encrypt(plain) {
    if (this.encryptionAvailable) return this.safeStorage.encryptString(plain).toString('base64');
    if (this.allowTestCodec) return TEST_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
    return null;
  }

  decrypt(enc) {
    if (typeof enc !== 'string') return null;
    if (enc.startsWith(TEST_PREFIX)) {
      return this.allowTestCodec ? Buffer.from(enc.slice(TEST_PREFIX.length), 'base64').toString('utf8') : null;
    }
    if (!this.encryptionAvailable && !this.canTryDecrypt()) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch (_) {
      return null; // encrypted by a different Windows user or PC
    }
  }

  canTryDecrypt() {
    try { return this.safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
  }

  has(id) {
    if (this.memoryOnly[id]) return true;
    const entry = this.entries[id];
    if (!entry) return false;
    return this.decrypt(entry.enc) !== null;
  }

  get(id) {
    if (this.memoryOnly[id]) return this.memoryOnly[id];
    const entry = this.entries[id];
    return entry ? this.decrypt(entry.enc) : null;
  }

  set(id, plain) {
    const enc = this.encrypt(plain);
    if (enc) {
      this.entries[id] = { enc, updatedAt: Date.now() };
      delete this.memoryOnly[id];
      this.save();
      return { persisted: true };
    }
    this.memoryOnly[id] = plain;
    delete this.entries[id];
    this.save();
    this.log.warn('OS encryption unavailable; session kept in memory only');
    return { persisted: false };
  }

  /** Adopts a value already encrypted by safeStorage (legacy accounts.json). */
  adoptEncrypted(id, enc) {
    if (this.decrypt(enc) === null) return false;
    this.entries[id] = { enc, updatedAt: Date.now() };
    return true;
  }

  sanitizeBackup(removedIds) {
    if (!removedIds || !removedIds.length) return;
    const bakFile = `${this.file}.bak`;
    if (!fs.existsSync(bakFile)) return;
    try {
      const text = fs.readFileSync(bakFile, 'utf8');
      const data = JSON.parse(text);
      if (data && data.entries && typeof data.entries === 'object') {
        let changed = false;
        for (const id of removedIds) {
          if (data.entries[id]) {
            delete data.entries[id];
            changed = true;
          }
        }
        if (changed) {
          fs.writeFileSync(bakFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
        }
      }
    } catch (_) {
      try { fs.rmSync(bakFile, { force: true }); } catch (__) { /* ignore */ }
    }
  }

  remove(id) {
    const had = this.has(id);
    delete this.entries[id];
    delete this.memoryOnly[id];
    if (had) {
      this.save();
      this.sanitizeBackup([id]);
    }
    return had;
  }

  removeAll() {
    this.entries = {};
    this.memoryOnly = {};
    this.save();
    try { fs.rmSync(`${this.file}.bak`, { force: true }); } catch (_) { /* ignore */ }
  }

  /** Drops secrets whose account no longer exists. */
  prune(validIds) {
    const keep = new Set(validIds);
    let changed = false;
    const removed = [];
    for (const id of Object.keys(this.entries)) {
      if (!keep.has(id)) {
        delete this.entries[id];
        removed.push(id);
        changed = true;
      }
    }
    for (const id of Object.keys(this.memoryOnly)) if (!keep.has(id)) delete this.memoryOnly[id];
    if (changed) {
      this.save();
      this.sanitizeBackup(removed);
    }
  }

  status() {
    let backend = null;
    try { backend = this.safeStorage.getSelectedStorageBackend ? this.safeStorage.getSelectedStorageBackend() : null; } catch (_) { /* n/a */ }
    return {
      encryptionAvailable: this.encryptionAvailable,
      backend: process.platform === 'win32' ? 'dpapi' : backend,
      persistent: this.persistent,
      testCodec: !this.encryptionAvailable && this.allowTestCodec,
      storedCount: Object.keys(this.entries).length,
      memoryOnlyCount: Object.keys(this.memoryOnly).length,
    };
  }
}

module.exports = { Vault };
