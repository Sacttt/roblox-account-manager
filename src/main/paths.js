'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR_NAME = 'roblox-account-manager';
// Older builds could also have run with the product name as the app name.
const LEGACY_DIR_NAMES = ['Roblox Account Manager'];

/**
 * Pins the data directory so renaming files or adding a productName to
 * package.json can never orphan existing users' accounts. Must run before
 * the app is ready.
 */
function configureUserData(app) {
  const override = process.env.RAM_USER_DATA_DIR;
  if (override) {
    app.setPath('userData', path.resolve(override));
    return app.getPath('userData');
  }
  const appData = app.getPath('appData');
  let dir = path.join(appData, APP_DIR_NAME);
  if (!fs.existsSync(path.join(dir, 'accounts.json'))) {
    for (const name of LEGACY_DIR_NAMES) {
      const legacy = path.join(appData, name);
      if (fs.existsSync(path.join(legacy, 'accounts.json'))) { dir = legacy; break; }
    }
  }
  app.setPath('userData', dir);
  return dir;
}

function dataPaths(dataDir) {
  return {
    dataDir,
    accounts: path.join(dataDir, 'accounts.json'),
    secrets: path.join(dataDir, 'secrets.json'),
    settings: path.join(dataDir, 'settings.json'),
    presets: path.join(dataDir, 'presets.json'),
    activity: path.join(dataDir, 'activity.json'),
    avatarDir: path.join(dataDir, 'avatar-cache'),
    avatarMeta: path.join(dataDir, 'avatar-meta.json'),
    customIconDir: path.join(dataDir, 'custom-icons'),
    logDir: path.join(dataDir, 'logs'),
    legacyHelperScript: path.join(dataDir, 'multiroblox-helper.ps1'),
  };
}

module.exports = { configureUserData, dataPaths, APP_DIR_NAME };
