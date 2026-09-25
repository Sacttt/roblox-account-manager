'use strict';

/**
 * Auto-update engine (electron-updater + GitHub Releases).
 *
 * This is a thin, production-oriented wrapper around electron-updater — the
 * standard updater for electron-builder projects. We do NOT download or run
 * arbitrary files ourselves: electron-updater fetches the release metadata
 * (latest.yml) over HTTPS from GitHub Releases, verifies the downloaded NSIS
 * installer against the SHA512 in that metadata (and its Authenticode
 * signature too, when the build is code-signed), keeps the current install in
 * place until the user installs, and restarts into the new version.
 *
 * Update flow used here:
 *   1. checkForUpdates()  -> 'update-available' (we then ASK the user)
 *   2. downloadUpdate()   -> 'download-progress' ... 'update-downloaded'
 *   3. quitAndInstall()   -> installer runs, app restarts on the new version
 *
 * Nothing in this file contains secrets. Publishing credentials (GH_TOKEN)
 * live only in the build environment, never in the app.
 */

const { app, ipcMain } = require('electron');

// electron-updater is only needed in the main process at runtime. Require it
// lazily so `npm start` before `npm install` gives a clear message instead of
// a hard crash on load.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_) {
  autoUpdater = null;
}

// Optional richer logging if electron-log is installed; console otherwise.
let logger = console;
try {
  logger = require('electron-log');
  logger.transports.file.level = 'info';
} catch (_) {
  logger = {
    info: (...a) => console.log('[updater]', ...a),
    warn: (...a) => console.warn('[updater]', ...a),
    error: (...a) => console.error('[updater]', ...a),
    debug: () => {}
  };
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY = 8 * 1000; // let the UI settle before the first check

let mainWindow = null;
let periodicTimer = null;
let downloading = false;
let downloaded = false;
let lastInfo = null;      // most recent UpdateInfo from Roblox... (version, releaseNotes, releaseDate)
let checking = false;

/** A release is "critical" if its notes contain the marker `[critical]`. */
function isCritical(info) {
  const notes = info && info.releaseNotes;
  const text = Array.isArray(notes)
    ? notes.map((n) => (n && n.note) || '').join('\n')
    : String(notes || '');
  return /\[critical\]/i.test(text);
}

/** Push a status object to the renderer so the UI can react. */
function send(status, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:status', { status, ...extra });
  }
}

function updaterAvailable() {
  return !!autoUpdater;
}

/**
 * True when real update checks can run: a packaged build, OR a dev/local run
 * with RAM_TEST_UPDATES=1 (uses dev-app-update.yml). This keeps everyday
 * `npm start` from erroring on a missing app-update.yml.
 */
function canCheck() {
  if (!autoUpdater) return false;
  if (app.isPackaged) return true;
  if (process.env.RAM_TEST_UPDATES === '1') {
    autoUpdater.forceDevUpdateConfig = true;
    return true;
  }
  return false;
}

function init(win) {
  mainWindow = win;
  if (!autoUpdater) {
    logger.warn('electron-updater not installed — updates disabled. Run npm install.');
    return;
  }

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;         // we ask the user before downloading
  autoUpdater.autoInstallOnAppQuit = true;  // if downloaded, apply on next quit
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => { checking = true; send('checking'); });

  autoUpdater.on('update-available', (info) => {
    checking = false;
    lastInfo = info;
    send('available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
      currentVersion: app.getVersion(),
      critical: isCritical(info)
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    checking = false;
    send('not-available', { version: (info && info.version) || app.getVersion(), currentVersion: app.getVersion() });
  });

  autoUpdater.on('download-progress', (p) => {
    downloading = true;
    send('downloading', {
      percent: Math.round(p.percent || 0),
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloading = false;
    downloaded = true;
    lastInfo = info;
    send('downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
      currentVersion: app.getVersion(),
      critical: isCritical(info)
    });
  });

  autoUpdater.on('error', (err) => {
    checking = false;
    downloading = false;
    // Never surface tokens or full URLs with query params to the UI.
    const message = (err && err.message ? err.message : String(err)).replace(/https?:\/\/\S+/g, '[url]');
    logger.error('Update error:', err);
    send('error', { message });
  });

  // First check shortly after launch, then on a gentle interval.
  if (canCheck()) {
    setTimeout(() => { safeCheck(); }, STARTUP_DELAY);
    periodicTimer = setInterval(() => { safeCheck(); }, SIX_HOURS);
  } else {
    logger.info('Update checks are disabled in this run (dev build without RAM_TEST_UPDATES=1).');
  }

  registerIpc();
}

async function safeCheck() {
  if (!canCheck() || checking || downloading) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // Network/server errors are non-fatal — the app keeps running.
    logger.warn('checkForUpdates failed:', err && err.message);
  }
}

function registerIpc() {
  // Current running version — keeps package.json the single source of truth.
  ipcMain.handle('updates:getVersion', () => app.getVersion());

  ipcMain.handle('updates:getState', () => ({
    supported: updaterAvailable(),
    canCheck: canCheck(),
    checking,
    downloading,
    downloaded,
    version: app.getVersion(),
    pending: lastInfo ? { version: lastInfo.version, critical: isCritical(lastInfo) } : null
  }));

  // Manual "Check for updates" button. Returns a small result for the caller;
  // detailed state also arrives via the 'updates:status' events above.
  ipcMain.handle('updates:check', async () => {
    if (!updaterAvailable()) return { ok: false, reason: 'UNSUPPORTED' };
    if (!canCheck()) return { ok: false, reason: 'DEV_BUILD' };
    try {
      const r = await autoUpdater.checkForUpdates();
      const v = r && r.updateInfo ? r.updateInfo.version : null;
      const isNewer = v && v !== app.getVersion();
      return { ok: true, updateAvailable: !!isNewer, version: v };
    } catch (err) {
      return { ok: false, reason: 'CHECK_FAILED', message: (err && err.message) || String(err) };
    }
  });

  ipcMain.handle('updates:download', async () => {
    if (!updaterAvailable() || !canCheck()) return { ok: false, reason: 'UNSUPPORTED' };
    if (downloaded) return { ok: true, alreadyDownloaded: true };
    try {
      downloading = true;
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      downloading = false;
      return { ok: false, reason: 'DOWNLOAD_FAILED', message: (err && err.message) || String(err) };
    }
  });

  // Install now: quit, run the verified installer, relaunch on the new version.
  ipcMain.handle('updates:install', () => {
    if (!downloaded) return { ok: false, reason: 'NOT_DOWNLOADED' };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
}

function dispose() {
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;
}

module.exports = { init, dispose };
