'use strict';

const { RobloxError } = require('./http');

const USERS = 'users.roblox.com';
const PRESENCE = 'presence.roblox.com';
const THUMBS = 'thumbnails.roblox.com';
const AUTH = 'auth.roblox.com';

const IMAGE_HOSTS = ['rbxcdn.com', 'roblox.com'];

// Real .ROBLOSECURITY values start with this banner. Versions before 2.0
// stripped it when saving, so for those we retry with it put back.
const WARNING_PREFIX = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_';
const hasPrefix = (c) => /^_\|WARNING/i.test(c);

/**
 * Accepts what people actually paste: the raw value, "name=value", quotes,
 * trailing semicolons or whitespace. Returns the bare cookie value or throws.
 */
function normalizeCookie(input) {
  let v = String(input || '').trim();
  v = v.replace(/^["']|["']$/g, '').trim();
  v = v.replace(/^\.?ROBLOSECURITY\s*=\s*/i, '');
  v = v.replace(/;.*$/s, '').trim();
  if (v.length < 50 || v.length > 8192) throw new RobloxError('INVALID_COOKIE_FORMAT');
  // Printable ASCII only; no whitespace, ';' or ',' (prevents header injection).
  if (!/^[\x21-\x7E]+$/.test(v) || /[;,]/.test(v)) throw new RobloxError('INVALID_COOKIE_FORMAT');
  return v;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

class RobloxApi {
  constructor(httpClient) {
    this.http = httpClient;
  }

  /**
   * Who does this cookie belong to? Throws INVALID_COOKIE when Roblox rejects
   * it. Returns the cookie value Roblox accepted (it may have been rotated or
   * had its warning banner restored) so callers can store that one.
   */
  async getAuthenticatedUser(cookie) {
    const attempt = async (c) => {
      const res = await this.http.request({ host: USERS, path: '/v1/users/authenticated', cookie: c, retries: 1 });
      if (res.status === 401) return null;
      if (res.challenge) throw new RobloxError('CHALLENGE_REQUIRED', { status: res.status });
      if (res.status === 429) throw new RobloxError('RATE_LIMITED', { status: 429 });
      if (res.status !== 200) throw new RobloxError(`HTTP_${res.status}`, { status: res.status });
      const u = res.json;
      if (!u || !Number.isSafeInteger(u.id)) throw new RobloxError('BAD_RESPONSE');
      return { userId: u.id, username: String(u.name || ''), displayName: String(u.displayName || u.name || ''), cookie: res.newCookie || c };
    };
    let user = await attempt(cookie);
    if (!user && !hasPrefix(cookie)) user = await attempt(WARNING_PREFIX + cookie);
    if (!user) throw new RobloxError('INVALID_COOKIE', { status: 401 });
    return user;
  }

  async getUser(userId) {
    const u = await this.http.json({ host: USERS, path: `/v1/users/${Number(userId)}` });
    return {
      userId: u.id,
      username: String(u.name || ''),
      displayName: String(u.displayName || u.name || ''),
      isBanned: typeof u.isBanned === 'boolean' ? u.isBanned : null,
      created: typeof u.created === 'string' ? u.created : null,
    };
  }

  /** Names for many users at once (no ban status in this endpoint). */
  async getUsersBatch(userIds) {
    const out = new Map();
    for (const ids of chunk(userIds, 100)) {
      const res = await this.http.json({
        host: USERS, path: '/v1/users', method: 'POST', dedupe: true,
        body: { userIds: ids, excludeBannedUsers: false },
      });
      for (const u of (res && res.data) || []) {
        out.set(u.id, { userId: u.id, username: String(u.name || ''), displayName: String(u.displayName || u.name || '') });
      }
    }
    return out;
  }

  /**
   * Live presence for many users. Users missing from the response are left
   * out (unknown) rather than reported as offline.
   */
  async getPresence(userIds, { fallbackCookie = null } = {}) {
    const out = new Map();
    for (const ids of chunk(userIds, 50)) {
      let res;
      try {
        res = await this.http.json({ host: PRESENCE, path: '/v1/presence/users', method: 'POST', dedupe: true, body: { userIds: ids } });
      } catch (e) {
        if (!fallbackCookie || !['UNAUTHORIZED', 'HTTP_403'].includes(e.code)) throw e;
        res = await this.http.json({
          host: PRESENCE, path: '/v1/presence/users', method: 'POST', body: { userIds: ids }, cookie: fallbackCookie, csrf: true,
        });
      }
      const now = Date.now();
      for (const p of (res && res.userPresences) || []) {
        if (!Number.isSafeInteger(p.userId)) continue;
        const type = Number.isInteger(p.userPresenceType) && p.userPresenceType >= 0 && p.userPresenceType <= 4 ? p.userPresenceType : null;
        if (type === null) continue;
        out.set(p.userId, {
          type,
          lastLocation: typeof p.lastLocation === 'string' ? p.lastLocation : '',
          placeId: Number.isSafeInteger(p.placeId) ? p.placeId : null,
          fetchedAt: now,
        });
      }
    }
    return out;
  }

  /** Headshot image URLs. Entries still being rendered by Roblox ("Pending") are skipped. */
  async getHeadshotUrls(userIds) {
    const out = new Map();
    for (const ids of chunk(userIds, 100)) {
      const res = await this.http.json({
        host: THUMBS,
        path: `/v1/users/avatar-headshot?userIds=${ids.join(',')}&size=150x150&format=Png&isCircular=false`,
      });
      for (const t of (res && res.data) || []) {
        if (t && t.state === 'Completed' && typeof t.imageUrl === 'string') out.set(t.targetId, t.imageUrl);
      }
    }
    return out;
  }

  downloadImage(url) {
    return this.http.getBuffer(url, { allowedHostSuffixes: IMAGE_HOSTS });
  }

  /**
   * One-time sign-in ticket for the Roblox client — the same request
   * roblox.com's Play button makes. Needs the CSRF handshake.
   */
  async getAuthTicket(cookie) {
    const attempt = async (c) => {
      const res = await this.http.request({
        host: AUTH,
        path: '/v1/authentication-ticket/',
        method: 'POST',
        body: {},
        cookie: c,
        csrf: true,
        retries: 2,
        userAgent: 'Roblox/WinInet',
        headers: { Referer: 'https://www.roblox.com/develop', 'RBX-For-Gameauth': 'true' },
      });
      if (res.status === 401) return null;
      if (res.challenge) throw new RobloxError('CHALLENGE_REQUIRED', { status: res.status });
      const ticket = res.headers['rbx-authentication-ticket'];
      if (res.status === 200 && ticket) return { ticket: String(ticket), cookie: res.newCookie || c };
      if (res.status === 403) throw new RobloxError('AUTH_TICKET_DENIED', { status: 403 });
      throw new RobloxError('AUTH_TICKET_FAILED', { status: res.status });
    };
    let r = await attempt(cookie);
    if (!r && !hasPrefix(cookie)) r = await attempt(WARNING_PREFIX + cookie);
    if (!r) throw new RobloxError('COOKIE_INVALID', { status: 401 });
    return r;
  }

  /** Lightweight reachability probe used by Diagnostics. */
  async probe(host) {
    const paths = { [USERS]: '/v1/users/1', [THUMBS]: '/v1/users/avatar-headshot?userIds=1&size=48x48&format=Png&isCircular=false' };
    const started = Date.now();
    try {
      const res = await this.http.request({ host, path: paths[host] || '/', retries: 0, timeoutMs: 8000, dedupe: false });
      return { host, ok: res.status > 0 && res.status < 500, status: res.status, ms: Date.now() - started };
    } catch (e) {
      return { host, ok: false, error: e.code || 'NETWORK_ERROR', ms: Date.now() - started };
    }
  }
}

module.exports = { RobloxApi, normalizeCookie, WARNING_PREFIX, HOSTS: { USERS, PRESENCE, THUMBS, AUTH } };
