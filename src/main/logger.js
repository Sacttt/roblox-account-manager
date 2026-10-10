'use strict';

const fs = require('fs');
const path = require('path');
const { redact } = require('./redact');

const MAX_BYTES = 1024 * 1024;
const KEEP_FILES = 3;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let logFile = null;
let minLevel = LEVELS.info;
let stream = null;
let written = 0;

function init(logDir, { level = 'info' } = {}) {
  minLevel = LEVELS[level] || LEVELS.info;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, 'main.log');
    written = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    openStream();
  } catch (_) {
    logFile = null;
  }
}

function openStream() {
  if (!logFile) return;
  stream = fs.createWriteStream(logFile, { flags: 'a' });
  stream.on('error', () => { stream = null; });
}

function rotate() {
  if (!logFile) return;
  try {
    if (stream) stream.end();
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? logFile : `${logFile}.${i - 1}`;
      const to = `${logFile}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
  } catch (_) { /* keep logging to the current file */ }
  written = 0;
  openStream();
}

function write(level, scope, args) {
  if (LEVELS[level] < minLevel) return;
  const msg = args.map((a) => (typeof a === 'string' ? a : redact(a))).join(' ');
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${redact(msg)}\n`;
  if (process.env.RAM_LOG_CONSOLE === '1' || !stream) {
    (level === 'error' ? console.error : console.log)(line.trimEnd());
  }
  if (stream) {
    stream.write(line);
    written += Buffer.byteLength(line);
    if (written > MAX_BYTES) rotate();
  }
}

function scoped(scope) {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
  };
}

function getLogFile() {
  return logFile;
}

function readTail(maxBytes = 64 * 1024) {
  if (!logFile || !fs.existsSync(logFile)) return '';
  const size = fs.statSync(logFile).size;
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(logFile, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return redact(buf.toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { init, scoped, getLogFile, readTail };
