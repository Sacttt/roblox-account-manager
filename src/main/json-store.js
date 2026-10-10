'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Reads a JSON file, falling back to its last-known-good ".bak" copy when the
 * main file is missing or corrupt. A corrupt file is moved aside (never
 * deleted) so nothing the user had is silently lost.
 * Returns { data, source: 'file' | 'backup' | 'default', recoveredFrom? }.
 */
function readJSON(file, fallback) {
  const primary = tryRead(file);
  if (primary.ok) return { data: primary.data, source: 'file' };

  let quarantined = null;
  if (primary.exists) quarantined = quarantine(file);

  const extra = quarantined ? { recoveredFrom: quarantined } : {};
  const backup = tryRead(`${file}.bak`);
  if (backup.ok) return { data: backup.data, source: 'backup', ...extra };

  return { data: clone(fallback), source: 'default', ...extra };
}

function tryRead(file) {
  if (!fs.existsSync(file)) return { ok: false, exists: false };
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return { ok: false, exists: true };
    return { ok: true, data: JSON.parse(text) };
  } catch (_) {
    return { ok: false, exists: true };
  }
}

function quarantine(file) {
  const target = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, target);
    return target;
  } catch (_) {
    return null;
  }
}

/**
 * Crash-safe write: write a temp file, flush it to disk, keep the previous
 * version as ".bak", then atomically rename into place.
 */
function writeJSON(file, data, { backup = true, mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (backup && fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); } catch (_) { /* best effort */ }
  }
  fs.renameSync(tmp, file);
}

function removeWithBackup(file) {
  for (const f of [file, `${file}.bak`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* ignore */ }
  }
}

/** Coalesces bursts of saves (e.g. a bulk edit) into one disk write. */
function debouncedWriter(fn, ms = 150) {
  let timer = null;
  let pending = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    pending = false;
    fn();
  };
  const schedule = () => {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, ms);
  };
  return { schedule, flush };
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

module.exports = { readJSON, writeJSON, removeWithBackup, debouncedWriter };
