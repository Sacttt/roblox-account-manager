'use strict';
/**
 * Multi Roblox (Windows) — lets several Roblox clients run at once.
 *
 * How it works (same approach as evanovar/RobloxAccountManager "default mode"):
 *  1. BEFORE any Roblox client starts, we create and hold Roblox's singleton
 *     mutexes. When each new client starts it finds the object already
 *     exists, so it doesn't treat itself as "the one instance" and doesn't
 *     shut down other clients.
 *  2. We lock %LOCALAPPDATA%\Roblox\LocalStorage\RobloxCookies.dat so clients
 *     can't overwrite each other's login state (this is the "Error 773" fix).
 *
 * Node can't call CreateMutexW without a native module, so a small hidden
 * PowerShell helper does it and keeps the handles open. It exits on its own
 * when this app closes (its stdin pipe closes), which releases everything.
 *
 * Why the old version never worked: the previous script opened the mutex
 * in its OWN process and closed that handle, which does nothing to Roblox's
 * handle. The mutex has to be held before the first client launches.
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

let helper = null;          // ChildProcess
let helperState = null;     // { mutexes: [], cookieLock: string, readyAt }
let starting = null;        // Promise while starting

function isWindows() {
  return process.platform === 'win32';
}

/** Returns PIDs of running Roblox game clients. */
function listRobloxPids() {
  return new Promise((resolve) => {
    if (!isWindows()) return resolve([]);
    execFile('tasklist', ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const pids = [];
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.match(/^"RobloxPlayerBeta\.exe","(\d+)"/i);
          if (m) pids.push(Number(m[1]));
        }
        resolve(pids);
      });
  });
}

function closeAllRoblox() {
  return new Promise((resolve) => {
    if (!isWindows()) return resolve(0);
    listRobloxPids().then((before) => {
      if (before.length === 0) return resolve(0);
      execFile('taskkill', ['/F', '/T', '/IM', 'RobloxPlayerBeta.exe'], { windowsHide: true }, async () => {
        // give Windows a moment to tear the processes down
        for (let i = 0; i < 12; i++) {
          if ((await listRobloxPids()).length === 0) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        resolve(before.length);
      });
    });
  });
}

function isActive() {
  return !!(helper && helper.exitCode === null && helperState && helperState.readyAt);
}

function status() {
  return {
    supported: isWindows(),
    active: isActive(),
    mutexes: helperState ? helperState.mutexes : [],
    cookieLock: helperState ? helperState.cookieLock : null
  };
}

/**
 * Starts the helper if it isn't running. Throws ROBLOX_ALREADY_RUNNING if a
 * Roblox client is open, because the mutex must be taken before the first
 * client starts (same rule as evanovar's default mode).
 */
async function ensureActive(dataDir) {
  if (!isWindows()) return status();
  if (isActive()) return status();
  if (starting) return starting;

  starting = (async () => {
    const running = await listRobloxPids();
    if (running.length > 0) {
      const err = new Error('ROBLOX_ALREADY_RUNNING');
      err.pids = running;
      throw err;
    }

    // PowerShell can't run a script from inside app.asar, so write it out.
    const scriptPath = path.join(dataDir, 'multiroblox-helper.ps1');
    fs.writeFileSync(scriptPath, HELPER_PS1, 'utf-8');

    helperState = { mutexes: [], cookieLock: null, readyAt: null };
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    helper = child;

    await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('MULTI_ROBLOX_TIMEOUT')), 15000);
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line.startsWith('MUTEX ')) {
            const [, name, owned] = line.match(/^MUTEX (\S+) owned=(\S+)/) || [];
            if (name) helperState.mutexes.push({ name, owned: /true/i.test(owned) });
          } else if (line.startsWith('COOKIELOCK')) {
            helperState.cookieLock = line.slice('COOKIELOCK '.length);
          } else if (line === 'READY') {
            clearTimeout(timer);
            helperState.readyAt = Date.now();
            resolve();
          }
        }
      });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (!helperState || !helperState.readyAt) reject(new Error(`MULTI_ROBLOX_HELPER_EXIT_${code}`));
        helper = null;
        helperState = null;
      });
    });

    if (helperState.mutexes.length === 0) {
      stop();
      throw new Error('MULTI_ROBLOX_MUTEX_FAILED');
    }
    return status();
  })();

  try {
    return await starting;
  } catch (e) {
    stop();
    throw e;
  } finally {
    starting = null;
  }
}

function stop() {
  if (helper && helper.exitCode === null) {
    try { helper.stdin.write('STOP\n'); } catch (_) {}
    const h = helper;
    setTimeout(() => { try { h.kill(); } catch (_) {} }, 1500);
  }
  helper = null;
  helperState = null;
}

module.exports = { ensureActive, stop, status, listRobloxPids, closeAllRoblox, isActive };
