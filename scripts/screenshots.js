'use strict';

/**
 * Captures screenshots of the real app filled with demo data served by the
 * local mock Roblox API (no real accounts involved). Used for visual review
 * and for the project website.
 *
 *   node scripts/screenshots.js [outputDir]      (Linux: run inside xvfb-run)
 */
const fs = require('fs');
const path = require('path');
const { cookieFor } = require('../test/support/mock-roblox');
const { tempDir, startMock, launchApp, accounts, addByCookie, waitFor } = require('../test/e2e/helpers');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'website', 'assets', 'screens'));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { mock, origin } = await startMock();
  mock.state.presence.set(1100001, { userPresenceType: 2, lastLocation: 'Adopt Me!', placeId: 920587237 });
  mock.state.presence.set(1100002, { userPresenceType: 1 });
  mock.state.presence.set(1100004, { userPresenceType: 2, lastLocation: 'Blox Fruits', placeId: 2753915549 });
  mock.state.presence.set(1100006, { userPresenceType: 3 });
  const dataDir = tempDir('shots');
  const { app, win } = await launchApp({ dataDir, origin });
  await win.setViewportSize({ width: 1360, height: 820 });

  const shot = async (name, opts = {}) => {
    await win.waitForTimeout(450);
    await win.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
    console.log(`saved ${name}.png`);
  };

  await shot('onboarding');
  for (const id of [1100001, 1100002, 1100003, 1100004, 1100005, 1100006]) await addByCookie(win, cookieFor(id));
  const list = await accounts(win);
  const byUser = (uid) => list.find((a) => a.userId === uid).id;
  const edits = [
    [1100001, { nickname: 'Main', group: 'Mains', tags: ['trading', 'premium'], favorite: true, pinned: true }],
    [1100002, { nickname: 'Nova', group: 'Alts', tags: ['farming'], favorite: true }],
    [1100003, { group: 'Alts', tags: ['farming'] }],
    [1100004, { nickname: 'Comet', group: 'Trading', tags: ['trading'], favorite: true, notes: 'Holds the rare pets. Do not trade the shadow dragon.' }],
    [1100005, { group: 'Alts' }],
    [1100006, { group: 'Builders', tags: ['studio'] }],
  ];
  for (const [uid, patch] of edits) await win.evaluate(([id, p]) => window.ram.invoke('accounts:update', id, p), [byUser(uid), patch]);
  await win.evaluate(() => window.ram.invoke('presets:upsert', { name: 'Adopt Me!', target: '920587237' }));
  await win.evaluate(() => window.ram.invoke('presets:upsert', { name: 'Private server · Trading', target: 'https://www.roblox.com/games/2753915549/Blox-Fruits?privateServerLinkCode=48291736' }));

  // Some launch history, then one sign-in that Roblox has revoked.
  await win.keyboard.press('Control+2');
  await win.locator('[data-target-input]').fill('920587237');
  await win.waitForTimeout(400);
  for (const uid of [1100004, 1100001]) {
    await win.locator(`.acc-card[data-id="${byUser(uid)}"] [data-action="launch"]`).click();
    await waitFor(async () => (await accounts(win)).find((a) => a.userId === uid).lastLaunchedAt);
  }
  await fetch(`${origin}/__control/configure`, { method: 'POST', body: JSON.stringify({ revoke: [1100005] }) });
  await win.evaluate((id) => window.ram.invoke('accounts:verify-session', id), byUser(1100005));
  await win.evaluate(() => window.ram.invoke('accounts:refresh', { full: true }));
  await win.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  await win.keyboard.press('Control+1');
  await shot('dashboard');

  await win.keyboard.press('Control+2');
  await win.evaluate(() => window.ram.invoke('settings:update', { viewMode: 'grid' }));
  await shot('accounts-grid');

  await win.locator(`.acc-card[data-id="${byUser(1100002)}"] .check`).click();
  await win.locator(`.acc-card[data-id="${byUser(1100003)}"] .check`).click();
  await win.locator(`.acc-card[data-id="${byUser(1100006)}"] .check`).click();
  await shot('accounts-bulk');
  await win.keyboard.press('Escape');

  await win.evaluate(() => window.ram.invoke('settings:update', { viewMode: 'list' }));
  await shot('accounts-table');
  await win.evaluate(() => window.ram.invoke('settings:update', { viewMode: 'grid' }));

  await win.locator(`.acc-card[data-id="${byUser(1100004)}"] .names`).click();
  await shot('account-details');
  await win.keyboard.press('Escape');

  await win.keyboard.press('Control+n');
  await win.locator('.modal [data-method="cookie"]').click();
  await win.locator('#add-cookie').fill(cookieFor(1100003));
  await win.locator('.modal [data-preview] .preview-card').waitFor();
  await shot('add-account');
  await win.keyboard.press('Escape');

  await win.keyboard.press('Control+k');
  await win.keyboard.type('a');
  await shot('command-palette');
  await win.keyboard.press('Escape');

  await win.keyboard.press('Control+3');
  await shot('games');
  await win.keyboard.press('Control+4');
  await shot('activity');
  await win.keyboard.press('Control+5');
  await win.locator('[data-section="launching"]').click();
  await shot('settings-launching');
  await win.locator('[data-section="appearance"]').click();
  await shot('settings-appearance');
  await win.locator('[data-section="diagnostics"]').click();
  await win.locator('.diag-grid .diag-item:not(.skeleton)').first().waitFor();
  await shot('settings-diagnostics');

  await win.evaluate(() => window.ram.invoke('settings:update', { theme: 'light' }));
  await win.keyboard.press('Control+1');
  await shot('dashboard-light');
  await win.evaluate(() => window.ram.invoke('settings:update', { theme: 'violet' }));
  await win.keyboard.press('Control+2');
  await shot('accounts-violet');
  await win.evaluate(() => window.ram.invoke('settings:update', { theme: 'midnight', density: 'compact' }));
  await shot('accounts-compact');

  await app.close();
  await mock.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
