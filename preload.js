const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listAccounts:       ()                    => ipcRenderer.invoke('accounts:list'),
  addAccount:         (data)                => ipcRenderer.invoke('accounts:add', data),
  addWithCookie:      (data)                => ipcRenderer.invoke('accounts:addWithCookie', data),
  setCookie:          (id, cookie)          => ipcRenderer.invoke('accounts:setCookie', { id, cookie }),
  validateCookie:     (cookie)              => ipcRenderer.invoke('accounts:validateCookie', cookie),
  startWebLogin:      ()                    => ipcRenderer.invoke('accounts:startWebLogin'),
  updateAccount:      (id, patch)           => ipcRenderer.invoke('accounts:update', { id, patch }),
  removeAccount:      (id)                  => ipcRenderer.invoke('accounts:remove', id),
  refreshAccount:     (id)                  => ipcRenderer.invoke('accounts:refresh', id),
  refreshAllAccounts: ()                    => ipcRenderer.invoke('accounts:refreshAll'),
  launchAccount:      (id, targetUrl)       => ipcRenderer.invoke('accounts:launch', { id, targetUrl }),
  launchMany:         (ids, targetUrl)      => ipcRenderer.invoke('accounts:launchMany', { ids, targetUrl }),
  onLaunchProgress:   (cb)                  => ipcRenderer.on('launch:progress', (_e, data) => cb(data)),

  multiStatus:        ()                    => ipcRenderer.invoke('multi:status'),
  enableMulti:        ()                    => ipcRenderer.invoke('multi:enable'),
  disableMulti:       ()                    => ipcRenderer.invoke('multi:disable'),
  closeAllRoblox:     ()                    => ipcRenderer.invoke('roblox:closeAll'),
  openProfile:        (userId)              => ipcRenderer.invoke('accounts:openProfile', userId),
  exportAccounts:     ()                    => ipcRenderer.invoke('accounts:export'),
  importAccounts:     (json)                => ipcRenderer.invoke('accounts:import', json),

  listPresets:        ()                    => ipcRenderer.invoke('presets:list'),
  savePresets:        (presets)             => ipcRenderer.invoke('presets:save', presets),

  getSettings:        ()                    => ipcRenderer.invoke('settings:get'),
  updateSettings:     (patch)               => ipcRenderer.invoke('settings:update', patch),

  clearCache:         ()                    => ipcRenderer.invoke('cache:clear'),
  cacheSize:          ()                    => ipcRenderer.invoke('cache:size'),
  openDataFolder:     ()                    => ipcRenderer.invoke('data:openFolder'),

  minimizeWindow:     ()                    => ipcRenderer.invoke('window:minimize'),
  maximizeWindow:     ()                    => ipcRenderer.invoke('window:maximize'),
  closeWindow:        ()                    => ipcRenderer.invoke('window:close'),

  // ----- Auto-update -----
  getVersion:         ()                    => ipcRenderer.invoke('updates:getVersion'),
  updateState:        ()                    => ipcRenderer.invoke('updates:getState'),
  checkForUpdates:    ()                    => ipcRenderer.invoke('updates:check'),
  downloadUpdate:     ()                    => ipcRenderer.invoke('updates:download'),
  installUpdate:      ()                    => ipcRenderer.invoke('updates:install'),
  onUpdateStatus:     (cb)                  => ipcRenderer.on('updates:status', (_e, data) => cb(data))
});
