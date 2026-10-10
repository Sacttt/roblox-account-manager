'use strict';

const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('./json-store');

const MAX_ICON_BYTES = 2 * 1024 * 1024;

function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/**
 * Public Roblox headshots are cached on disk (avatar-cache/<userId>.png) and
 * only re-downloaded when Roblox reports a different image URL. User-chosen
 * custom icons live in custom-icons/<accountId>.<ext>.
 */
class AvatarStore {
  constructor({ avatarDir, metaFile, iconDir, api, log }) {
    this.avatarDir = avatarDir;
    this.metaFile = metaFile;
    this.iconDir = iconDir;
    this.api = api;
    this.log = log;
    fs.mkdirSync(avatarDir, { recursive: true });
    fs.mkdirSync(iconDir, { recursive: true });
    const { data } = readJSON(metaFile, {});
    this.meta = data && typeof data === 'object' ? data : {};
  }

  avatarFile(userId) {
    return path.join(this.avatarDir, `${Number(userId)}.png`);
  }

  avatarVersion(userId) {
    try {
      const st = fs.statSync(this.avatarFile(userId));
      return st.size > 80 ? Math.floor(st.mtimeMs) : 0;
    } catch (_) {
      return 0;
    }
  }

  readAvatar(userId) {
    const file = this.avatarFile(userId);
    return fs.existsSync(file) ? { data: fs.readFileSync(file), mime: 'image/png' } : null;
  }

  /** Downloads headshots that are missing or changed. Returns userIds whose image changed. */
  async sync(userIds, { force = false } = {}) {
    const ids = [...new Set(userIds.filter((id) => Number.isSafeInteger(id)))];
    if (!ids.length) return [];
    const urls = await this.api.getHeadshotUrls(ids);
    const changed = [];
    for (const [userId, url] of urls) {
      const have = this.avatarVersion(userId) > 0;
      const prev = this.meta[userId] && this.meta[userId].url;
      if (!force && have && prev === url) continue;
      try {
        const buf = await this.api.downloadImage(url);
        if (sniffImageType(buf) !== 'png') continue;
        fs.writeFileSync(this.avatarFile(userId), buf);
        this.meta[userId] = { url, fetchedAt: Date.now() };
        changed.push(userId);
      } catch (e) {
        this.log.warn(`avatar download failed for ${userId}: ${e.code || e.message}`);
      }
    }
    if (changed.length) this.saveMeta();
    return changed;
  }

  saveMeta() {
    try { writeJSON(this.metaFile, this.meta, { backup: false }); } catch (e) { this.log.warn('avatar meta save failed', e); }
  }

  clearCache() {
    let removed = 0;
    for (const f of fs.readdirSync(this.avatarDir)) {
      try { fs.rmSync(path.join(this.avatarDir, f), { force: true }); removed++; } catch (_) { /* ignore */ }
    }
    this.meta = {};
    this.saveMeta();
    return removed;
  }

  cacheSize() {
    let total = 0;
    for (const dir of [this.avatarDir, this.iconDir]) {
      try {
        for (const f of fs.readdirSync(dir)) {
          try { total += fs.statSync(path.join(dir, f)).size; } catch (_) { /* ignore */ }
        }
      } catch (_) { /* ignore */ }
    }
    return total;
  }

  // ---- custom icons ----
  iconPath(accountId) {
    if (!/^[\w-]{3,64}$/.test(accountId)) return null;
    for (const ext of Object.keys(MIME)) {
      const file = path.join(this.iconDir, `${accountId}.${ext}`);
      if (fs.existsSync(file)) return { file, mime: MIME[ext] };
    }
    return null;
  }

  iconVersion(accountId) {
    const icon = this.iconPath(accountId);
    if (!icon) return 0;
    try { return Math.floor(fs.statSync(icon.file).mtimeMs); } catch (_) { return 0; }
  }

  readIcon(accountId) {
    const icon = this.iconPath(accountId);
    return icon ? { data: fs.readFileSync(icon.file), mime: icon.mime } : null;
  }

  /** Accepts raw bytes or a data: URL; validates the real file type. */
  setIcon(accountId, input) {
    if (!/^[\w-]{3,64}$/.test(accountId)) throw new Error('NOT_FOUND');
    let buf = input;
    if (typeof input === 'string') {
      const m = input.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!m) throw new Error('INVALID_IMAGE');
      buf = Buffer.from(m[1], 'base64');
    }
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || []);
    if (buf.length > MAX_ICON_BYTES) throw new Error('IMAGE_TOO_LARGE');
    const type = sniffImageType(buf);
    if (!type) throw new Error('INVALID_IMAGE');
    this.removeIcon(accountId);
    fs.writeFileSync(path.join(this.iconDir, `${accountId}.${type}`), buf);
  }

  removeIcon(accountId) {
    if (!/^[\w-]{3,64}$/.test(accountId)) return;
    for (const ext of Object.keys(MIME)) {
      try { fs.rmSync(path.join(this.iconDir, `${accountId}.${ext}`), { force: true }); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { AvatarStore, sniffImageType, MAX_ICON_BYTES };
