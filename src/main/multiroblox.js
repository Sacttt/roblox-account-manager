'use strict';

/**
 * Multi Roblox (Windows): lets several Roblox clients run at once.
 *
 * Before the first client starts, a hidden PowerShell helper creates and holds
 * Roblox's singleton mutexes, so each new client sees them already taken and
 * does not close the others. It also locks RobloxCookies.dat so clients cannot
 * overwrite each other's login state ("error 773").
 *
 * The helper exits by itself when this app closes (its stdin pipe closes),
 * releasing everything. Its script file is deleted as soon as it has loaded.
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SINGLETON_NAMES = ['ROBLOX_singletonEvent', 'ROBLOX_singletonMutex', 'ROBLOX_SingletonEvent'];

const HELPER_PS1 = `
$ErrorActionPreference = 'Continue'
function Say($m) { [Console]::Out.WriteLine($m); [Console]::Out.Flush() }
$held = New-Object System.Collections.ArrayList
foreach ($n in @(${SINGLETON_NAMES.map((n) => `'${n}'`).join(',')})) {
  try {
    $created = $false
    $m = New-Object System.Threading.Mutex($true, $n, [ref]$created)
    [void]$held.Add(@{ Mutex = $m; Owned = $created })
    Say ("MUTEX " + $n + " owned=" + $created)
  } catch { Say ("MUTEXFAIL " + $n + " " + $_.Exception.Message) }
}
$fs = $null
$cookiePath = $null
if ($env:LOCALAPPDATA) { $cookiePath = Join-Path $env:LOCALAPPDATA 'Roblox\\LocalStorage\\RobloxCookies.dat' }
if ($cookiePath -and (Test-Path -LiteralPath $cookiePath)) {
  try {
    $fs = [System.IO.File]::Open($cookiePath, 'Open', 'ReadWrite', 'ReadWrite')
    $len = [Math]::Max([long]1, $fs.Length)
    $fs.Lock(0, $len)
    Say "COOKIELOCK ok"
  } catch { Say ("COOKIELOCK fail " + $_.Exception.Message) }
} else { Say "COOKIELOCK skipped" }
Say "READY"
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'STOP') { break }
}
if ($fs) { try { $fs.Close() } catch {} }
foreach ($h in $held) {
  try { if ($h.Owned) { $h.Mutex.ReleaseMutex() } } catch {}
  try { $h.Mutex.Dispose() } catch {}
}
Say "STOPPED"
`;

const isWindows = () => process.platform === 'win32';

let helper = null;
let helperState = null;
let starting = null;
let lastError = null;

function listRobloxPids() {
  return new Promise((resolve) => {
    if (!isWindows()) { resolve([]); return; }
    execFile('tasklist', ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      const pids = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^"RobloxPlayerBeta\.exe","(\d+)"/i);
        if (m) pids.push(Number(m[1]));
      }
      resolve(pids);
    });
  });
}

const taskkill = (args) => new Promise((resolve) => {
  execFile('taskkill', args, { windowsHide: true, timeout: 15000 }, () => resolve());
});

async function waitForExit(maxMs) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    if (!(await listRobloxPids()).length) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * Asks Roblox clients to close (so they can disconnect cleanly), then forces
 * any that remain. Returns how many clients were running.
 */
async function closeAllRoblox() {
  if (!isWindows()) return 0;
  const before = await listRobloxPids();
  if (!before.length) return 0;
  await taskkill(['/IM', 'RobloxPlayerBeta.exe']);
  if (!(await waitForExit(2500))) {
    await taskkill(['/F', '/T', '/IM', 'RobloxPlayerBeta.exe']);
    await waitForExit(8000);
  }
  return before.length;
}

function isActive() {
  return !!(helper && helper.exitCode === null && helperState && helperState.readyAt);
}

function status() {
  return {
    supported: isWindows(),
    active: isActive(),
    starting: !!starting,
    mutexes: helperState ? helperState.mutexes : [],
    cookieLock: helperState ? helperState.cookieLock : null,
    lastError,
  };
}

/**
 * Starts the helper if needed. Throws ROBLOX_ALREADY_RUNNING when a client is
 * open, because the mutex must be taken before the first client starts.
 */
async function ensureActive(dataDir) {
  if (!isWindows() || isActive()) return status();
  if (starting) return starting;

  starting = (async () => {
    const running = await listRobloxPids();
    if (running.length) {
      const err = new Error('ROBLOX_ALREADY_RUNNING');
      err.pids = running;
      throw err;
    }

    // PowerShell cannot run a script from inside app.asar, so write it out
    // briefly; it is removed once the helper has loaded it.
    const scriptPath = path.join(dataDir, `multiroblox-helper-${process.pid}.ps1`);
    fs.writeFileSync(scriptPath, HELPER_PS1, 'utf8');

    const state = { mutexes: [], cookieLock: null, readyAt: null };
    helperState = state;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    helper = child;

    try {
      await new Promise((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error('MULTI_ROBLOX_TIMEOUT')), 15000);
        child.stdout.on('data', (d) => {
          buf += d.toString();
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            const mutex = line.match(/^MUTEX (\S+) owned=(\S+)/);
            if (mutex) state.mutexes.push({ name: mutex[1], owned: /true/i.test(mutex[2]) });
            else if (line.startsWith('COOKIELOCK')) state.cookieLock = line.slice('COOKIELOCK '.length);
            else if (line === 'READY') {
              clearTimeout(timer);
              state.readyAt = Date.now();
              resolve();
            }
          }
        });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('exit', (code) => {
          clearTimeout(timer);
          if (!state.readyAt) reject(new Error(`MULTI_ROBLOX_HELPER_EXIT_${code}`));
          if (helper === child) { helper = null; helperState = null; }
        });
      });
    } finally {
      try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* ignore */ }
    }

    if (!state.mutexes.length) throw new Error('MULTI_ROBLOX_MUTEX_FAILED');
    lastError = null;
    return status();
  })();

  try {
    return await starting;
  } catch (e) {
    lastError = e.message;
    stop();
    throw e;
  } finally {
    starting = null;
  }
}

function stop() {
  const h = helper;
  if (h && h.exitCode === null) {
    try { h.stdin.write('STOP\n'); } catch (_) { /* ignore */ }
    setTimeout(() => { try { if (h.exitCode === null) h.kill(); } catch (_) { /* ignore */ } }, 1500);
  }
  helper = null;
  helperState = null;
}

/** Removes helper scripts left behind by older versions or crashes. */
function cleanupStaleScripts(dataDir) {
  try {
    for (const f of fs.readdirSync(dataDir)) {
      if (/^multiroblox-helper.*\.ps1$/i.test(f)) fs.rmSync(path.join(dataDir, f), { force: true });
    }
  } catch (_) { /* ignore */ }
}

module.exports = { ensureActive, stop, status, listRobloxPids, closeAllRoblox, isActive, cleanupStaleScripts };
