'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { parseGameTarget, describeTarget, buildRobloxPlayerUri } = require('./roblox/launch-uri');
const { detectLaunchers, resolveLauncher } = require('./roblox/detect');

const RECENT_LAUNCH_MS = 30 * 1000;
const MAX_BATCH = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launches Roblox signed in as specific accounts. Only one launch job runs at
 * a time; bulk jobs start accounts one by one, waiting for each client window
 * before starting the next, and can be cancelled between accounts.
 */
class LaunchService extends EventEmitter {
  constructor({ app, shell, accounts, api, multi, getSettings, dataDir, activity, log, testSink = null }) {
    super();
    Object.assign(this, { app, shell, accounts, api, multi, getSettings, dataDir, activity, log, testSink });
    this.job = null;
  }

  status() {
    if (!this.job) return { busy: false };
    const { id, total, done, currentId, cancelled, target } = this.job;
    return { busy: true, jobId: id, total, done, currentId, cancelled, target };
  }

  cancel() {
    if (!this.job) return false;
    this.job.cancelled = true;
    this.emitProgress({ stage: 'cancelling' });
    return true;
  }

  emitProgress(extra) {
    if (!this.job) return;
    this.emit('progress', { jobId: this.job.id, total: this.job.total, done: this.job.done, ...extra });
  }

  /** Checks everything that can be checked before any account is touched. */
  async preflight(ids, target, { force }) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('NO_ACCOUNTS');
    if (ids.length > MAX_BATCH) throw new Error('TOO_MANY_ACCOUNTS');
    if (this.job) throw new Error('LAUNCH_BUSY');

    const parsed = parseGameTarget(target);
    if (parsed.error) throw new Error(parsed.error);

    const accs = ids.map((id) => this.accounts.get(id));
    if (accs.some((a) => !a)) throw new Error('NOT_FOUND');
    const missing = accs.filter((a) => !this.accounts.vault.has(a.id));
    if (missing.length) {
      const err = new Error('NO_SESSION');
      err.accounts = missing.map((a) => a.id);
      throw err;
    }
    if (!force) {
      const recent = accs.filter((a) => a.lastLaunchedAt && Date.now() - a.lastLaunchedAt < RECENT_LAUNCH_MS);
      if (recent.length) {
        const err = new Error('RECENTLY_LAUNCHED');
        err.accounts = recent.map((a) => a.id);
        throw err;
      }
    }

