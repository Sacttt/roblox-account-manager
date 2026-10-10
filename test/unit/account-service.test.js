'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dataPaths } = require('../../src/main/paths');
const { Vault } = require('../../src/main/vault');
const { RobloxHttp } = require('../../src/main/roblox/http');
const { RobloxApi } = require('../../src/main/roblox/api');
const { AvatarStore } = require('../../src/main/avatars');
const { ActivityLog } = require('../../src/main/activity');
const { AccountService } = require('../../src/main/accounts');
const settingsModel = require('../../src/main/settings');
const { createMockRoblox, cookieFor, avatarPng } = require('../support/mock-roblox');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).toString('hex')}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith('ENC:')) throw new Error('bad');
      return Buffer.from(t.slice(4), 'hex').toString();
    },
  };
}

async function setup({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ram-svc-')), mock } = {}) {
  const ownMock = !mock;
  mock = mock || createMockRoblox();
  const origin = ownMock ? await mock.listen() : mock.origin;
  mock.origin = origin;
  const paths = dataPaths(dir);
  const ss = fakeSafeStorage();
  const vault = new Vault({ file: paths.secrets, safeStorage: ss, log: silent });
  vault.load();
  const api = new RobloxApi(new RobloxHttp({ log: silent, testOrigin: origin }));
  const avatars = new AvatarStore({ avatarDir: paths.avatarDir, metaFile: paths.avatarMeta, iconDir: paths.customIconDir, api, log: silent });
  const activity = new ActivityLog({ file: paths.activity, log: silent });
  const svc = new AccountService({ paths, vault, api, avatars, activity, log: silent, getSettings: () => settingsModel.defaults() });
  svc.load();
  return { dir, paths, vault, api, avatars, activity, svc, mock, ss, close: () => (ownMock ? mock.close() : null) };
}

test('adds an account from a cookie, stores the secret only in the vault', async () => {
  const t = await setup();
  try {
    const r = await t.svc.addFromCookie({ cookie: cookieFor(1100001), nickname: 'Main', group: 'Mains', tags: ['vip'] });
    assert.equal(r.isNew, true);
    assert.equal(r.account.username, 'BlockBuilder_77');
    assert.equal(r.account.session.status, 'valid');
    assert.equal(r.account.profile.isBanned, false);
    assert.ok(!JSON.stringify(r.account).includes('TESTSESSION'), 'public account has no cookie');
    t.svc.flush();
    const onDisk = fs.readFileSync(t.paths.accounts, 'utf8');
    assert.ok(!onDisk.includes('TESTSESSION') && !onDisk.includes('WARNING'), 'accounts.json never holds the cookie');
    assert.equal(t.vault.get(r.account.id), cookieFor(1100001));
    assert.ok(!fs.readFileSync(t.paths.secrets, 'utf8').includes('TESTSESSION'), 'vault is encrypted');
  } finally { await t.close(); }
});

test('duplicate accounts are detected; updateExisting refreshes the session', async () => {
  const t = await setup();
  try {
    const first = await t.svc.addFromCookie({ cookie: cookieFor(1100002) });
    await assert.rejects(t.svc.addFromCookie({ cookie: cookieFor(1100002) }), (e) => e.message === 'DUPLICATE' && e.accountId === first.account.id);
    const again = await t.svc.addFromCookie({ cookie: cookieFor(1100002), updateExisting: true });
    assert.equal(again.isNew, false);
    assert.equal(t.svc.accounts.length, 1);
    const preview = await t.svc.previewCookie(cookieFor(1100002));
    assert.equal(preview.existingAccountId, first.account.id);
    assert.ok(!('cookie' in preview), 'preview never returns the cookie');
  } finally { await t.close(); }
});

test('setSession refuses a cookie for a different user', async () => {
  const t = await setup();
  try {
    const { account } = await t.svc.addFromCookie({ cookie: cookieFor(1100001) });
    await assert.rejects(t.svc.setSession(account.id, cookieFor(1100002)), /COOKIE_MISMATCH/);
  } finally { await t.close(); }
});

test('refresh fills presence and keeps last-known values when Roblox is unreachable', async () => {
  const t = await setup();
  try {
    const { account } = await t.svc.addFromCookie({ cookie: cookieFor(1100003) });
    t.mock.state.presence.set(1100003, { userPresenceType: 2, lastLocation: 'Obby', placeId: 1 });
    const r1 = await t.svc.refresh({});
    assert.equal(r1.ok, true);
    assert.equal(t.svc.get(account.id).presence.type, 2);
    assert.ok(t.svc.toPublic(t.svc.get(account.id)).avatarVersion > 0, 'avatar downloaded');

    t.mock.state.failHosts = new Set(['presence.roblox.com', 'users.roblox.com', 'thumbnails.roblox.com']);
    const r2 = await t.svc.refresh({ full: true });
    assert.equal(r2.ok, false);
    assert.ok(r2.errors.presence);
    const p = t.svc.get(account.id).presence;
    assert.equal(p.type, 2, 'not overwritten with a made-up "offline"');
  } finally { await t.close(); }
});

test('concurrent full refreshes share one run', async () => {
  const t = await setup();
  try {
    await t.svc.addFromCookie({ cookie: cookieFor(1100004) });
    await new Promise((r) => setTimeout(r, 100));
    t.mock.state.log = [];
    const [a, b] = await Promise.all([t.svc.refresh({}), t.svc.refresh({})]);
    assert.equal(a, b);
    assert.equal(t.mock.state.log.filter((l) => l.host === 'presence.roblox.com').length, 1);
  } finally { await t.close(); }
});

test('verifySession marks revoked sign-ins as expired', async () => {
  const t = await setup();
  try {
    const { account } = await t.svc.addFromCookie({ cookie: cookieFor(1100005) });
    t.mock.state.validCookies.clear();
    assert.deepEqual(await t.svc.verifySession(account.id), { status: 'expired' });
    t.mock.state.failHosts = new Set(['users.roblox.com']);
    const r = await t.svc.verifySession(account.id);
    assert.equal(r.status, 'expired');
    assert.equal(r.error, 'NETWORK_ERROR', 'network trouble is reported, not treated as a verdict');
  } finally { await t.close(); }
});

test('remove deletes the account, its secret and its cached images', async () => {
  const t = await setup();
  try {
    const { account } = await t.svc.addFromCookie({ cookie: cookieFor(1100006) });
    await t.svc.refresh({ ids: [account.id] });
    t.svc.setCustomIcon(account.id, avatarPng([1, 2, 3], 8));
    assert.ok(fs.existsSync(t.avatars.avatarFile(1100006)));
    assert.equal(t.svc.remove([account.id]), 1);
    assert.equal(t.vault.has(account.id), false);
    assert.equal(fs.existsSync(t.avatars.avatarFile(1100006)), false);
    assert.equal(t.avatars.iconPath(account.id), null);
  } finally { await t.close(); }
});

test('custom icons reject non-images', async () => {
  const t = await setup();
  try {
    const { account } = await t.svc.addFromCookie({ cookie: cookieFor(1100001) });
    assert.throws(() => t.svc.setCustomIcon(account.id, Buffer.from('<svg onload=alert(1)>')), /INVALID_IMAGE/);
    assert.throws(() => t.svc.setCustomIcon(account.id, Buffer.alloc(3 * 1024 * 1024, 0x89)), /IMAGE_TOO_LARGE/);
  } finally { await t.close(); }
});

test('migrates a pre-2.0 accounts.json losslessly and without leaving cookies behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ram-mig-'));
  const ss = fakeSafeStorage();
  const enc = ss.encryptString(cookieFor(1100002)).toString('base64');
  const legacy = [
    { id: 'acc_1_aaa', userId: 1100001, username: 'BlockBuilder_77', displayName: 'Builder', nickname: 'Main', notes: 'my main', favorite: true, pinned: false,
      status: 'active', presence: { presenceType: 0, presenceText: 'Offline' }, roblosecurity: cookieFor(1100001), lastLaunched: 1700000000000, addedAt: 1600000000000,
      updatedAt: 1700000000000, group: 'Mains', customAvatar: `data:image/png;base64,${avatarPng([9, 9, 9], 8).toString('base64')}` },
    { id: 'acc_2_bbb', userId: 1100002, username: 'NovaSprint', displayName: 'Nova', roblosecurityEnc: enc, cookieExpired: true, addedAt: 1600000000001 },
    { id: 'acc_3_ccc', userId: 1100003, username: 'PixelHarbor', displayName: 'Harbor', roblosecurityEnc: 'bm90LWRlY3J5cHRhYmxl', addedAt: 1600000000002 },
    { id: 'dup', userId: 1100001, username: 'BlockBuilder_77' },
    { broken: true },
  ];
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify(legacy));
  const t = await setup({ dir });
  try {
    const list = t.svc.list();
    assert.equal(list.length, 3);
    const main = list.find((a) => a.id === 'acc_1_aaa');
    assert.equal(main.nickname, 'Main');
    assert.equal(main.group, 'Mains');
    assert.equal(main.favorite, true);
    assert.equal(main.lastLaunchedAt, 1700000000000);
    assert.equal(main.hasCustomIcon, true);
    assert.equal(main.session.status, 'unknown');
    assert.equal(t.vault.get('acc_1_aaa'), cookieFor(1100001), 'plaintext legacy cookie moved into the vault');
    assert.equal(t.vault.get('acc_2_bbb'), cookieFor(1100002), 'encrypted legacy cookie adopted');
    assert.equal(list.find((a) => a.id === 'acc_2_bbb').session.status, 'expired');
    assert.equal(list.find((a) => a.id === 'acc_3_ccc').session.status, 'none', 'undecryptable cookie dropped honestly');
    assert.ok(t.svc.loadNotes.some((n) => /could not be read/.test(n)));

    const accountsText = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
    assert.ok(!accountsText.includes('TESTSESSION') && !accountsText.includes('roblosecurity'));
    assert.equal(fs.existsSync(path.join(dir, 'accounts.json.bak')), false);
    const backup = fs.readFileSync(path.join(dir, 'accounts.pre-v2-backup.json'), 'utf8');
    assert.ok(!backup.includes('TESTSESSION') && !backup.includes('roblosecurityEnc'), 'pre-migration backup has no cookies');
    assert.ok(backup.includes('my main'), 'pre-migration backup keeps organisation data');

    // Loading again is a no-op (already migrated).
    const t2 = await setup({ dir, mock: t.mock });
    assert.equal(t2.svc.list().length, 3);
    assert.equal(t2.vault.get('acc_1_aaa'), cookieFor(1100001));
  } finally { await t.close(); }
});

test('import merges organisation data and never creates sessions', async () => {
  const t = await setup();
  try {
    const { account } = await t.svc.addFromCookie({ cookie: cookieFor(1100001) });
    const summary = t.svc.importRecords([
      { userId: 1100001, username: 'BlockBuilder_77', group: 'Imported', tags: ['x'] },
      { userId: 1100002, username: 'NovaSprint', nickname: 'Nova!' },
      { userId: 'bad' },
    ], { mergeExisting: true });
    assert.deepEqual(summary, { added: 1, merged: 1, skipped: 0, invalid: 1 });
    assert.equal(t.svc.get(account.id).group, 'Imported');
    const nova = t.svc.findByUserId(1100002);
    assert.equal(nova.session.status, 'none');
    assert.equal(t.vault.has(nova.id), false);
  } finally { await t.close(); }
});
