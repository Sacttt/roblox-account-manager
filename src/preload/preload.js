'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:bootstrap', 'app:open-external', 'app:quit',
  'window:minimize', 'window:toggle-maximize', 'window:close',
  'accounts:list', 'accounts:preview-cookie', 'accounts:add-cookie', 'accounts:web-login', 'accounts:update',
  'accounts:bulk-update', 'accounts:rename-group', 'accounts:remove', 'accounts:set-session', 'accounts:clear-session',
  'accounts:clear-all-sessions', 'accounts:verify-session', 'accounts:verify-all-sessions', 'accounts:refresh',
  'accounts:pick-icon', 'accounts:clear-icon', 'accounts:open-profile',
  'launch:start', 'launch:cancel', 'launch:status', 'launch:parse-target',
  'presets:list', 'presets:upsert', 'presets:remove', 'presets:reorder',
  'settings:get', 'settings:update', 'settings:reset',
  'multi:status', 'multi:set-enabled', 'roblox:close-all', 'roblox:detect',
  'activity:list', 'activity:clear',
  'data:export-backup', 'data:choose-import', 'data:apply-import', 'data:open-folder', 'data:clear-avatar-cache', 'data:cache-size',
  'diag:collect', 'diag:connectivity', 'diag:copy-report', 'diag:log-tail', 'diag:open-logs',
  'updates:state', 'updates:check', 'updates:download', 'updates:install',
]);

const EVENTS = new Set([
  'accounts:changed', 'accounts:removed', 'presets:changed', 'activity:entry', 'settings:changed',
  'launch:progress', 'launch:finished', 'refresh:state', 'updates:status', 'window:maximized', 'app:notice',
]);

contextBridge.exposeInMainWorld('ram', {
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(event, callback) {
    if (!EVENTS.has(event) || typeof callback !== 'function') return () => {};
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
