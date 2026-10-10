'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_MS = 30 * 1000;
let cached = null;

function localAppData(...parts) {
  return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, ...parts) : null;
}

function newestClient(dirs) {
  let best = null;
  for (const dir of dirs.filter(Boolean)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      if (!name.startsWith('version-')) continue;
      const exe = path.join(dir, name, 'RobloxPlayerBeta.exe');
      try {
        if (!fs.existsSync(exe)) continue;
        const mtime = fs.statSync(exe).mtimeMs;
        if (!best || mtime > best.mtime) best = { exe, version: name, mtime };
      } catch (_) { /* skip */ }
    }
  }
  return best;
}

/**
 * Finds what can open Roblox on this PC: the registered roblox-player
 * protocol handler, Bloxstrap/Fishstrap, and the newest RobloxPlayerBeta.exe.
 */
function detectLaunchers(app, { force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = { protocolHandler: null, bloxstrap: null, fishstrap: null, client: null, clientVersion: null };
  if (process.platform === 'win32') {
    try { value.protocolHandler = app.getApplicationNameForProtocol('roblox-player://') || null; } catch (_) { /* n/a */ }
    for (const [key, name] of [['bloxstrap', 'Bloxstrap'], ['fishstrap', 'Fishstrap']]) {
      const exe = localAppData(name, `${name}.exe`);
      if (exe && fs.existsSync(exe)) value[key] = exe;
    }
    const client = newestClient([
      localAppData('Roblox', 'Versions'),
      process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Roblox', 'Versions') : null,
      localAppData('Bloxstrap', 'Versions'),
      localAppData('Fishstrap', 'Versions'),
    ]);
    if (client) { value.client = client.exe; value.clientVersion = client.version; }
  }
  cached = { at: Date.now(), value };
  return value;
}

/** Resolves the user's launcher preference to a concrete launcher. */
function resolveLauncher(choice, found) {
  if (choice === 'auto') {
    if (found.bloxstrap) return { kind: 'bloxstrap', exe: found.bloxstrap };
    if (found.fishstrap) return { kind: 'fishstrap', exe: found.fishstrap };
    return { kind: 'default' };
  }
  if (choice === 'default') return { kind: 'default' };
  if (!found[choice]) {
    const err = new Error('LAUNCHER_NOT_FOUND');
    err.launcher = choice;
    throw err;
  }
  return { kind: choice, exe: found[choice] };
}

module.exports = { detectLaunchers, resolveLauncher };
