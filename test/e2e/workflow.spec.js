'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cookieFor } = require('../support/mock-roblox');
const { tempDir, startMock, launchApp, accounts, addByCookie, readSink, waitFor, toastText, stepper } = require('./helpers');

test('main workflow: add, organise, launch, remove, persist', { timeout: 180000 }, async (t) => {
  const { mock, origin } = await startMock();
  const dataDir = tempDir('workflow');
  const sink = path.join(dataDir, 'launches.jsonl');
  let { app, win, errors } = await launchApp({ dataDir, origin, sink });
  t.after(async () => { await app.close().catch(() => {}); await mock.close(); });
  const step = stepper(t, () => win);

  await step('empty profile shows onboarding', async () => {
    await win.getByText('Welcome to Roblox Account Manager').waitFor();
  });

  await step('adds accounts from cookies with a verified preview', async () => {
    await win.locator('.choice[data-add="cookie"]').click();
    await win.locator('#add-cookie').fill(cookieFor(1100001));
    await win.locator('.modal .preview-card').getByText('BlockBuilder_77').waitFor();
    await win.locator('#add-nick').fill('Main');
    await win.locator('#add-group').fill('Mains');
    await win.locator('.modal [data-submit]').click();
    await win.locator('.modal').waitFor({ state: 'detached' });
    assert.match(await toastText(win), /Account added/);
    await win.getByRole('heading', { name: 'Overview' }).waitFor();

    await addByCookie(win, cookieFor(1100002));
    await addByCookie(win, cookieFor(1100003), { group: 'Alts' });
    const list = await accounts(win);
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((a) => a.session), ['valid', 'valid', 'valid']);
    assert.equal(list.find((a) => a.userId === 1100001).nickname, 'Main');
  });

  await step('rejects invalid and duplicate cookies with clear messages', async () => {
    await win.keyboard.press('Control+n');
    await win.locator('.modal [data-method="cookie"]').click();
    await win.locator('#add-cookie').fill(`_|WARNING:-DO-NOT-SHARE|_${'Z'.repeat(80)}`);
    await win.locator('.modal [data-cookie-error]').getByText(/did not accept that cookie/).waitFor();
    assert.equal(await win.locator('.modal [data-submit]').isDisabled(), true);

    await win.locator('#add-cookie').fill(cookieFor(1100002));
    await win.locator('.modal [data-preview]').getByText('already in your list').waitFor();
    assert.equal(await win.locator('.modal [data-submit]').innerText(), 'Update sign-in');
    await win.keyboard.press('Escape');
    await win.locator('.modal').waitFor({ state: 'detached' });
    assert.equal((await accounts(win)).length, 3);
  });

  await step('search, favorites and groups filter the account list', async () => {
    await win.keyboard.press('Control+2');
    await win.locator('.acc-card').nth(2).waitFor();
    await win.keyboard.press('Control+f');
    await win.keyboard.type('nova');
    await waitFor(async () => (await win.locator('.acc-card').count()) === 1);
    await win.keyboard.press('Escape');
    await waitFor(async () => (await win.locator('.acc-card').count()) === 3);

    const nova = (await accounts(win)).find((a) => a.userId === 1100002);
    await win.locator(`.acc-card[data-id="${nova.id}"] [data-action="favorite"]`).click();
    await win.locator('.filter-chip[data-chip="favorites"]').click();
    await waitFor(async () => (await win.locator('.acc-card').count()) === 1);
    await win.locator('.filter-chip[data-chip="all"]').click();

    await win.locator('#sidebar [data-group="Alts"]').click();
    await waitFor(async () => (await win.locator('.acc-card').count()) === 1);
    await win.locator('#sidebar [data-nav="accounts"]').click();
    await waitFor(async () => (await win.locator('.acc-card').count()) === 3);
  });

  await step('edits organisation details in the account drawer', async () => {
    const harbor = (await accounts(win)).find((a) => a.userId === 1100003);
    await win.locator(`.acc-card[data-id="${harbor.id}"] .names`).click();
    await win.locator('.drawer #d-nick').fill('Harbor Alt');
    await win.locator('.drawer [data-tags] input').fill('farm');
    await win.keyboard.press('Enter');
    await win.locator('.drawer [data-save]').click();
    await waitFor(async () => (await accounts(win)).find((a) => a.id === harbor.id).nickname === 'Harbor Alt');
    assert.deepEqual((await accounts(win)).find((a) => a.id === harbor.id).tags, ['farm']);
    await win.keyboard.press('Escape');
    await win.locator('.drawer').waitFor({ state: 'detached' });
    await win.locator(`.acc-card[data-id="${harbor.id}"]`).getByText('Harbor Alt').waitFor();
  });

  await step('requires a game, then launches one account with its own sign-in ticket', async () => {
    const main = (await accounts(win)).find((a) => a.userId === 1100001);
    await win.locator(`.acc-card[data-id="${main.id}"] [data-action="launch"]`).click();
    assert.match(await toastText(win), /Choose a game first/);
    assert.equal(readSink(sink).length, 0);

    await win.locator('[data-target-input]').fill('https://www.roblox.com/games/920587237/Adopt-Me');
    await win.locator('[data-target-parsed]').getByText('Place 920587237').waitFor();
    await win.locator(`.acc-card[data-id="${main.id}"] [data-action="launch"]`).click();
    const launches = await waitFor(() => (readSink(sink).length === 1 ? readSink(sink) : null));
    assert.equal(launches[0].accountId, main.id);
    assert.match(launches[0].uri, /^roblox-player:1\+launchmode:play\+gameinfo:TESTTICKET1100001x0\+launchtime:\d+\+placelauncherurl:https:\/\/assetgame\.roblox\.com\/game\/PlaceLauncher\.ashx\?request=RequestGameJob&browserTrackerId=\d+&placeId=920587237&isPlayTogetherGame=false\+/);
    await waitFor(async () => (await accounts(win)).find((a) => a.id === main.id).lastLaunchedAt);
  });

  await step('asks before launching the same account twice in a row', async () => {
    const main = (await accounts(win)).find((a) => a.userId === 1100001);
    await win.locator(`.acc-card[data-id="${main.id}"] [data-action="launch"]`).click();
    await win.locator('.modal').getByText('Launch again?').waitFor();
    await win.locator('.modal [data-ok]').click();
    await waitFor(() => readSink(sink).length === 2);
  });

  await step('launches several selected accounts together, in order', async () => {
    const list = await accounts(win);
    const nova = list.find((a) => a.userId === 1100002);
    const harbor = list.find((a) => a.userId === 1100003);
    await win.locator(`.acc-card[data-id="${nova.id}"] .check`).click();
    await win.locator(`.acc-card[data-id="${harbor.id}"] .check`).click({ modifiers: [] });
    await win.locator('.bulk-bar').getByText('2 selected').waitFor();
    await win.locator('.bulk-bar [data-bulk-action="launch"]').click();
    await waitFor(() => readSink(sink).length === 4, { timeout: 15000 });
    const lines = readSink(sink).slice(2);
    const order = list.filter((a) => [nova.id, harbor.id].includes(a.id)).map((a) => a.id);
    assert.deepEqual(lines.map((l) => l.accountId).sort(), order.sort());
    await waitFor(async () => /2 of 2 accounts opened/.test(await toastText(win)));
    await win.keyboard.press('Escape');
  });

  await step('an expired sign-in is detected at launch and flagged', async () => {
    const nova = (await accounts(win)).find((a) => a.userId === 1100002);
    await fetch(`${origin}/__control/configure`, { method: 'POST', body: JSON.stringify({ revoke: [1100002] }) });
    await win.evaluate(() => { window.__ram.state.accounts.forEach((a) => { a.lastLaunchedAt = null; }); });
    await win.locator(`.acc-card[data-id="${nova.id}"] [data-action="launch"]`).click();
    const modal = win.locator('.modal').getByText('Launch again?');
    if (await modal.isVisible().catch(() => false)) await win.locator('.modal [data-ok]').click();
    await waitFor(async () => (await accounts(win)).find((a) => a.id === nova.id).session === 'expired');
    await waitFor(async () => /Couldn't open|Roblox rejected/.test(await toastText(win)));
    await win.locator(`.acc-card[data-id="${nova.id}"]`).getByText('Sign-in expired').waitFor();
    assert.equal(readSink(sink).length, 4, 'nothing was launched');
  });

  await step('command palette finds an account and opens it', async () => {
    await win.keyboard.press('Control+k');
    await win.keyboard.type('Pixel');
    await win.locator('.palette-item.active').getByText('Harbor Alt').waitFor();
    await win.keyboard.press('Shift+Enter');
    await win.locator('.drawer h2').getByText('Harbor Alt').waitFor();
  });

  await step('removing an account deletes it and its saved sign-in', async () => {
    const harbor = (await accounts(win)).find((a) => a.userId === 1100003);
    await win.locator('.drawer [data-remove]').click();
    await win.locator('.modal').getByText(/Remove Harbor Alt\?/).waitFor();
    await win.locator('.modal [data-ok]').click();
    await waitFor(async () => (await accounts(win)).length === 2);
    await win.locator('.drawer').waitFor({ state: 'detached' });
    const secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8'));
    assert.equal(harbor.id in secrets.entries, false);
  });

  await step('theme changes apply immediately', async () => {
    await win.keyboard.press('Control+5');
    await win.locator('[data-section="appearance"]').click();
    await win.locator('[data-theme="light"]').click();
    await waitFor(() => win.evaluate(() => document.body.classList.contains('theme-light')));
  });

  await step('everything persists after a restart', async () => {
    assert.deepEqual(errors, [], `renderer errors: ${errors.join('\n')}`);
    await app.close();
    ({ app, win, errors } = await launchApp({ dataDir, origin, sink }));
    const list = await waitFor(async () => { const l = await accounts(win); return l.length === 2 ? l : null; });
    const main = list.find((a) => a.userId === 1100001);
    assert.equal(main.nickname, 'Main');
    assert.equal(main.group, 'Mains');
    assert.ok(main.lastLaunchedAt);
    assert.equal(list.find((a) => a.userId === 1100002).favorite, true);
    assert.equal(list.find((a) => a.userId === 1100002).session, 'expired');
    assert.equal(main.session, 'valid', 'verified sign-in keeps its status and check time');
    assert.ok(await win.evaluate(() => document.body.classList.contains('theme-light')));
    assert.equal(await win.locator('[data-target-input]').inputValue(), 'https://www.roblox.com/games/920587237/Adopt-Me');
    await win.locator('#sidebar [data-group="Mains"]').waitFor();
  });

  await step('activity history records what happened', async () => {
    await win.keyboard.press('Control+4');
    await win.getByText('Opened Roblox as Main').first().waitFor();
    await win.getByText(/Launch Together: 2 of 2/).waitFor();
    await win.getByText(/Removed Harbor Alt/).waitFor();
    assert.deepEqual(errors, []);
  });
});
