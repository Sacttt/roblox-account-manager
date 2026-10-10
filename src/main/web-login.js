'use strict';

const crypto = require('crypto');
const { BrowserWindow, session, shell } = require('electron');

const LOGIN_URL = 'https://www.roblox.com/login';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function isRobloxHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'roblox.com' || u.hostname.endsWith('.roblox.com'));
  } catch (_) {
    return false;
  }
}

let active = null;

/**
 * Opens Roblox's real sign-in page in an isolated, in-memory browser session.
 * When Roblox sets the .ROBLOSECURITY cookie, it is handed to onCookie and
 * the window closes. The session is wiped afterwards either way.
 *
 * Resolves { canceled: true } or whatever onCookie resolves to.
 */
function openWebLogin({ parent, icon, onCookie, log, loginUrl = LOGIN_URL }) {
  if (active) {
    active.win.focus();
    return active.promise;
  }

  // No "persist:" prefix: the partition lives in memory only.
  const partition = `ram-login-${crypto.randomBytes(6).toString('hex')}`;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const win = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    parent: parent || undefined,
    modal: false,
    title: 'Sign in to Roblox',
    autoHideMenuBar: true,
    backgroundColor: '#111216',
    icon,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
  });
  win.setMenuBarVisibility(false);

  let finished = false;
  let checking = false;
  let resolveFn;
  const promise = new Promise((r) => { resolveFn = r; });

  const finish = (value) => {
    if (finished) return;
    finished = true;
    resolveFn(value);
    if (!win.isDestroyed()) win.close();
  };

  const tryCookie = async () => {
    if (finished || checking) return;
    checking = true;
    try {
      const cookies = await ses.cookies.get({ name: '.ROBLOSECURITY' });
      const c = cookies.find((x) => x.value && /(^|\.)roblox\.com$/.test(x.domain.replace(/^\./, '')));
      if (!c) return;
      const result = await onCookie(c.value);
      finish(result);
    } catch (e) {
      log.warn(`web sign-in: cookie not accepted yet (${e.code || e.message})`);
    } finally {
      checking = false;
    }
  };

  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    if (!removed && cookie.name === '.ROBLOSECURITY') tryCookie();
  });

  // Keep the window on Roblox; anything else opens in the user's browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isRobloxHost(url)) {
      e.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('did-navigate', tryCookie);
  win.webContents.on('did-finish-load', () => {
    // Cosmetic only: hide site chrome around the form. Harmless if selectors change.
    win.webContents.insertCSS('#header, .rbx-header, #footer-container, footer, .cookie-banner-wrapper { display: none !important; }').catch(() => {});
  });

  win.on('closed', () => {
    active = null;
    ses.clearStorageData().catch(() => {});
    ses.clearCache().catch(() => {});
    if (!finished) { finished = true; resolveFn({ canceled: true }); }
  });

  win.loadURL(loginUrl).catch((e) => {
    log.warn(`web sign-in: could not load the page (${e.code || e.message})`);
  });

  active = { win, promise };
  return promise;
}

function closeWebLogin() {
  if (active && !active.win.isDestroyed()) active.win.close();
}

module.exports = { openWebLogin, closeWebLogin, isRobloxHost };
