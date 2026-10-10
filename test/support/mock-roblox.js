'use strict';

/**
 * A local stand-in for the Roblox web APIs the app uses, for automated tests
 * and screenshots. The app reaches it when RAM_TEST_ROBLOX_ORIGIN is set:
 * requests to https://<host><path> become <origin>/<host><path>.
 *
 * It is NOT a description of Roblox's real behaviour beyond what the app
 * relies on; it only mirrors the request/response shapes.
 */

const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

const WARNING = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_';

const DEFAULT_USERS = [
  { id: 1100001, name: 'BlockBuilder_77', displayName: 'Builder', created: '2019-04-12T10:00:00Z', color: [245, 180, 60] },
  { id: 1100002, name: 'NovaSprint', displayName: 'Nova', created: '2020-08-03T10:00:00Z', color: [124, 156, 255] },
  { id: 1100003, name: 'PixelHarbor', displayName: 'Harbor', created: '2018-01-21T10:00:00Z', color: [52, 211, 153] },
  { id: 1100004, name: 'QuietComet', displayName: 'Comet', created: '2021-11-30T10:00:00Z', color: [244, 114, 182] },
  { id: 1100005, name: 'MapleRunner', displayName: 'Maple', created: '2017-06-09T10:00:00Z', color: [251, 146, 60] },
  { id: 1100006, name: 'TidalForge', displayName: 'Tidal', created: '2022-02-14T10:00:00Z', color: [56, 189, 248] },
];

function cookieFor(userId) {
  return `${WARNING}TESTSESSION${userId}${crypto.createHash('sha256').update(String(userId)).digest('hex').toUpperCase()}`;
}