    const settings = this.getSettings();
    let launcher = { kind: 'default' };
    if (!this.testSink && process.platform === 'win32') {
      const found = detectLaunchers(this.app);
      launcher = resolveLauncher(settings.launcher, found);
      if (launcher.kind === 'default' && !found.protocolHandler) throw new Error('ROBLOX_NOT_INSTALLED');
      if (ids.length > 1 && !settings.multiRoblox) throw new Error('MULTI_ROBLOX_OFF');
      if (settings.multiRoblox) await this.multi.ensureActive(this.dataDir);
    } else if (!this.testSink) {
      throw new Error('UNSUPPORTED_PLATFORM');
    }
    return { parsed, accs, launcher, settings };
  }

  async launch({ ids, target, force = false }) {
    const { parsed, accs, launcher, settings } = await this.preflight(ids, target, { force });
    this.job = { id: crypto.randomBytes(4).toString('hex'), total: accs.length, done: 0, currentId: null, cancelled: false, target: describeTarget(parsed) };
    const results = [];
    const delayMs = Math.max(2, Number(settings.launchDelaySec) || 6) * 1000;

    try {
      for (let i = 0; i < accs.length; i++) {
        const a = accs[i];
        if (this.job.cancelled) {
          results.push({ id: a.id, ok: false, error: 'CANCELLED' });
          continue;
        }
        this.job.currentId = a.id;
        const r = await this.launchOne(a, parsed, launcher);
        results.push(r);
        this.job.done = i + 1;
        this.emitProgress({ accountId: a.id, stage: r.ok ? 'launched' : 'failed', error: r.error || null });

        const isLast = i === accs.length - 1;
        if (!isLast && r.ok && !this.job.cancelled) {
          this.emitProgress({ accountId: a.id, stage: 'waiting' });
          const seen = await this.waitForClient(r.pidsBefore, 25000);
          if (!seen && !this.job.cancelled) {
            r.windowSeen = false;
            this.log.warn(`no new Roblox window appeared for ${a.id} within 25s`);
          }
          await this.sleepUnlessCancelled(delayMs);
        }
      }
    } finally {
      const cancelled = this.job.cancelled;
      const jobId = this.job.id;
      this.job = null;
      const okCount = results.filter((r) => r.ok).length;
      this.emit('finished', { jobId, total: accs.length, okCount, cancelled });
      if (accs.length > 1) {
        this.activity.add({
          type: 'launch.batch', level: okCount === accs.length ? 'success' : (okCount ? 'warning' : 'error'),
          message: `Launch Together: ${okCount} of ${accs.length} account(s) opened${cancelled ? ' (cancelled)' : ''} · ${describeTarget(parsed)}`,
        });
      }
    }
    return { results: results.map(({ pidsBefore, ...r }) => r), target: describeTarget(parsed) };
  }

  async launchOne(account, parsed, launcher) {
    const label = this.accounts.label(account);
    try {
      this.emitProgress({ accountId: account.id, stage: 'ticket' });
      const cookie = this.accounts.getSecret(account.id);
      if (!cookie) throw new Error('NO_SESSION');
      let ticket;
      try {
        const r = await this.api.getAuthTicket(cookie);
        ticket = r.ticket;
        if (r.cookie !== cookie) this.accounts.updateSecret(account.id, r.cookie);
      } catch (e) {
        if (e.code === 'COOKIE_INVALID') this.accounts.markSessionExpired(account.id);
        throw e;
      }

      this.emitProgress({ accountId: account.id, stage: 'opening' });
      const pidsBefore = await this.multi.listRobloxPids();
      await this.openUri(buildRobloxPlayerUri(ticket, parsed), launcher, account);
      this.accounts.markLaunched(account.id);
      this.activity.add({ type: 'launch.success', level: 'success', accountId: account.id, message: `Opened Roblox as ${label} · ${describeTarget(parsed)}` });
      return { id: account.id, ok: true, pidsBefore };
    } catch (e) {
      const code = e.code || e.message || 'LAUNCH_FAILED';
      this.log.warn(`launch failed for ${account.id}: ${code}`);
      this.activity.add({ type: 'launch.failed', level: 'error', accountId: account.id, message: `Could not open Roblox as ${label}`, meta: { error: code } });
      return { id: account.id, ok: false, error: code };
    }
  }

  async openUri(uri, launcher, account) {
    if (this.testSink) {
      fs.appendFileSync(this.testSink, `${JSON.stringify({ accountId: account.id, uri, launcher: launcher.kind, at: Date.now() })}\n`);
      return;
    }
    if (launcher.kind === 'bloxstrap' || launcher.kind === 'fishstrap') return runDetached(launcher.exe, ['-player', uri]);
    if (launcher.kind === 'client') return runDetached(launcher.exe, [uri]);
    // The registered protocol handler (official launcher). No shell is
    // involved, so characters in the URI cannot be read as commands.
    return this.shell.openExternal(uri);
  }

  /** Waits until a new RobloxPlayerBeta.exe appears so launches don't race. */
  async waitForClient(pidsBefore, timeoutMs) {
    if (this.testSink || process.platform !== 'win32') return true;
    const before = new Set(pidsBefore || []);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.job && this.job.cancelled) return false;
      await sleep(700);
      const now = await this.multi.listRobloxPids();
      if (now.some((p) => !before.has(p))) return true;
    }
    return false;
  }

  async sleepUnlessCancelled(ms) {
    const end = Date.now() + (this.testSink ? Math.min(ms, 200) : ms);
    while (Date.now() < end) {
      if (this.job && this.job.cancelled) return;
      await sleep(Math.min(250, end - Date.now()));
    }
  }
}

function runDetached(exe, args) {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', () => reject(new Error('LAUNCHER_FAILED')));
      child.once('spawn', () => { child.unref(); resolve(); });
    } catch (_) {
      reject(new Error('LAUNCHER_FAILED'));
    }
  });
}

module.exports = { LaunchService, RECENT_LAUNCH_MS };
