'use strict';

const { app, BrowserWindow, Menu, Tray, Notification, globalShortcut, protocol, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const { configureUserData, dataPaths } = require('./paths');
const logger = require('./logger');
const { readJSON, writeJSON } = require('./json-store');
const settingsModel = require('./settings');
const { Vault } = require('./vault');
const { RobloxHttp } = require('./roblox/http');
const { RobloxApi } = require('./roblox/api');
const { AvatarStore } = require('./avatars');
const { ActivityLog } = require('./activity');
const { AccountService } = require('./accounts');
const { PresetStore } = require('./presets');
const { LaunchService } = require('./launcher');
const multi = require('./multiroblox');
const { createUpdater } = require('./updater');
const { privilegedSchemes, registerAppProtocol, ORIGIN } = require('./protocol');
const { registerIpc } = require('./ipc');

const TEST_MODE = !app.isPackaged && process.env.RAM_TEST_MODE === '1';
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icon.ico');

protocol.registerSchemesAsPrivileged(privilegedSchemes());
const dataDir = configureUserData(app);
const paths = dataPaths(dataDir);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  logger.init(paths.logDir, { level: process.env.RAM_LOG_LEVEL || 'info' });
  const log = logger.scoped('main');
  log.info(`starting v${app.getVersion()} (electron ${process.versions.electron}) data=${dataDir}`);

  process.on('uncaughtException', (e) => {
    log.error('uncaught exception', e && e.stack ? e.stack : e);
    if (!mainWindow && !tray) app.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    log.error('unhandled rejection', e && e.stack ? e.stack : e);
    if (!mainWindow && !tray) app.exit(1);
  });

  let mainWindow = null;
  let tray = null;
  let quitting = false;
  let shownTrayHint = false;
  let presenceTimer = null;
  let profileTimer = null;
  let registeredHotkey = '';
  const startupNotes = [];

  // ---------------------------------------------------------------- settings
  const settingsRead = readJSON(paths.settings, {});
  if (settingsRead.data && typeof settingsRead.data === 'object' && settingsRead.data.schemaVersion !== 2 && Object.keys(settingsRead.data).length) {
    // Older settings may hold things this version no longer uses (e.g. custom
    // themes); keep a copy so nothing a user made is lost.
    const backupFile = paths.settings.replace(/\.json$/, '.pre-v2-backup.json');
    if (!fs.existsSync(backupFile)) {
      try { writeJSON(backupFile, settingsRead.data, { backup: false }); } catch (e) { log.warn('could not back up old settings', e.message); }
    }
  }
  let settings = settingsModel.migrate(settingsRead.data);
  if (settingsRead.source === 'backup') startupNotes.push('Settings were damaged and have been restored from a backup.');
  if (settingsRead.source === 'default' && settingsRead.recoveredFrom) startupNotes.push('Settings were damaged and have been reset to defaults.');
  const saveSettings = () => {
    try { writeJSON(paths.settings, settingsModel.toDisk(settings)); } catch (e) { log.error('failed to save settings', e); }
  };
  saveSettings();
  const getSettings = () => ({ ...settings });

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  // ---------------------------------------------------------------- services (created on ready)
  let ctx = null;

  function updateSettings(patch, { replace = false } = {}) {
    const prev = settings;
    settings = replace ? settingsModel.normalize(patch) : settingsModel.normalize({ ...settings, ...patch });
    saveSettings();
    if (prev.presenceRefreshMinutes !== settings.presenceRefreshMinutes || prev.profileRefreshHours !== settings.profileRefreshHours) scheduleSync();
    if (prev.globalHotkey !== settings.globalHotkey) registerHotkey();
    if (prev.launchAtStartup !== settings.launchAtStartup || prev.startMinimized !== settings.startMinimized) applyLoginItem();
    if (prev.lastGameTarget !== settings.lastGameTarget) rebuildTrayMenu();
    send('settings:changed', getSettings());
    return getSettings();
  }

  function rememberTarget(target) {
    const t = String(target || '').trim();
    if (!t) return;
    const recent = [t, ...settings.recentTargets.filter((x) => x !== t)].slice(0, 10);
    updateSettings({ lastGameTarget: t, recentTargets: recent });
    if (ctx) ctx.presets.touch(t);
  }

  function applyLoginItem() {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    try {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup, args: settings.startMinimized ? ['--hidden'] : [] });
    } catch (e) { log.warn('could not update startup setting', e.message); }
  }

  function registerHotkey() {
    if (registeredHotkey) { try { globalShortcut.unregister(registeredHotkey); } catch (_) { /* ignore */ } registeredHotkey = ''; }
    if (!settings.globalHotkey) return;
    try {
      const ok = globalShortcut.register(settings.globalHotkey, toggleWindow);
      if (ok) registeredHotkey = settings.globalHotkey;
      else send('app:notice', { level: 'warning', message: `The shortcut ${settings.globalHotkey} is already used by another app.` });
    } catch (_) {
      send('app:notice', { level: 'warning', message: `"${settings.globalHotkey}" is not a valid shortcut.` });
    }
  }

  function scheduleSync() {
    if (presenceTimer) clearInterval(presenceTimer);
    if (profileTimer) clearInterval(profileTimer);
    presenceTimer = profileTimer = null;
    if (!ctx) return;
    const { accounts } = ctx;
    if (settings.presenceRefreshMinutes > 0) {
      presenceTimer = setInterval(() => {
        if (accounts.accounts.length && !accounts.isRefreshing) accounts.refresh({ presenceOnly: true }).catch(() => {});
      }, settings.presenceRefreshMinutes * 60 * 1000);
    }
    if (settings.profileRefreshHours > 0) {
      profileTimer = setInterval(() => {
        if (accounts.accounts.length) accounts.refresh({}).catch(() => {});
      }, settings.profileRefreshHours * 60 * 60 * 1000);
    }
  }

  // ---------------------------------------------------------------- window
  const windowStateFile = path.join(dataDir, 'window-state.json');
  function loadWindowState() {
    const { data } = readJSON(windowStateFile, {});
    const s = data && typeof data === 'object' ? data : {};
    const ok = (n, min) => Number.isInteger(n) && n >= min;
    return {
      width: ok(s.width, 960) ? s.width : 1320,
      height: ok(s.height, 620) ? s.height : 860,
      x: Number.isInteger(s.x) ? s.x : undefined,
      y: Number.isInteger(s.y) ? s.y : undefined,
      maximized: s.maximized === true,
    };
  }
  function saveWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getNormalBounds();
    try { writeJSON(windowStateFile, { ...b, maximized: mainWindow.isMaximized() }, { backup: false }); } catch (_) { /* ignore */ }
  }

  function createWindow() {
    const state = loadWindowState();
    mainWindow = new BrowserWindow({
      width: state.width,
      height: state.height,
      x: state.x,
      y: state.y,
      minWidth: 960,
      minHeight: 620,
      backgroundColor: '#0d0e12',
      title: 'Roblox Account Manager',
      frame: false,
      show: false,
      icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
        devTools: !app.isPackaged || process.env.RAM_DEVTOOLS === '1',
      },
    });
    if (state.maximized) mainWindow.maximize();

    const wc = mainWindow.webContents;
    wc.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault(); });
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
    wc.on('render-process-gone', (_e, details) => {
      log.error(`renderer gone: ${details.reason}`);
      if (details.reason !== 'clean-exit' && !quitting) setTimeout(() => mainWindow && !mainWindow.isDestroyed() && mainWindow.reload(), 500);
    });

    mainWindow.on('maximize', () => send('window:maximized', true));
    mainWindow.on('unmaximize', () => send('window:maximized', false));
    mainWindow.on('resize', debounce(saveWindowState, 400));
    mainWindow.on('move', debounce(saveWindowState, 400));
    mainWindow.on('close', (e) => {
      saveWindowState();
      if (!quitting && settings.closeToTray && tray) {
        e.preventDefault();
        mainWindow.hide();
        if (!shownTrayHint && Notification.isSupported() && settings.notifications) {
          shownTrayHint = true;
          new Notification({ title: 'Still running', body: 'Roblox Account Manager is in the system tray. Right-click its icon to quit.', silent: true }).show();
        }
      }
    });

    const startHidden = process.argv.includes('--hidden') && settings.startMinimized && !TEST_MODE;
    mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });
    mainWindow.loadURL(`${ORIGIN}/index.html`);
  }

  function showWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function toggleWindow() {
    if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showWindow();
  }

  // ---------------------------------------------------------------- tray
  function createTray() {
    if (TEST_MODE || !fs.existsSync(ICON_PATH)) return;
    try {
      tray = new Tray(ICON_PATH);
      tray.setToolTip('Roblox Account Manager');
      tray.on('click', toggleWindow);
      rebuildTrayMenu();
    } catch (e) {
      log.warn('tray unavailable', e.message);
      tray = null;
    }
  }

  const rebuildTrayMenu = debounce(() => {
    if (!tray || !ctx) return;
    const target = settings.lastGameTarget;
    const favorites = ctx.accounts.accounts.filter((a) => a.favorite && ctx.vault.has(a.id)).slice(0, 10);
    const quick = favorites.length
      ? favorites.map((a) => ({
        label: a.nickname || a.displayName || a.username,
        enabled: !!target,
        click: () => quickLaunch(a.id),
      }))
      : [{ label: 'Star accounts to launch them from here', enabled: false }];
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Roblox Account Manager', click: showWindow },
      { type: 'separator' },
      { label: target ? 'Quick launch (last game)' : 'Quick launch (pick a game first)', enabled: false },
      ...quick,
      { type: 'separator' },
      { label: 'Close all Roblox windows', click: () => multi.closeAllRoblox().catch(() => {}) },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]));
  }, 200);

  async function quickLaunch(id) {
    try {
      await ctx.launcher.launch({ ids: [id], target: settings.lastGameTarget, force: true });
    } catch (e) {
      const code = e.code || e.message;
      if (Notification.isSupported()) new Notification({ title: 'Launch failed', body: `Open the app for details (${code}).`, silent: true }).show();
      send('app:notice', { level: 'error', code });
    }
  }

  // ---------------------------------------------------------------- lifecycle
  function prepareForQuit() {
    quitting = true;
    saveWindowState();
    if (ctx) {
      ctx.accounts.flush();
      ctx.activity.flush();
      ctx.updater.dispose();
    }
    multi.stop();
    try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
    if (presenceTimer) clearInterval(presenceTimer);
    if (profileTimer) clearInterval(profileTimer);
  }

  function quit() {
    prepareForQuit();
    app.quit();
  }

  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => prepareForQuit());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' || quitting) app.quit(); });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  app.whenReady().then(() => {
    const http = new RobloxHttp({ log: logger.scoped('roblox'), testOrigin: TEST_MODE ? process.env.RAM_TEST_ROBLOX_ORIGIN || null : null });
    const api = new RobloxApi(http);
    const vault = new Vault({ file: paths.secrets, safeStorage, log: logger.scoped('vault'), allowInsecureTestCodec: TEST_MODE });
    vault.load();
    const avatars = new AvatarStore({ avatarDir: paths.avatarDir, metaFile: paths.avatarMeta, iconDir: paths.customIconDir, api, log: logger.scoped('avatars') });
    const activity = new ActivityLog({ file: paths.activity, log });
    const accounts = new AccountService({ paths, vault, api, avatars, activity, log: logger.scoped('accounts'), getSettings });
    accounts.on('error', (e) => log.error('accounts error', e));
    accounts.on('save-error', (e) => log.error('accounts save error', e));
    accounts.load();
    if (!vault.persistent) startupNotes.push('Windows encryption is unavailable, so saved sign-ins will only be kept until the app closes.');
    const presets = new PresetStore({ file: paths.presets, log });
    const launcher = new LaunchService({
      app, shell, accounts, api, multi, getSettings, dataDir, activity, log: logger.scoped('launch'),
      testSink: TEST_MODE ? process.env.RAM_TEST_LAUNCH_SINK || null : null,
    });
    const updater = createUpdater({ app, send: (p) => send('updates:status', p), log: logger.scoped('updater') });

    ctx = {
      app, log, logger, paths, vault, http, api, avatars, activity, accounts, presets, launcher, multi, updater,
      iconPath: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
      testLoginUrl: TEST_MODE ? process.env.RAM_TEST_LOGIN_URL || null : null,
      startupNotes,
      getWindow: () => mainWindow,
      getSettings,
      updateSettings,
      rememberTarget,
      prepareForQuit,
      quit,
    };

    accounts.on('changed', (list) => { send('accounts:changed', list); rebuildTrayMenu(); });
    accounts.on('removed', (ids) => { send('accounts:removed', ids); rebuildTrayMenu(); });
    accounts.on('refresh-state', (s) => send('refresh:state', { ...s, result: s.running ? null : accounts.lastRefreshResult }));
    presets.on('changed', (list) => send('presets:changed', list));
    activity.on('entry', (entry) => send('activity:entry', entry));
    launcher.on('progress', (p) => send('launch:progress', p));
    launcher.on('finished', (f) => {
      send('launch:finished', f);
      const focused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
      if (!focused && settings.notifications && Notification.isSupported() && f.total > 1) {
        new Notification({ title: 'Launch Together finished', body: `${f.okCount} of ${f.total} account(s) opened.`, silent: true }).show();
      }
    });

    registerAppProtocol(protocol, { avatars });
    registerIpc(ctx);
    multi.cleanupStaleScripts(dataDir);
    if (settings.multiRoblox && process.platform === 'win32' && !TEST_MODE) {
      multi.ensureActive(dataDir).catch((e) => log.info(`multi roblox not started yet: ${e.message}`));
    }

    createWindow();
    createTray();
    registerHotkey();
    applyLoginItem();
    if (!TEST_MODE) updater.init();
    scheduleSync();

    // First background refresh once the UI is up.
    setTimeout(() => {
      if (accounts.accounts.length) accounts.refresh({}).catch(() => {});
    }, TEST_MODE ? 300 : 2500);
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}
