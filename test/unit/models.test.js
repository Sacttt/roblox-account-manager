'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../../src/main/settings');
const model = require('../../src/main/accounts-model');
const { redact } = require('../../src/main/redact');
const { parseBackup, buildBackup } = require('../../src/main/backup');
const { normalizeCookie } = require('../../src/main/roblox/api');

const COOKIE = `_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_${'AB12'.repeat(30)}`;

test('settings: defaults are valid and unknown/invalid values are dropped', () => {
  const d = settings.defaults();
  assert.equal(d.theme, 'midnight');
  assert.deepEqual(settings.normalize({ theme: 'nope', launchDelaySec: 999, closeToTray: false, extra: 1 }), { ...d, closeToTray: false });
});

test('settings: patch validation rejects unknown keys and bad values', () => {
  assert.deepEqual(settings.validatePatch({ theme: 'aurora' }), { theme: 'aurora' });
  assert.throws(() => settings.validatePatch({ evil: true }), /UNKNOWN_SETTING:evil/);
  assert.throws(() => settings.validatePatch({ launchDelaySec: 1 }), /INVALID_SETTING/);
  assert.throws(() => settings.validatePatch({ accentColor: 'red; background:url(x)' }), /INVALID_SETTING/);
  assert.throws(() => settings.validatePatch(null), /INVALID_SETTINGS/);
});

test('settings: migrates the pre-2.0 settings file', () => {
  const s = settings.migrate({
    theme: 'dark', animations: false, avatarRefreshMinutes: 30, notifications: true, multiRoblox: false,
    launcher: 'fishstrap', launchDelaySec: 10, themeState: { themeId: 'cyber' }, launchBehavior: 'x',
  });
  assert.equal(s.reduceMotion, true);
  assert.equal(s.presenceRefreshMinutes, 30);
  assert.equal(s.multiRoblox, false);
  assert.equal(s.launcher, 'fishstrap');
  assert.equal(s.launchDelaySec, 10);
  assert.equal(s.theme, 'violet');
  assert.equal(settings.migrate({ avatarRefreshMinutes: 0 }).presenceRefreshMinutes, 0);
  assert.equal(settings.migrate(null).theme, 'midnight');
});

test('accounts: normalize rejects broken records and cleans text', () => {
  assert.equal(model.normalizeAccount({ username: 'x' }), null);
  assert.equal(model.normalizeAccount({ userId: -1, username: 'x' }), null);
  const a = model.normalizeAccount({ userId: '42', username: 'Bob', nickname: ` hi\u0000there `, tags: ['a', 'A', ' b ', '', 'c'.repeat(40)], favorite: 'yes' });
  assert.equal(a.userId, 42);
  assert.equal(a.nickname, 'hithere');
  assert.deepEqual(a.tags, ['a', 'b', 'c'.repeat(24)]);
  assert.equal(a.favorite, false);
  assert.equal(a.session.status, 'none');
  assert.equal(a.presence, null);
  assert.match(a.id, /^acc_/);
});

test('accounts: migrates a legacy record without trusting stale data', () => {
  const r = model.migrateLegacyAccount({
    id: 'acc_1_abc', userId: 7, username: 'Old', displayName: 'Oldie', nickname: 'Main', notes: 'n', favorite: true, pinned: true,
    status: 'active', presence: { presenceType: 2, presenceText: 'In Game' }, lastLaunched: 1700000000000, addedAt: 1600000000000,
    roblosecurityEnc: 'ENC', cookieExpired: true, customAvatar: 'data:image/png;base64,AAAA', group: 'Alts', noDecor: true, avatarUrl: 'ramavatar://7',
  });
  assert.equal(r.account.id, 'acc_1_abc');
  assert.equal(r.account.group, 'Alts');
  assert.equal(r.account.lastLaunchedAt, 1700000000000);
  assert.equal(r.account.presence, null, 'old presence is not trusted');
  assert.equal(r.account.profile.isBanned, null, '"active" was not a verified fact');
  assert.equal(r.account.session.status, 'expired');
  assert.equal(r.encryptedSecret, 'ENC');
  assert.equal(r.customIconDataUrl, 'data:image/png;base64,AAAA');
  assert.ok(!('roblosecurityEnc' in r.account) && !('avatarUrl' in r.account) && !('noDecor' in r.account));
  assert.equal(model.migrateLegacyAccount({ userId: 8, username: 'B', status: 'banned' }).account.profile.isBanned, true);
});

test('accounts: only organisation fields are editable', () => {
  assert.deepEqual(model.sanitizePatch({ nickname: ' x ', favorite: true, tags: ['t'] }), { nickname: 'x', favorite: true, tags: ['t'] });
  assert.throws(() => model.sanitizePatch({ userId: 1 }), /FIELD_NOT_EDITABLE:userId/);
  assert.throws(() => model.sanitizePatch({ session: { status: 'valid' } }), /FIELD_NOT_EDITABLE/);
  assert.throws(() => model.sanitizePatch({ favorite: 'true' }), /INVALID_FIELD/);
  assert.throws(() => model.sanitizePatch({ notes: 5 }), /INVALID_FIELD/);
});

test('redact removes cookies, tickets and launch URIs', () => {
  const text = redact(`Cookie: .ROBLOSECURITY=${COOKIE}; x=1 uri roblox-player:1+gameinfo:SECRET {"cookie":"abc"} ${COOKIE}`);
  assert.doesNotMatch(text, /AB12AB12|SECRET|WARNING:-DO-NOT/);
  assert.equal(redact(null), null);
  assert.equal(redact({ a: 1 }), '{"a":1}');
});

test('normalizeCookie accepts common paste formats and keeps the warning banner', () => {
  assert.equal(normalizeCookie(COOKIE), COOKIE);
  assert.equal(normalizeCookie(`  ".ROBLOSECURITY=${COOKIE}; path=/"  `), COOKIE);
  assert.equal(normalizeCookie(`ROBLOSECURITY=${COOKIE}`), COOKIE);
  assert.throws(() => normalizeCookie('short'), /INVALID_COOKIE_FORMAT/);
  assert.throws(() => normalizeCookie(`${COOKIE}\r\nX-Evil: 1`), /INVALID_COOKIE_FORMAT/);
  assert.throws(() => normalizeCookie(`${COOKIE} more`), /INVALID_COOKIE_FORMAT/);
});

test('backup: v2 round trip and legacy array import', () => {
  const b = buildBackup({ appVersion: '2.0.0', accounts: [{ userId: 1, username: 'a', group: 'g' }], settings: { theme: 'light' }, presets: [] });
  const parsed = parseBackup(JSON.stringify(b));
  assert.equal(parsed.accounts[0].group, 'g');
  assert.deepEqual(parsed.settings, { theme: 'light' });
  assert.deepEqual(parsed.warnings, []);

  const legacy = parseBackup(`﻿${JSON.stringify([{ userId: 2, username: 'b', lastLaunched: 5, roblosecurity: 'x' }])}`);
  assert.equal(legacy.accounts[0].lastLaunchedAt, 5);
  assert.equal(legacy.accounts[0].roblosecurity, undefined, 'secrets are never carried into records');
  assert.equal(legacy.warnings.length, 1);
});

test('backup: rejects files that are not backups', () => {
  for (const bad of ['', 'not json', '{"a":1}', '{"format":"roblox-account-manager-backup"}', '42']) {
    assert.throws(() => parseBackup(bad), /INVALID_BACKUP/, bad);
  }
});
