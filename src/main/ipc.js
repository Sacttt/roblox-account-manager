'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { ipcMain, dialog, shell, clipboard } = require('electron');
const settingsModel = require('./settings');
const { buildBackup, parseBackup } = require('./backup');
const diagnostics = require('./diagnostics');
const { parseGameTarget, describeTarget } = require('./roblox/launch-uri');
const { detectLaunchers } = require('./roblox/detect');
const { openWebLogin } = require('./web-login');
const { ORIGIN } = require('./protocol');

const EXTERNAL_ALLOW = [/^https:\/\/(www\.)?roblox\.com\//i, /^https:\/\/github\.com\/Sacttt\/roblox-account-manager/i, /^https:\/\/(www\.)?bloxstraplabs\.com\//i];

const isStr = (v, max = 10000) => typeof v === 'string' && v.length <= max;
const isId = (v) => typeof v === 'string' && /^[\w-]{3,64}$/.test(v);
const isIdList = (v) => Array.isArray(v) && v.length <= 5000 && v.every(isId);

function assert(cond, code = 'INVALID_INPUT') {
  if (!cond) throw new Error(code);
}

const ERROR_CODE = /^[A-Z][A-Z0-9_]*(:[\w.-]+)?$/;

function serializeError(e, log) {
  const raw = (e && (e.code || e.message)) || 'INTERNAL_ERROR';
  const code = ERROR_CODE.test(raw) ? raw : 'INTERNAL_ERROR';
  if (code === 'INTERNAL_ERROR') log.error('unexpected error', e && e.stack ? e.stack : e);
  const out = { code };
  if (e && e.accounts) out.accounts = e.accounts;
  if (e && e.accountId) out.accountId = e.accountId;
  if (e && e.launcher) out.launcher = e.launcher;
  return out;
}

function registerIpc(ctx) {
  const { app, log, getWindow, accounts, presets, activity, launcher, multi, vault, avatars, http, api, paths, updater, logger } = ctx;
  const pendingImports = new Map();

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      const win = getWindow();
      const frameUrl = event.senderFrame ? event.senderFrame.url : '';
      if (!win || event.sender !== win.webContents || !frameUrl.startsWith(`${ORIGIN}/`)) {
        log.warn(`blocked IPC ${channel} from untrusted sender`);
        return { ok: false, error: { code: 'FORBIDDEN' } };
      }
      try {
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        return { ok: false, error: serializeError(e, log) };
      }
    });
  };

  // ------------------------------------------------------------ app
  handle('app:bootstrap', () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    settings: ctx.getSettings(),
    accounts: accounts.list(),
    presets: presets.list(),
    activity: activity.list({ limit: 100 }),
    notes: [...accounts.loadNotes, ...ctx.startupNotes],
    vault: vault.status(),
    launch: launcher.status(),
    refreshing: accounts.isRefreshing,
    lastRefresh: accounts.lastRefreshResult,
    updates: updater.getState(),
  }));
  handle('app:open-external', (url) => {
    assert(isStr(url, 2000) && EXTERNAL_ALLOW.some((re) => re.test(url)), 'URL_NOT_ALLOWED');
    return shell.openExternal(url);
  });
  handle('app:quit', () => ctx.quit());

  // ------------------------------------------------------------ window
  handle('window:minimize', () => getWindow().minimize());
  handle('window:toggle-maximize', () => {
    const w = getWindow();
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return w.isMaximized();
  });
  handle('window:close', () => getWindow().close());

  // ------------------------------------------------------------ accounts
  handle('accounts:list', () => accounts.list());
  handle('accounts:preview-cookie', (cookie) => {
    assert(isStr(cookie, 10000));
    return accounts.previewCookie(cookie);
  });
  handle('accounts:add-cookie', (input) => {
    assert(input && typeof input === 'object' && isStr(input.cookie, 10000));
    return accounts.addFromCookie({
      cookie: input.cookie,
      nickname: isStr(input.nickname, 200) ? input.nickname : '',
      notes: isStr(input.notes, 8000) ? input.notes : '',
      group: isStr(input.group, 200) ? input.group : '',
      tags: Array.isArray(input.tags) ? input.tags.filter((t) => isStr(t, 100)).slice(0, 20) : [],
      updateExisting: input.updateExisting === true,
    });
  });
  handle('accounts:web-login', async (input = {}) => {
    const extra = input && typeof input === 'object' ? input : {};
    const result = await openWebLogin({
      parent: getWindow(),
      icon: ctx.iconPath,
      log,
      loginUrl: ctx.testLoginUrl || undefined,
      onCookie: (cookie) => accounts.addFromCookie({
        cookie,
        updateExisting: true,
        source: 'web',
        group: isStr(extra.group, 200) ? extra.group : '',
        nickname: isStr(extra.nickname, 200) ? extra.nickname : '',
      }),
    });
    const win = getWindow();
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
    return result;
  });
  handle('accounts:update', (id, patch) => { assert(isId(id)); return accounts.update(id, patch); });
  handle('accounts:bulk-update', (ids, op) => { assert(isIdList(ids)); return accounts.bulkUpdate(ids, op); });
  handle('accounts:rename-group', (from, to) => { assert(isStr(from, 100) && isStr(to, 100)); return accounts.renameGroup(from, to); });
  handle('accounts:remove', (ids) => { assert(isIdList(ids)); return accounts.remove(ids); });
  handle('accounts:set-session', (id, cookie) => { assert(isId(id) && isStr(cookie, 10000)); return accounts.setSession(id, cookie); });
  handle('accounts:clear-session', (id) => { assert(isId(id)); return accounts.clearSession(id); });
  handle('accounts:clear-all-sessions', () => accounts.clearAllSessions());
  handle('accounts:verify-session', (id) => { assert(isId(id)); return accounts.verifySession(id); });
  handle('accounts:verify-all-sessions', () => accounts.verifyAllSessions());
  handle('accounts:refresh', (opts = {}) => {
    const ids = opts && opts.ids ? opts.ids : null;
    assert(ids === null || isIdList(ids));
    return accounts.refresh({ ids, full: !!(opts && opts.full) });
  });
  handle('accounts:pick-icon', async (id) => {
    assert(isId(id));
    accounts.require(id);
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose an icon',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const stat = fs.statSync(r.filePaths[0]);
    if (stat.size > 2 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
    return accounts.setCustomIcon(id, fs.readFileSync(r.filePaths[0]));
  });
  handle('accounts:clear-icon', (id) => { assert(isId(id)); return accounts.clearCustomIcon(id); });
  handle('accounts:open-profile', (userId) => {
    assert(Number.isSafeInteger(userId) && userId > 0);
    return shell.openExternal(`https://www.roblox.com/users/${userId}/profile`);
  });

  // ------------------------------------------------------------ launching
  handle('launch:start', async (input) => {
    assert(input && typeof input === 'object' && isIdList(input.ids) && isStr(input.target, 500));
    const result = await launcher.launch({ ids: input.ids, target: input.target, force: input.force === true });
    ctx.rememberTarget(input.target);
    return result;
  });
  handle('launch:cancel', () => launcher.cancel());
  handle('launch:status', () => launcher.status());
  handle('launch:parse-target', (target) => {
    assert(isStr(target, 1000));
    const parsed = parseGameTarget(target);
    return parsed.error ? { error: parsed.error } : { ...parsed, label: describeTarget(parsed) };
  });

  // ------------------------------------------------------------ presets
  handle('presets:list', () => presets.list());
  handle('presets:upsert', (preset) => presets.upsert(preset));
  handle('presets:remove', (id) => { assert(isStr(id, 64)); return presets.remove(id); });
  handle('presets:reorder', (ids) => { assert(Array.isArray(ids)); return presets.reorder(ids); });

  // ------------------------------------------------------------ settings
  handle('settings:get', () => ctx.getSettings());
  handle('settings:update', (patch) => ctx.updateSettings(settingsModel.validatePatch(patch)));
  handle('settings:reset', () => ctx.updateSettings({ ...settingsModel.defaults(), onboardingDone: true }, { replace: true }));

  // ------------------------------------------------------------ roblox client
  handle('multi:status', async () => ({
    ...multi.status(),
    enabled: ctx.getSettings().multiRoblox,
    runningClients: (await multi.listRobloxPids()).length,
  }));
  handle('multi:set-enabled', async (enabled) => {
    assert(typeof enabled === 'boolean');
    ctx.updateSettings({ multiRoblox: enabled });
    if (!enabled) { multi.stop(); return multi.status(); }
    if (process.platform !== 'win32') return multi.status();
    return multi.ensureActive(paths.dataDir);
  });
  handle('roblox:close-all', async () => {
    const closed = await multi.closeAllRoblox();
    activity.add({ type: 'roblox.closed', message: closed ? `Closed ${closed} Roblox window(s)` : 'No Roblox windows were open' });
    if (ctx.getSettings().multiRoblox && process.platform === 'win32') {
      try { await multi.ensureActive(paths.dataDir); } catch (_) { /* retried on next launch */ }
    }
    return { closed, ...multi.status() };
  });
  handle('roblox:detect', () => {
    const found = detectLaunchers(app, { force: true });
    return {
      protocolHandler: found.protocolHandler,
      bloxstrap: !!found.bloxstrap,
      fishstrap: !!found.fishstrap,
      client: !!found.client,
      clientVersion: found.clientVersion,
      platformSupported: process.platform === 'win32',
    };
  });

  // ------------------------------------------------------------ activity
  handle('activity:list', (limit) => activity.list({ limit: Number.isInteger(limit) ? Math.min(limit, 500) : 200 }));
  handle('activity:clear', () => activity.clear());

  // ------------------------------------------------------------ data
  handle('data:export-backup', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(getWindow(), {
      title: 'Save backup',
      defaultPath: `roblox-account-manager-backup-${stamp}.json`,
      filters: [{ name: 'Backup', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const backup = buildBackup({
      appVersion: app.getVersion(),
      accounts: accounts.exportRecords(),
      settings: ctx.getSettings(),
      presets: presets.list(),
    });
    fs.writeFileSync(r.filePath, JSON.stringify(backup, null, 2), 'utf8');
    activity.add({ type: 'data.export', level: 'success', message: `Exported a backup of ${backup.accounts.length} account(s) (no sign-in cookies)` });
    return { path: r.filePath, count: backup.accounts.length };
  });
  handle('data:choose-import', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Import backup',
      properties: ['openFile'],
      filters: [{ name: 'Backup', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const stat = fs.statSync(r.filePaths[0]);
    if (stat.size > 10 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
    const parsed = parseBackup(fs.readFileSync(r.filePaths[0], 'utf8'));
    const token = crypto.randomBytes(8).toString('hex');
    pendingImports.clear();
    pendingImports.set(token, parsed);
    const existing = parsed.accounts.filter((rec) => accounts.findByUserId(Number(rec.userId))).length;
    return {
      token,
      file: r.filePaths[0],
      accounts: parsed.accounts.length,
      existing,
      hasSettings: !!parsed.settings,
      presets: parsed.presets ? parsed.presets.length : 0,
      warnings: parsed.warnings,
    };
  });
  handle('data:apply-import', (token, opts = {}) => {
    assert(isStr(token, 32) && pendingImports.has(token), 'IMPORT_EXPIRED');
    const parsed = pendingImports.get(token);
    pendingImports.delete(token);
    const summary = accounts.importRecords(parsed.accounts, { mergeExisting: opts.mergeExisting === true });
    if (opts.includeSettings && parsed.settings) {
      const next = settingsModel.normalize({ ...ctx.getSettings(), ...parsed.settings });
      ctx.updateSettings(next, { replace: true });
      summary.settings = true;
    }
    if (opts.includePresets && parsed.presets) {
      presets.replaceAll(parsed.presets);
      summary.presets = presets.list().length;
    }
    activity.add({
      type: 'data.import', level: 'success',
      message: `Imported backup: ${summary.added} added, ${summary.merged} merged, ${summary.skipped} skipped${summary.invalid ? `, ${summary.invalid} invalid` : ''}`,
    });
    return summary;
  });
  handle('data:open-folder', () => shell.openPath(paths.dataDir));
  handle('data:clear-avatar-cache', () => {
    const removed = avatars.clearCache();
    accounts.emitChanged(accounts.accounts);
    return removed;
  });
  handle('data:cache-size', () => avatars.cacheSize());

  // ------------------------------------------------------------ diagnostics
  const collect = () => diagnostics.collect({ app, paths, vault, accounts, multi, http, settings: ctx.getSettings(), logger, launcher });
  handle('diag:collect', collect);
  handle('diag:connectivity', () => diagnostics.connectivity(api));
  handle('diag:copy-report', async () => {
    const info = await collect();
    const probes = await diagnostics.connectivity(api);
    clipboard.writeText(diagnostics.formatReport(info, probes));
    return true;
  });
  handle('diag:log-tail', () => logger.readTail(48 * 1024));
  handle('diag:open-logs', () => shell.openPath(paths.logDir));

  // ------------------------------------------------------------ updates
  handle('updates:state', () => updater.getState());
  handle('updates:check', () => updater.check());
  handle('updates:download', () => updater.download());
  handle('updates:install', () => updater.install(() => ctx.prepareForQuit()));
}

module.exports = { registerIpc, serializeError };
