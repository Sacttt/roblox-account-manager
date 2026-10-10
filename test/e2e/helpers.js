'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const { createMockRoblox } = require('../support/mock-roblox');

const APP_DIR = path.join(__dirname, '..', '..');
// Test-only: CI Linux runners restrict the Chromium sandbox's user namespaces.
const needsNoSandbox = process.platform === 'linux';

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ram-e2e-${name}-`));
}

async function startMock() {
  const mock = createMockRoblox();
  const origin = await mock.listen();
  return { mock, origin };
}

/** Launches the real app against the mock Roblox API with an isolated data folder. */
async function launchApp({ dataDir, origin, sink, extraEnv = {} }) {
  const app = await electron.launch({
    args: [...(needsNoSandbox ? ['--no-sandbox'] : []), APP_DIR],
    env: {
      ...process.env,
      RAM_TEST_MODE: '1',
      RAM_USER_DATA_DIR: dataDir,
      RAM_TEST_ROBLOX_ORIGIN: origin,
      RAM_TEST_LAUNCH_SINK: sink || path.join(dataDir, 'launches.jsonl'),
      ...extraEnv,
    },
  });
  const win = await app.firstWindow();
  win.setDefaultTimeout(10000);
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.waitForSelector('#sidebar .nav-item');
  await win.setViewportSize({ width: 1360, height: 860 }).catch(() => {});
  return { app, win, errors };
}

async function accounts(win) {
  return win.evaluate(() => window.__ram.accountList().map((a) => ({
    id: a.id, userId: a.userId, username: a.username, nickname: a.nickname, group: a.group, tags: a.tags,
    favorite: a.favorite, session: a.session.status, presence: a.presence, lastLaunchedAt: a.lastLaunchedAt,
  })));
}

async function addByCookie(win, cookie, { nickname = '', group = '' } = {}) {
  await win.keyboard.press('Control+n');
  await win.locator('.modal [data-method="cookie"]').click();
  await win.locator('#add-cookie').fill(cookie);
  await win.locator('.modal .preview-card .badge.green').waitFor({ timeout: 10000 });
  if (nickname) await win.locator('#add-nick').fill(nickname);
  if (group) await win.locator('#add-group').fill(group);
  await win.locator('.modal [data-submit]').click();
  await win.locator('.modal').waitFor({ state: 'detached' });
}

function readSink(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function waitFor(fn, { timeout = 8000, interval = 100 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out (last value: ${JSON.stringify(last)})`);
}

async function toastText(win) {
  return win.locator('#toasts').innerText();
}

/** Wraps a sub-test so a failure leaves a screenshot and UI state in test/e2e/artifacts. */
function stepper(t, getWin) {
  return (name, fn) => t.test(name, async () => {
    try {
      await fn();
    } catch (e) {
      const dir = path.join(__dirname, 'artifacts');
      fs.mkdirSync(dir, { recursive: true });
      const slug = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
      const win = getWin();
      try { await win.screenshot({ path: path.join(dir, `${slug}.png`) }); } catch (_) { /* window gone */ }
      try {
        const st = await win.evaluate(() => ({ view: window.__ram.state.view, filters: window.__ram.state.filters, selection: [...window.__ram.state.selection], toasts: document.getElementById('toasts').innerText, active: document.activeElement && document.activeElement.outerHTML.slice(0, 200) }));
        fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(st, null, 2));
      } catch (_) { /* ignore */ }
      throw e;
    }
  });
}

module.exports = { stepper, APP_DIR, tempDir, startMock, launchApp, accounts, addByCookie, readSink, waitFor, toastText };