// Tiny PNG encoder for avatar images.
const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function avatarPng([r, g, b], size = 96) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size * 0.42;
      const head = dx * dx + dy * dy < (size * 0.24) ** 2;
      const body = y > size * 0.7 && Math.abs(dx) < size * 0.34;
      const shade = head || body ? 1 : 0.32;
      const o = 1 + x * 4;
      row[o] = Math.round(r * shade);
      row[o + 1] = Math.round(g * shade);
      row[o + 2] = Math.round(b * shade);
      row[o + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function createMockRoblox({ users = DEFAULT_USERS, avatarImages = new Map() } = {}) {
  const state = {
    users: new Map(users.map((u) => [u.id, { isBanned: false, ...u }])),
    validCookies: new Map(users.map((u) => [cookieFor(u.id), u.id])),
    presence: new Map(), // userId -> { userPresenceType, lastLocation, placeId }
    rateLimitNext: 0,
    retryAfter: 1,
    failHosts: new Set(),
    delayMs: 0,
    log: [],
    tickets: [],
  };

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch (_) { resolve({}); }
    });
  });

  const cookieUser = (req) => {
    const m = /\.ROBLOSECURITY=([^;]+)/.exec(req.headers.cookie || '');
    return m ? state.validCookies.get(m[1]) || null : null;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const [, host, ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    state.log.push({ method: req.method, host, path, at: Date.now(), hasCookie: !!req.headers.cookie });

    if (host === '__control') {
      const body = await readBody(req);
      if (path === '/state') return json(res, 200, { log: state.log, tickets: state.tickets });
      if (path === '/configure') {
        if (body.revoke) for (const id of body.revoke) for (const [c, uid] of state.validCookies) if (uid === id) state.validCookies.delete(c);
        if (body.presence) for (const [id, p] of Object.entries(body.presence)) state.presence.set(Number(id), p);
        if (typeof body.rateLimitNext === 'number') state.rateLimitNext = body.rateLimitNext;
        if (typeof body.retryAfter === 'number') state.retryAfter = body.retryAfter;
        if (body.failHosts) state.failHosts = new Set(body.failHosts);
        if (typeof body.delayMs === 'number') state.delayMs = body.delayMs;
        if (body.ban) for (const id of body.ban) state.users.get(id).isBanned = true;
        if (body.clearLog) state.log = [];
        return json(res, 200, { ok: true });
      }
      return json(res, 404, {});
    }

    if (url.pathname.startsWith('/img/')) {
      const id = Number(url.pathname.slice(5).replace('.png', ''));
      const u = state.users.get(id);
      if (!u) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(avatarImages.get(id) || avatarPng(u.color || [120, 120, 140]));
      return;
    }

    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.failHosts.has(host)) { req.socket.destroy(); return; }
    if (state.rateLimitNext > 0) {
      state.rateLimitNext--;
      return json(res, 429, { errors: [{ code: 0, message: 'Too many requests' }] }, { 'retry-after': String(state.retryAfter) });
    }

    const body = req.method === 'POST' ? await readBody(req) : null;

    if (host === 'users.roblox.com') {
      if (path === '/v1/users/authenticated') {
        const id = cookieUser(req);
        if (!id) return json(res, 401, { errors: [{ code: 0, message: 'Authorization has been denied for this request.' }] });
        const u = state.users.get(id);
        return json(res, 200, { id: u.id, name: u.name, displayName: u.displayName });
      }
      if (path === '/v1/users' && req.method === 'POST') {
        const data = (body.userIds || []).map((id) => state.users.get(id)).filter(Boolean)
          .map((u) => ({ id: u.id, name: u.name, displayName: u.displayName, hasVerifiedBadge: false }));
        return json(res, 200, { data });
      }
      const m = /^\/v1\/users\/(\d+)$/.exec(path);
      if (m) {
        const u = state.users.get(Number(m[1]));
        if (!u) return json(res, 404, { errors: [{ code: 3, message: 'The user id is invalid.' }] });
        return json(res, 200, { id: u.id, name: u.name, displayName: u.displayName, isBanned: u.isBanned, created: u.created, description: '' });
      }
    }

    if (host === 'presence.roblox.com' && path === '/v1/presence/users') {
      const userPresences = (body.userIds || []).filter((id) => state.users.has(id)).map((id) => {
        const p = state.presence.get(id) || { userPresenceType: 0, lastLocation: '', placeId: null };
        return { userId: id, userPresenceType: p.userPresenceType, lastLocation: p.lastLocation || '', placeId: p.placeId || null };
      });
      return json(res, 200, { userPresences });
    }

    if (host === 'thumbnails.roblox.com' && path === '/v1/users/avatar-headshot') {
      const ids = (url.searchParams.get('userIds') || '').split(',').map(Number).filter(Boolean);
      const origin = `http://${req.headers.host}`;
      return json(res, 200, { data: ids.filter((id) => state.users.has(id)).map((id) => ({ targetId: id, state: 'Completed', imageUrl: `${origin}/img/${id}.png`, version: 'TN1' })) });
    }

    if (host === 'auth.roblox.com' && path === '/v1/authentication-ticket/') {
      const id = cookieUser(req);
      if (!req.headers['x-csrf-token']) return json(res, 403, { errors: [{ code: 0, message: 'Token Validation Failed' }] }, { 'x-csrf-token': 'csrf-test-token' });
      if (!id) return json(res, 401, { errors: [{ code: 0, message: 'Authorization has been denied for this request.' }] });
      const ticket = `TESTTICKET${id}x${state.tickets.length}`;
      state.tickets.push({ userId: id, ticket, referer: req.headers.referer, gameauth: req.headers['rbx-for-gameauth'] });
      return json(res, 200, {}, { 'rbx-authentication-ticket': ticket });
    }

    json(res, 404, { errors: [{ code: 0, message: 'NotFound' }] });
  });

  return {
    state,
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
    },
    close() {
      return new Promise((resolve) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => resolve()); });
    },
  };
}

module.exports = { createMockRoblox, cookieFor, DEFAULT_USERS, WARNING, avatarPng };

if (require.main === module) {
  const mock = createMockRoblox();
  mock.listen(Number(process.argv[2]) || 4777).then((origin) => {
    console.log(`Mock Roblox API at ${origin}`);
    for (const u of DEFAULT_USERS) console.log(`  ${u.name}: ${cookieFor(u.id)}`);
  });
}
