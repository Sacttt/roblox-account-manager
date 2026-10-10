'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

class RobloxError extends Error {
  constructor(code, { status = null, retryAfterMs = null } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class Semaphore {
  constructor(max) { this.max = max; this.active = 0; this.queue = []; }
  async run(fn) {
    if (this.active >= this.max) await new Promise((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Small HTTP client for Roblox web APIs.
 * - every request has a timeout
 * - transient failures (network, 5xx, 429) retry with backoff, honouring Retry-After
 * - per-host concurrency is capped so bulk refreshes stay polite
 * - identical unauthenticated reads in flight are shared, not duplicated
 * - authenticated POSTs perform Roblox's X-CSRF-TOKEN handshake
 */
class RobloxHttp {
  constructor({ log, testOrigin = null, perHostConcurrency = 3 } = {}) {
    this.log = log;
    this.testOrigin = testOrigin;
    this.perHost = perHostConcurrency;
    this.semaphores = new Map();
    this.inflight = new Map();
    this.cooldownUntil = new Map(); // host -> epoch ms; shared by every caller after a 429
    this.csrfTokens = new Map(); // sha256(cookie) -> token
    this.stats = { requests: 0, failures: 0, rateLimited: 0, lastError: null, lastErrorAt: null };
  }

  async waitForCooldown(host) {
    const until = this.cooldownUntil.get(host) || 0;
    const wait = until - Date.now();
    if (wait > 0) await sleep(Math.min(wait, 30000));
  }

  semaphore(host) {
    if (!this.semaphores.has(host)) this.semaphores.set(host, new Semaphore(this.perHost));
    return this.semaphores.get(host);
  }

  buildUrl(host, path) {
    if (this.testOrigin) return new URL(`/${host}${path}`, this.testOrigin);
    return new URL(`https://${host}${path}`);
  }

  async request(opts) {
    const { host, path, method = 'GET', body, cookie, dedupe } = opts;
    const shareable = dedupe !== false && !cookie && (method === 'GET' || dedupe === true);
    if (!shareable) return this.requestWithRetry(opts);
    const key = `${method} ${host}${path} ${body ? JSON.stringify(body) : ''}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = this.requestWithRetry(opts).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async requestWithRetry(opts) {
    const { retries = 2, csrf = false, cookie } = opts;
    const cookieKey = cookie ? crypto.createHash('sha256').update(cookie).digest('hex') : null;
    let csrfToken = csrf && cookieKey ? this.csrfTokens.get(cookieKey) || null : null;
    let csrfRetried = false;
    let attempt = 0;

    for (;;) {
      let res;
      try {
        await this.waitForCooldown(opts.host);
        res = await this.semaphore(opts.host).run(() => this.once({ ...opts, csrfToken }));
      } catch (e) {
        if (attempt < retries && (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT')) {
          await sleep(backoff(attempt++));
          continue;
        }
        this.noteFailure(e.code);
        throw e;
      }

      // Roblox rejects the first authenticated POST with 403 + a fresh CSRF token.
      const freshToken = res.headers['x-csrf-token'];
      if (csrf && res.status === 403 && freshToken && !csrfRetried) {
        csrfToken = freshToken;
        csrfRetried = true;
        if (cookieKey) this.csrfTokens.set(cookieKey, freshToken);
        continue;
      }

      if (res.status === 429) {
        this.stats.rateLimited++;
        const retryAfterMs = parseRetryAfter(res.headers['retry-after']);
        const pause = Math.min(retryAfterMs ?? backoff(attempt + 1), 30000);
        this.cooldownUntil.set(opts.host, Math.max(this.cooldownUntil.get(opts.host) || 0, Date.now() + pause));
        if (attempt < Math.max(retries, 2) && pause <= 10000) {
          attempt++;
          continue;
        }
        this.noteFailure('RATE_LIMITED');
        throw new RobloxError('RATE_LIMITED', { status: 429, retryAfterMs });
      }

      if (res.status >= 500 && attempt < retries) {
        await sleep(backoff(attempt++));
        continue;
      }
      return res;
    }
  }

  once({ host, path, method = 'GET', headers = {}, body, cookie, csrfToken, timeoutMs = 12000, userAgent = BROWSER_UA }) {
    const url = this.buildUrl(host, path);
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const reqHeaders = { 'User-Agent': userAgent, Accept: 'application/json', ...headers };
    if (cookie) reqHeaders.Cookie = `.ROBLOSECURITY=${cookie}`;
    if (csrfToken) reqHeaders['X-CSRF-TOKEN'] = csrfToken;
    if (payload !== null) {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const lib = url.protocol === 'http:' ? http : https;
    this.stats.requests++;

    return new Promise((resolve, reject) => {
      let settled = false;
      let deadline = null;
      const done = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        fn(v);
      };
      const req = lib.request(url, { method, headers: reqHeaders }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY_BYTES) { req.destroy(); done(reject, new RobloxError('BAD_RESPONSE')); return; }
          chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          if (text && /json/i.test(res.headers['content-type'] || '')) {
            try { json = JSON.parse(text); } catch (_) { json = undefined; }
          }
          done(resolve, {
            status: res.statusCode,
            headers: res.headers,
            text,
            json,
            challenge: !!(res.headers['rblx-challenge-id'] || res.headers['rblx-challenge-type']),
            newCookie: cookie ? rotatedCookie(res.headers['set-cookie'], cookie) : null,
          });
        });
        res.on('error', () => done(reject, new RobloxError('NETWORK_ERROR')));
      });
      req.on('error', () => done(reject, new RobloxError('NETWORK_ERROR')));
      // A total deadline, not just an idle timeout, so a trickling response can't hang a launch.
      deadline = setTimeout(() => { req.destroy(); done(reject, new RobloxError('TIMEOUT')); }, timeoutMs);
      if (payload !== null) req.write(payload);
      req.end();
    });
  }

  /** Requests JSON and maps non-2xx statuses to error codes. */
  async json(opts) {
    const res = await this.request(opts);
    if (res.status === 401) throw new RobloxError('UNAUTHORIZED', { status: 401 });
    if (res.status === 404) throw new RobloxError('NOT_FOUND', { status: 404 });
    if (res.status < 200 || res.status >= 300) {
      this.noteFailure(`HTTP_${res.status}`);
      throw new RobloxError(`HTTP_${res.status}`, { status: res.status });
    }
    if (res.json === undefined) {
      this.noteFailure('BAD_RESPONSE');
      throw new RobloxError('BAD_RESPONSE', { status: res.status });
    }
    return res.json;
  }

  /** Downloads a binary asset (avatar image) from an allow-listed https host. */
  getBuffer(rawUrl, { allowedHostSuffixes, maxBytes = 2 * 1024 * 1024, redirects = 0, timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      let url;
      try { url = new URL(rawUrl); } catch (_) { reject(new RobloxError('BAD_URL')); return; }
      const isTestUrl = this.testOrigin && url.origin === new URL(this.testOrigin).origin;
      if (!isTestUrl) {
        if (url.protocol !== 'https:') { reject(new RobloxError('BAD_URL')); return; }
        if (!allowedHostSuffixes.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`))) {
          reject(new RobloxError('HOST_NOT_ALLOWED'));
          return;
        }
      }
      const lib = url.protocol === 'http:' ? http : https;
      let deadline = null;
      const fail = (code) => { clearTimeout(deadline); reject(new RobloxError(code)); };
      const req = lib.get(url, { headers: { 'User-Agent': BROWSER_UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          clearTimeout(deadline);
          if (redirects >= 3) { reject(new RobloxError('TOO_MANY_REDIRECTS')); return; }
          const next = new URL(res.headers.location, url).toString();
          this.getBuffer(next, { allowedHostSuffixes, maxBytes, redirects: redirects + 1, timeoutMs }).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); fail(`HTTP_${res.statusCode}`); return; }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) { req.destroy(); fail('TOO_LARGE'); return; }
          chunks.push(c);
        });
        res.on('end', () => { clearTimeout(deadline); resolve(Buffer.concat(chunks)); });
      });
      req.on('error', () => fail('NETWORK_ERROR'));
      deadline = setTimeout(() => { req.destroy(); fail('TIMEOUT'); }, timeoutMs);
    });
  }

  noteFailure(code) {
    this.stats.failures++;
    this.stats.lastError = code;
    this.stats.lastErrorAt = Date.now();
  }
}

/** Roblox can rotate the session cookie in a Set-Cookie header; return the new value if so. */
function rotatedCookie(setCookie, current) {
  const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  for (const c of list) {
    const m = /^\.ROBLOSECURITY=([^;]+)/i.exec(String(c).trim());
    if (m && m[1] && m[1] !== current && m[1].length >= 50 && /^[\x21-\x7E]+$/.test(m[1]) && !/[;,]/.test(m[1])) return m[1];
  }
  return null;
}

function backoff(attempt) {
  return Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function parseRetryAfter(v) {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(v);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

module.exports = { RobloxHttp, RobloxError, BROWSER_UA };
