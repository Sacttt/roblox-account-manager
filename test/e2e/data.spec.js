'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cookieFor } = require('../support/mock-roblox');
const { tempDir, startMock, launchApp, accounts, addByCookie, waitFor, toastText, stepper } = require('./helpers');

test('upgrading from 1.x keeps every account, setting and saved game', { timeout: 120000 }, async (t) => {
  const { mock, origin } = await startMock();
  const dataDir = tempDir('migrate');
  const legacyAccounts = [
    { id: 'acc_1700000000000_abcdef', userId: 1100001, username: 'BlockBuilder_77', displayName: 'Builder', nickname: 'Main', notes: 'trading account',
      favorite: true, pinned: true, status: 'active', presence: { presenceType: 0, presenceText: 'Offline' }, roblosecurity: cookieFor(1100001),
      lastLaunched: 1700000000000, addedAt: 1690000000000, updatedAt: 1700000000000, avatarUrl: 'ramavatar://1100001', group: 'Mains' },
    { id: 'acc_1700000000001_bcdefg', userId: 1100002, username: 'NovaSprint', displayName: 'Nova', nickname: '', notes: '', favorite: false,
      pinned: false, status: 'banned', lastLaunched: null, addedAt: 1690000000001, updatedAt: 1690000000001 },
  ];
  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify(legacyAccounts, null, 2));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    theme: 'dark', animations: true, avatarRefreshMinutes: 15, notifications: false, multiRoblox: true, launcher: 'bloxstrap', launchDelaySec: 10,
    themeState: { themeId: 'aurora', custom: [{ id: 'custom_1', name: 'Mine', colors: { bg: '#000' } }] },
  }));
  fs.writeFileSync(path.join(dataDir, 'presets.json'), JSON.stringify([{ id: 'p_x', name: 'My Obby', target: '1818' }]));
  fs.writeFileSync(path.join(dataDir, 'multiroblox-helper.ps1'), '# stale helper from 1.x');

  const { app, win, errors } = await launchApp({ dataDir, origin });
  t.after(async () => { await app.close().catch(() => {}); await mock.close(); });
  const step = stepper(t, () => win);

  await step('accounts and organisation are migrated', async () => {
    const list = await waitFor(async () => { const l = await accounts(win); return l.length === 2 ? l : null; });
    const main = list.find((a) => a.userId === 1100001);
    assert.equal(main.id, 'acc_1700000000000_abcdef');
    assert.equal(main.nickname, 'Main');
    assert.equal(main.group, 'Mains');
    assert.equal(main.favorite, true);
    assert.equal(main.lastLaunchedAt, 1700000000000);
    assert.notEqual(main.session, 'none', 'saved sign-in carried over');
    assert.match(await toastText(win), /Upgraded 2 account/);
  });

  await step('cookies left accounts.json; backups contain no cookies', async () => {
    const accountsText = fs.readFileSync(path.join(dataDir, 'accounts.json'), 'utf8');
    assert.ok(!/TESTSESSION|roblosecurity/i.test(accountsText));
    assert.ok(fs.existsSync(path.join(dataDir, 'secrets.json')));
    const backup = fs.readFileSync(path.join(dataDir, 'accounts.pre-v2-backup.json'), 'utf8');
    assert.ok(!/TESTSESSION/.test(backup) && /trading account/.test(backup));
    assert.equal(fs.existsSync(path.join(dataDir, 'multiroblox-helper.ps1')), false, 'stale helper script cleaned up');
  });

  await step('old settings are mapped and kept as a backup', async () => {
    const s = await win.evaluate(() => window.__ram.state.settings);
    assert.equal(s.theme, 'aurora');
    assert.equal(s.launcher, 'bloxstrap');
    assert.equal(s.launchDelaySec, 10);
    assert.equal(s.presenceRefreshMinutes, 15);
    assert.equal(s.notifications, false);
    const old = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.pre-v2-backup.json'), 'utf8'));
    assert.equal(old.themeState.custom[0].name, 'Mine', 'custom themes preserved in the backup');
  });

  await step('saved games are kept and the migrated sign-in launches', async () => {
    const presets = await win.evaluate(() => window.__ram.state.presets);
    assert.deepEqual(presets.map((p) => p.name), ['My Obby']);
    await win.keyboard.press('Control+2');
    await win.locator('[data-target-input]').fill('1818');
    const main = (await accounts(win)).find((a) => a.userId === 1100001);
    await win.locator(`.acc-card[data-id="${main.id}"] [data-action="launch"]`).click();
    await waitFor(() => fs.existsSync(path.join(dataDir, 'launches.jsonl')));
    assert.match(fs.readFileSync(path.join(dataDir, 'launches.jsonl'), 'utf8'), /TESTTICKET1100001/);
    assert.deepEqual(errors, []);
  });
});

