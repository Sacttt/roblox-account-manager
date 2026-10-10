'use strict';

const os = require('os');
const { detectLaunchers } = require('./roblox/detect');
const { HOSTS } = require('./roblox/api');
const { redact } = require('./redact');

async function collect({ app, paths, vault, accounts, multi, http, settings, logger, launcher }) {
  const found = detectLaunchers(app, { force: true });
  const sessionCounts = { valid: 0, expired: 0, unknown: 0, none: 0 };
  for (const a of accounts.accounts) sessionCounts[a.session.status] = (sessionCounts[a.session.status] || 0) + 1;
  const runningClients = (await multi.listRobloxPids()).length;

  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    system: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      locale: app.getLocale(),
    },
    storage: {
      dataDir: paths.dataDir,
      logFile: logger.getLogFile(),
      vault: vault.status(),
    },
    accounts: {
      total: accounts.accounts.length,
      sessions: sessionCounts,
      favorites: accounts.accounts.filter((a) => a.favorite).length,
      groups: [...new Set(accounts.accounts.map((a) => a.group).filter(Boolean))].length,
    },
    roblox: {
      protocolHandler: found.protocolHandler,
      clientVersion: found.clientVersion,
      clientFound: !!found.client,
      bloxstrap: !!found.bloxstrap,
      fishstrap: !!found.fishstrap,
      launcherSetting: settings.launcher,
      runningClients,
      multiRoblox: { enabled: settings.multiRoblox, ...multi.status() },
      launchBusy: launcher.status().busy,
    },
    network: { ...http.stats, lastErrorAt: http.stats.lastErrorAt ? new Date(http.stats.lastErrorAt).toISOString() : null },
  };
}

async function connectivity(api) {
  return Promise.all([HOSTS.USERS, HOSTS.THUMBS].map((h) => api.probe(h)));
}

function formatReport(info, probes) {
  const lines = ['Roblox Account Manager — diagnostics', JSON.stringify(info, null, 2)];
  if (probes) lines.push('Connectivity', JSON.stringify(probes, null, 2));
  return redact(lines.join('\n\n'));
}

module.exports = { collect, connectivity, formatReport };
