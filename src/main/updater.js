'use strict';

/**
 * Auto-update via electron-updater + GitHub Releases. Release metadata is
 * fetched over HTTPS and the downloaded installer is verified against its
 * SHA512 before it can run. Nothing is downloaded without the user's consent.
 * A release is marked required by putting "[critical]" in its notes.
 */

const SIX_HOURS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY = 10 * 1000;

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (_) { autoUpdater = null; }

function isCritical(info) {
  const notes = info && info.releaseNotes;
  const text = Array.isArray(notes) ? notes.map((n) => (n && n.note) || '').join('\n') : String(notes || '');
  return /\[critical\]/i.test(text);
}

function createUpdater({ app, send, log }) {
  const state = { checking: false, downloading: false, downloaded: false, info: null, lastError: null };
  let timer = null;

  // The portable .exe can't replace itself; users download new versions instead.
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;

  const canCheck = () => {
    if (!autoUpdater || portable) return false;
    if (app.isPackaged) return true;
    if (process.env.RAM_TEST_UPDATES === '1') { autoUpdater.forceDevUpdateConfig = true; return true; }
    return false;
  };

  const payload = (info) => ({
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes,
    currentVersion: app.getVersion(),
    critical: isCritical(info),
  });

  function init() {
    if (!autoUpdater) { log.warn('electron-updater unavailable; updates disabled'); return; }
    autoUpdater.logger = { info: (m) => log.info(m), warn: (m) => log.warn(m), error: (m) => log.error(m), debug: () => {} };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => { state.checking = true; send({ status: 'checking' }); });
    autoUpdater.on('update-available', (info) => { state.checking = false; state.info = info; send({ status: 'available', ...payload(info) }); });
    autoUpdater.on('update-not-available', () => { state.checking = false; send({ status: 'not-available', currentVersion: app.getVersion() }); });
    autoUpdater.on('download-progress', (p) => {
      state.downloading = true;
      send({ status: 'downloading', percent: Math.round(p.percent || 0), transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond });
    });
    autoUpdater.on('update-downloaded', (info) => {
      state.downloading = false; state.downloaded = true; state.info = info;
      send({ status: 'downloaded', ...payload(info) });
    });
    autoUpdater.on('error', (err) => {
      state.checking = false; state.downloading = false;
      const message = String((err && err.message) || err).replace(/https?:\/\/\S+/g, '[url]').slice(0, 300);
      state.lastError = message;
      log.error('update error', message);
      send({ status: 'error', message });
    });

    if (canCheck()) {
      setTimeout(() => safeCheck(), STARTUP_DELAY);
      timer = setInterval(() => safeCheck(), SIX_HOURS);
    }
  }

  async function safeCheck() {
    // Once an update is downloaded it installs on quit; don't prompt again.
    if (!canCheck() || state.checking || state.downloading || state.downloaded) return;
    try { await autoUpdater.checkForUpdates(); } catch (e) { log.warn('update check failed', e.message); }
  }

  async function check() {
    if (!autoUpdater) return { ok: false, reason: 'UNSUPPORTED' };
    if (portable) return { ok: false, reason: 'PORTABLE' };
    if (!canCheck()) return { ok: false, reason: 'DEV_BUILD' };
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, updateAvailable: !!(r && r.isUpdateAvailable), version: r && r.updateInfo ? r.updateInfo.version : null };
    } catch (e) {
      return { ok: false, reason: 'CHECK_FAILED' };
    }
  }

  async function download() {
    if (!autoUpdater || !canCheck()) return { ok: false, reason: 'UNSUPPORTED' };
    if (state.downloaded) return { ok: true, alreadyDownloaded: true };
    if (state.downloading) return { ok: true, inProgress: true };
    try {
      state.downloading = true;
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      state.downloading = false;
      return { ok: false, reason: 'DOWNLOAD_FAILED' };
    }
  }

  function install(beforeQuit) {
    if (!state.downloaded) return { ok: false, reason: 'NOT_DOWNLOADED' };
    setImmediate(() => {
      try { beforeQuit(); } catch (_) { /* ignore */ }
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  }

  function getState() {
    return {
      supported: !!autoUpdater,
      portable,
      canCheck: canCheck(),
      checking: state.checking,
      downloading: state.downloading,
      downloaded: state.downloaded,
      version: app.getVersion(),
      pending: state.info ? payload(state.info) : null,
      lastError: state.lastError,
    };
  }

  function dispose() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { init, check, download, install, getState, dispose };
}

module.exports = { createUpdater };
