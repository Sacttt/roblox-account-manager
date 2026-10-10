'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { RobloxHttp } = require('../../src/main/roblox/http');
const { RobloxApi, WARNING_PREFIX } = require('../../src/main/roblox/api');
const { createMockRoblox, cookieFor } = require('../support/mock-roblox');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

async function withMock(fn) {
  const mock = createMockRoblox();
  const origin = await mock.listen();
  const client = new RobloxHttp({ log: silent, testOrigin: origin });
  try { await fn({ mock, origin, client, api: new RobloxApi(client) }); } finally { await mock.close(); }
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn(origin); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}

test('identifies a cookie and keeps the exact accepted value', () => withMock(async ({ api }) => {
  const user = await api.getAuthenticatedUser(cookieFor(1100002));
  assert.deepEqual({ ...user, cookie: undefined }, { userId: 1100002, username: 'NovaSprint', displayName: 'Nova', cookie: undefined });
  assert.equal(user.cookie, cookieFor(1100002));
}));

test('repairs cookies saved without the warning banner by older versions', () => withMock(async ({ api }) => {
  const stripped = cookieFor(1100001).slice(WARNING_PREFIX.length);
  const user = await api.getAuthenticatedUser(stripped);
  assert.equal(user.userId, 1100001);
  assert.equal(user.cookie, cookieFor(1100001));
  const t = await api.getAuthTicket(stripped);
  assert.equal(t.cookie, cookieFor(1100001));
}));

test('reports an invalid cookie distinctly', () => withMock(async ({ api, mock }) => {
  mock.state.validCookies.clear();
  await assert.rejects(api.getAuthenticatedUser(cookieFor(1100001)), { code: 'INVALID_COOKIE' });
  await assert.rejects(api.getAuthTicket(cookieFor(1100001)), { code: 'COOKIE_INVALID' });
}));

test('auth ticket performs the CSRF handshake with the right headers', () => withMock(async ({ api, mock }) => {
  const r = await api.getAuthTicket(cookieFor(1100003));
  assert.match(r.ticket, /^TESTTICKET1100003/);
  assert.equal(mock.state.tickets[0].referer, 'https://www.roblox.com/develop');
  assert.equal(mock.state.tickets[0].gameauth, 'true');
  const authCalls = mock.state.log.filter((l) => l.host === 'auth.roblox.com');
  assert.equal(authCalls.length, 2, 'one 403 + token, then the real request');
  await api.getAuthTicket(cookieFor(1100003));
  assert.equal(mock.state.log.filter((l) => l.host === 'auth.roblox.com').length, 3, 'token is cached for the next launch');
}));

test('batches presence and thumbnails and never invents offline status', () => withMock(async ({ api, mock }) => {
  mock.state.presence.set(1100001, { userPresenceType: 2, lastLocation: 'Some Game', placeId: 5 });
  const p = await api.getPresence([1100001, 1100002, 999]);
  assert.equal(p.get(1100001).type, 2);
  assert.equal(p.get(1100001).lastLocation, 'Some Game');
  assert.equal(p.get(1100002).type, 0);
  assert.equal(p.has(999), false, 'users Roblox did not report stay unknown');
  const thumbs = await api.getHeadshotUrls([1100001, 1100002]);
  assert.equal(thumbs.size, 2);
  assert.equal(mock.state.log.filter((l) => l.host === 'thumbnails.roblox.com').length, 1);
  assert.equal(mock.state.log.filter((l) => l.host === 'presence.roblox.com').length, 1);
}));

test('honours 429 Retry-After and shares the cooldown', () => withMock(async ({ api, mock }) => {
  mock.state.rateLimitNext = 1;
  mock.state.retryAfter = 1;
  const started = Date.now();
  const u = await api.getUser(1100004);
  assert.equal(u.username, 'QuietComet');
  assert.ok(Date.now() - started >= 900, 'waited for Retry-After');
}));

test('gives up with RATE_LIMITED when Roblox keeps refusing', () => withMock(async ({ api, mock }) => {
  mock.state.rateLimitNext = 10;
  mock.state.retryAfter = 0;
  await assert.rejects(api.getUser(1100004), { code: 'RATE_LIMITED' });
}));

test('maps 404 to NOT_FOUND and network failures to NETWORK_ERROR', () => withMock(async ({ api, mock }) => {
  await assert.rejects(api.getUser(424242), { code: 'NOT_FOUND' });
  mock.state.failHosts = new Set(['users.roblox.com']);
  await assert.rejects(api.getUser(1100001), { code: 'NETWORK_ERROR' });
}));

test('identical concurrent reads share one request', () => withMock(async ({ api, mock }) => {
  await Promise.all([api.getUser(1100005), api.getUser(1100005), api.getUser(1100005)]);
  assert.equal(mock.state.log.filter((l) => l.path === '/v1/users/1100005').length, 1);
}));

test('a trickling response hits the total deadline', () => withServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  const t = setInterval(() => res.write(' '), 100);
  req.on('close', () => clearInterval(t));
}, async (origin) => {
  const client = new RobloxHttp({ log: silent, testOrigin: origin });
  const started = Date.now();
  await assert.rejects(client.request({ host: 'x', path: '/', timeoutMs: 500, retries: 0 }), { code: 'TIMEOUT' });
  assert.ok(Date.now() - started < 2000);
}));

test('multi-byte UTF-8 split across chunks decodes correctly', () => withServer((req, res) => {
  const buf = Buffer.from(JSON.stringify({ name: '名前😀' }));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.write(buf.subarray(0, 12));
  setTimeout(() => res.end(buf.subarray(12)), 20);
}, async (origin) => {
  const client = new RobloxHttp({ log: silent, testOrigin: origin });
  assert.deepEqual(await client.json({ host: 'x', path: '/' }), { name: '名前😀' });
}));

test('captures a rotated session cookie from Set-Cookie', () => withServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': [`.ROBLOSECURITY=${'N'.repeat(60)}; domain=.roblox.com; path=/`] });
  res.end(JSON.stringify({ id: 5, name: 'a', displayName: 'a' }));
}, async (origin) => {
  const api = new RobloxApi(new RobloxHttp({ log: silent, testOrigin: origin }));
  const u = await api.getAuthenticatedUser('O'.repeat(60));
  assert.equal(u.cookie, 'N'.repeat(60));
}));

test('flags Roblox verification challenges instead of calling the cookie invalid', () => withServer((req, res) => {
  res.writeHead(403, { 'content-type': 'application/json', 'rblx-challenge-id': 'abc', 'rblx-challenge-type': 'captcha' });
  res.end('{}');
}, async (origin) => {
  const api = new RobloxApi(new RobloxHttp({ log: silent, testOrigin: origin }));
  await assert.rejects(api.getAuthenticatedUser('O'.repeat(60)), { code: 'CHALLENGE_REQUIRED' });
}));

test('image downloads are restricted to Roblox CDN hosts over https', async () => {
  const client = new RobloxHttp({ log: silent });
  await assert.rejects(client.getBuffer('http://tr.rbxcdn.com/x.png', { allowedHostSuffixes: ['rbxcdn.com'] }), { code: 'BAD_URL' });
  await assert.rejects(client.getBuffer('https://evil.example/x.png', { allowedHostSuffixes: ['rbxcdn.com'] }), { code: 'HOST_NOT_ALLOWED' });
  await assert.rejects(client.getBuffer('https://rbxcdn.com.evil.example/x.png', { allowedHostSuffixes: ['rbxcdn.com'] }), { code: 'HOST_NOT_ALLOWED' });
});
