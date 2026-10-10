'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { readJSON, writeJSON, debouncedWriter } = require('./json-store');
const { redact } = require('./redact');

const MAX_ENTRIES = 500;
const LEVELS = ['info', 'success', 'warning', 'error'];

/**
 * Local history of what the app did (accounts added, launches, imports...).
 * Entries are plain descriptions; they never contain cookies or tickets.
 */
class ActivityLog extends EventEmitter {
  constructor({ file, log }) {
    super();
    this.file = file;
    this.log = log;
    const { data } = readJSON(file, { version: 1, entries: [] });
    this.entries = Array.isArray(data && data.entries) ? data.entries.slice(-MAX_ENTRIES) : [];
    this.writer = debouncedWriter(() => this.persist(), 500);
  }

  add({ type, message, level = 'info', accountId = null, meta = null }) {
    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      ts: Date.now(),
      type: String(type || 'event').slice(0, 40),
      level: LEVELS.includes(level) ? level : 'info',
      message: redact(String(message || '')).slice(0, 300),
      accountId: accountId || null,
      meta: meta ? JSON.parse(redact(JSON.stringify(meta))) : null,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.writer.schedule();
    this.emit('entry', entry);
    return entry;
  }

  list({ limit = 200 } = {}) {
    return this.entries.slice(-limit).reverse();
  }

  clear() {
    this.entries = [];
    this.persist();
  }

  persist() {
    try { writeJSON(this.file, { version: 1, entries: this.entries }, { backup: false }); } catch (e) { this.log.warn('activity save failed', e); }
  }

  flush() {
    this.writer.flush();
  }
}

module.exports = { ActivityLog };