test('a damaged accounts.json is restored from its backup', { timeout: 90000 }, async (t) => {
  const { mock, origin } = await startMock();
  const dataDir = tempDir('corrupt');
  let { app, win } = await launchApp({ dataDir, origin });
  t.after(async () => { await app.close().catch(() => {}); await mock.close(); });
  await addByCookie(win, cookieFor(1100001));
  await addByCookie(win, cookieFor(1100002));
  await win.waitForTimeout(400);
  await app.close();

  const file = path.join(dataDir, 'accounts.json');
  assert.ok(fs.existsSync(`${file}.bak`));
  fs.writeFileSync(file, '{"version":2,"accounts":[{"id":');
  ({ app, win } = await launchApp({ dataDir, origin }));
  const list = await waitFor(async () => { const l = await accounts(win); return l.length >= 1 ? l : null; });
  assert.ok(list.some((a) => a.userId === 1100001));
  assert.match(await toastText(win), /restored from its backup/);
  assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith('accounts.json.corrupt-')), 'damaged copy kept for inspection');
});

test('Roblox outages and rate limits are handled without fake data', { timeout: 120000 }, async (t) => {
  const { mock, origin } = await startMock();
  const dataDir = tempDir('outage');
  const { app, win, errors } = await launchApp({ dataDir, origin });
  t.after(async () => { await app.close().catch(() => {}); await mock.close(); });
  const step = stepper(t, () => win);

  await step('add works, then Roblox goes down', async () => {
    await addByCookie(win, cookieFor(1100003));
    await waitFor(async () => (await accounts(win))[0].presence);
    mock.state.failHosts = new Set(['presence.roblox.com', 'users.roblox.com', 'thumbnails.roblox.com', 'auth.roblox.com']);
  });

  await step('refresh reports the problem and keeps last-known status', async () => {
    const before = (await accounts(win))[0].presence;
    await win.keyboard.press('Control+r');
    await waitFor(async () => /Refreshed with problems|Couldn't reach Roblox/.test(await toastText(win)), { timeout: 20000 });
    assert.deepEqual((await accounts(win))[0].presence, before);
  });

  await step('launching while Roblox is unreachable fails with a clear message', async () => {
    await win.keyboard.press('Control+2');
    await win.locator('[data-target-input]').fill('1818');
    const a = (await accounts(win))[0];
    await win.locator(`.acc-card[data-id="${a.id}"] [data-action="launch"]`).click();
    await waitFor(async () => /Couldn't reach Roblox/.test(await toastText(win)), { timeout: 20000 });
    assert.equal((await accounts(win))[0].session, 'valid', 'a network error does not mark the sign-in expired');
  });

  await step('rate limiting is retried transparently', async () => {
    mock.state.failHosts = new Set();
    mock.state.rateLimitNext = 2;
    mock.state.retryAfter = 1;
    await win.keyboard.press('Escape');
    await win.keyboard.press('Control+r');
    await waitFor(async () => /Refreshed 1 account/.test(await toastText(win)), { timeout: 20000 });
    assert.deepEqual(errors, []);
  });
});

test('backups export without cookies and import into a fresh install', { timeout: 120000 }, async (t) => {
  const { mock, origin } = await startMock();
  const dirA = tempDir('backup-a');
  const backupFile = path.join(dirA, 'my-backup.json');
  let { app, win } = await launchApp({ dataDir: dirA, origin });
  t.after(async () => { await app.close().catch(() => {}); await mock.close(); });
  const step = stepper(t, () => win);

  await step('export writes organisation data only', async () => {
    await addByCookie(win, cookieFor(1100004), { nickname: 'Comet', group: 'Alts' });
    await addByCookie(win, cookieFor(1100005));
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, backupFile);
    await win.keyboard.press('Control+5');
    await win.locator('[data-section="data"]').click();
    await win.locator('[data-act="export"]').click();
    await waitFor(async () => /Backup saved/.test(await toastText(win)));
    const text = fs.readFileSync(backupFile, 'utf8');
    assert.ok(!/TESTSESSION|WARNING|roblosecurity/i.test(text), 'no cookies in the backup');
    const data = JSON.parse(text);
    assert.equal(data.format, 'roblox-account-manager-backup');
    assert.equal(data.accounts.find((a) => a.userId === 1100004).nickname, 'Comet');
  });

  await step('import restores accounts without sign-ins', async () => {
    await app.close();
    const dirB = tempDir('backup-b');
    ({ app, win } = await launchApp({ dataDir: dirB, origin }));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, backupFile);
    await win.keyboard.press('Control+5');
    await win.locator('[data-section="data"]').click();
    await win.locator('[data-act="import"]').click();
    await win.locator('.modal').getByText('2 accounts').waitFor();
    await win.locator('.modal [data-o="settings"]').check();
    await win.locator('.modal [data-ok]').click();
    await waitFor(async () => /Import complete/.test(await toastText(win)));
    const list = await accounts(win);
    assert.equal(list.length, 2);
    assert.equal(list.find((a) => a.userId === 1100004).group, 'Alts');
    assert.ok(list.every((a) => a.session === 'none'));
  });
});
