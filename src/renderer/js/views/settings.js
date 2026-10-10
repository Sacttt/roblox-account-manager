import { call } from '../api.js';
import { state, notify } from '../store.js';
import { esc, errorMessage, bytes, plural, timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { THEMES, ACCENTS } from '../theme.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { closeAllRoblox, showShortcuts } from '../actions.js';
import { renderUpdateCard, bindUpdateCard } from '../updates.js';

const SECTIONS = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'launching', label: 'Launching', icon: 'play' },
  { id: 'sync', label: 'Live status & sync', icon: 'refresh' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'data', label: 'Data & backup', icon: 'folder' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'stethoscope' },
  { id: 'about', label: 'About & updates', icon: 'info' },
];

const switchHtml = (key, on) => `<label class="switch"><input type="checkbox" data-setting="${key}" ${on ? 'checked' : ''}><span></span></label>`;
const setting = (title, desc, ctl) => `<div class="setting"><div class="txt"><strong>${title}</strong><span>${desc}</span></div><div class="ctl">${ctl}</div></div>`;

async function update(patch, okMessage) {
  try {
    const s = await call('settings:update', patch);
    state.settings = s;
    notify('settings');
    if (okMessage) toast({ type: 'success', message: okMessage, duration: 1600 });
  } catch (e) {
    toast({ type: 'error', message: errorMessage(e) });
  }
}

export function mount(root) {
  root.innerHTML = `<div class="view-inner">
    <div class="page-head"><div><h1>Settings</h1><p>Preferences are saved automatically.</p></div></div>
    <div class="settings-layout">
      <nav class="settings-nav" data-nav>${SECTIONS.map((s) => `<button class="nav-item" data-section="${s.id}">${icon(s.icon)}<span>${s.label}</span></button>`).join('')}</nav>
      <div data-section-host></div>
    </div></div>`;
  const host = root.querySelector('[data-section-host]');
  root.querySelector('[data-nav]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-section]');
    if (b) { state.settingsSection = b.dataset.section; render(); }
  });
  host.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.setting) {
      const key = el.dataset.setting;
      let value = el.type === 'checkbox' ? el.checked : el.value;
      if (['launchDelaySec', 'presenceRefreshMinutes', 'profileRefreshHours'].includes(key)) value = Number(value);
      update({ [key]: value }, 'Saved');
    }
  });
  host.addEventListener('click', onClick);

  function render() {
    root.querySelectorAll('[data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === state.settingsSection));
    const s = state.settings;
    const sec = state.settingsSection;
    const renderers = { general, launching, sync, appearance, data, diagnostics, about };
    host.innerHTML = `<div class="settings-section">${(renderers[sec] || general)(s)}</div>`;
    if (sec === 'launching') loadLaunchStatus();
    if (sec === 'data') loadCacheSize();
    if (sec === 'diagnostics') loadDiagnostics();
    if (sec === 'about') bindUpdateCard(host);
  }

  function general(s) {
    return `<section class="card">
      ${setting('Close to system tray', 'Keep running in the tray when the window is closed, so quick launch and Multi Roblox stay available.', switchHtml('closeToTray', s.closeToTray))}
      ${setting('Start with Windows', 'Open the app automatically when you sign in to Windows.', switchHtml('launchAtStartup', s.launchAtStartup))}
      ${setting('Start minimized', 'When starting with Windows, open straight to the tray.', switchHtml('startMinimized', s.startMinimized))}
      ${setting('Desktop notifications', 'Notify when a Launch Together run finishes while the app is in the background.', switchHtml('notifications', s.notifications))}
      ${setting('Show/hide shortcut', 'A global keyboard shortcut that brings the app to the front from anywhere.',
        `<select class="select sm" data-setting="globalHotkey" style="width:200px">
          ${['', 'CommandOrControl+Shift+R', 'CommandOrControl+Alt+R', 'CommandOrControl+Shift+M', 'Alt+Shift+R'].map((k) => `<option value="${k}" ${s.globalHotkey === k ? 'selected' : ''}>${k ? k.replace('CommandOrControl', 'Ctrl') : 'Off'}</option>`).join('')}
        </select>`)}
    </section>
    <section class="card">${setting('Keyboard shortcuts', 'Press Ctrl K anywhere to search accounts and run commands.', `<button class="btn sm" data-act="shortcuts">${icon('keyboard', 'sm')}View shortcuts</button>`)}</section>`;
  }

  function launching(s) {
    return `<div class="note" data-launch-status>${icon('info')}<div>Checking Roblox installation…</div></div>
    <section class="card">
      ${setting('Multi Roblox', 'Lets several Roblox windows run at the same time. Turn it on while Roblox is closed. Roblox may treat multiple clients as unusual — use at your own risk.',
        `<label class="switch"><input type="checkbox" data-act-change="multi" ${s.multiRoblox ? 'checked' : ''}><span></span></label>`)}
      ${setting('Launcher', 'What opens Roblox. Automatic uses Bloxstrap or Fishstrap when installed, otherwise the official Roblox launcher.',
        `<select class="select sm" data-setting="launcher">
          ${[['auto', 'Automatic'], ['default', 'Official Roblox'], ['bloxstrap', 'Bloxstrap'], ['fishstrap', 'Fishstrap'], ['client', 'RobloxPlayerBeta.exe directly']].map(([v, l]) => `<option value="${v}" ${s.launcher === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>`)}
      ${setting('Delay between accounts', 'When launching several accounts, the app waits for each Roblox window to appear, then this long before the next one.',
        `<select class="select sm" data-setting="launchDelaySec">${[3, 4, 6, 8, 10, 15, 20, 30].map((n) => `<option value="${n}" ${s.launchDelaySec === n ? 'selected' : ''}>${n} seconds</option>`).join('')}</select>`)}
      ${setting('Close all Roblox windows', 'Force-closes every running Roblox client. Useful when Roblox is stuck in the background.', `<button class="btn sm danger-ghost" data-act="close-roblox">${icon('x', 'sm')}Close Roblox</button>`)}
    </section>`;
  }

  async function loadLaunchStatus() {
    const el = host.querySelector('[data-launch-status]');
    if (!el) return;
    try {
      const [d, m] = await Promise.all([call('roblox:detect'), call('multi:status')]);
      if (!host.querySelector('[data-launch-status]')) return;
      if (!d.platformSupported) {
        el.className = 'note warn';
        el.innerHTML = `${icon('alert')}<div>Launching Roblox works on Windows only. Everything else in the app works here.</div>`;
        return;
      }
      const found = [d.protocolHandler && `Roblox handler: <strong>${esc(d.protocolHandler)}</strong>`, d.bloxstrap && 'Bloxstrap', d.fishstrap && 'Fishstrap', d.clientVersion && `Client <span class="mono">${esc(d.clientVersion)}</span>`].filter(Boolean);
      const multi = !m.enabled ? 'Multi Roblox is off.' : m.active ? `Multi Roblox is active${m.cookieLock && m.cookieLock.startsWith('ok') ? ' (with error 773 protection)' : ''}.` : (m.runningClients ? 'Multi Roblox is waiting — close Roblox so it can start.' : 'Multi Roblox will start with your next launch.');
      el.className = `note ${d.protocolHandler || d.client ? 'ok' : 'warn'}`;
      el.innerHTML = `${icon(d.protocolHandler || d.client ? 'check' : 'alert')}<div>${found.length ? found.join(' · ') : 'Roblox was not found on this PC. Install it from roblox.com/download.'}<br>${esc(multi)} ${plural(m.runningClients, 'Roblox window')} open.</div>`;
    } catch (_) { /* leave placeholder */ }
  }

  function sync(s) {
    return `<section class="card">
      ${setting('Live status refresh', 'How often online/in-game status is fetched from Roblox for all accounts (one batched request).',
        `<select class="select sm" data-setting="presenceRefreshMinutes">${[[0, 'Off (manual only)'], [2, 'Every 2 minutes'], [5, 'Every 5 minutes'], [10, 'Every 10 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour']].map(([v, l]) => `<option value="${v}" ${s.presenceRefreshMinutes === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${setting('Profile refresh', 'How often names, avatars and ban status are re-checked.',
        `<select class="select sm" data-setting="profileRefreshHours">${[[0, 'Off (manual only)'], [1, 'Every hour'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Daily']].map(([v, l]) => `<option value="${v}" ${s.profileRefreshHours === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${setting('Check all sign-ins', 'Asks Roblox whether each saved sign-in still works. Expired ones are flagged so you can sign in again.', `<button class="btn sm" data-act="verify-all">${icon('shieldCheck', 'sm')}Check now</button>`)}
      ${setting('Refresh everything', 'Re-downloads names, ban status, live status and avatars for every account.', `<button class="btn sm" data-act="refresh-all">${icon('refresh', 'sm')}Refresh</button>`)}
    </section>
    <div class="note">${icon('info')}<div>Status shown in the app always comes from Roblox and shows how old it is. If Roblox can't be reached, the last known value is shown with its age — never a guess.</div></div>`;
  }

  function appearance(s) {
    const accent = s.accentColor || THEMES[s.theme].accent;
    return `<section class="card"><div class="card-head"><h3>Theme</h3></div>
      <div class="theme-grid">${Object.entries(THEMES).map(([id, t]) => `<button class="theme-swatch ${s.theme === id ? 'active' : ''}" data-theme="${id}">
        <div class="pv" style="background:${t.bg1}"><i style="width:22%;background:${t.s1}"></i><i style="flex:1;background:${t.s2}"></i><i style="width:16px;height:16px;border-radius:50%;background:${t.accent};align-self:flex-end"></i></div>
        <div class="nm"><span>${esc(t.name)}</span>${s.theme === id ? icon('check', 'sm') : ''}</div></button>`).join('')}</div></section>
    <section class="card">
      ${setting('Accent color', 'Used for buttons, highlights and focus rings.',
        `<div class="accent-row">${ACCENTS.map((c) => `<button class="accent-dot ${accent.toLowerCase() === c ? 'active' : ''}" style="background:${c}" data-accent="${c}" aria-label="Accent ${c}"></button>`).join('')}
          <input type="color" value="${esc(accent)}" data-accent-custom aria-label="Custom accent color">
          ${s.accentColor ? `<button class="btn xs ghost" data-accent="">Theme default</button>` : ''}</div>`)}
      ${setting('Density', 'Compact fits more accounts on screen.', `<select class="select sm" data-setting="density"><option value="comfortable" ${s.density === 'comfortable' ? 'selected' : ''}>Comfortable</option><option value="compact" ${s.density === 'compact' ? 'selected' : ''}>Compact</option></select>`)}
      ${setting('Reduce motion', 'Turns off animations and transitions.', switchHtml('reduceMotion', s.reduceMotion))}
    </section>`;
  }

  function data() {
    return `<section class="card">
      ${setting('Export backup', 'Saves your accounts\' organisation (nicknames, groups, tags, notes, favorites), saved games and settings to a file. <b>Sign-in cookies are never included.</b>', `<button class="btn sm" data-act="export">${icon('download', 'sm')}Export…</button>`)}
      ${setting('Import backup', 'Restores from a backup file (also accepts exports from older versions). You choose what to restore before anything changes.', `<button class="btn sm" data-act="import">${icon('upload', 'sm')}Import…</button>`)}
      ${setting('Data folder', 'Where accounts, encrypted sign-ins, settings and logs are stored on this PC.', `<button class="btn sm" data-act="open-folder">${icon('folder', 'sm')}Open folder</button>`)}
      ${setting('Avatar cache', '<span data-cache-size>Calculating…</span>', `<button class="btn sm" data-act="clear-cache">Clear cache</button>`)}
    </section>
    <section class="card">
      ${setting('Remove all saved sign-ins', 'Deletes every encrypted sign-in from this PC but keeps your accounts and their organisation. You will need to sign in again to launch.', `<button class="btn sm danger-ghost" data-act="clear-sessions">${icon('key', 'sm')}Remove sign-ins</button>`)}
      ${setting('Reset settings', 'Restores all preferences to their defaults. Accounts are not touched.', `<button class="btn sm danger-ghost" data-act="reset-settings">Reset</button>`)}
    </section>
    <div class="note">${icon('shield')}<div><strong>How your data is protected.</strong> Sign-ins are encrypted with Windows' own data protection (DPAPI), tied to your Windows user, and stored separately from everything else. They are only ever sent to Roblox. To remove everything, uninstall the app and delete the data folder.</div></div>`;
  }

  async function loadCacheSize() {
    try {
      const n = await call('data:cache-size');
      const el = host.querySelector('[data-cache-size]');
      if (el) el.textContent = `Avatars and custom icons use ${bytes(n)}. Clearing re-downloads avatars on the next refresh.`;
    } catch (_) { /* ignore */ }
  }

  function diagnostics() {
    return `<div class="row"><button class="btn sm" data-act="diag-refresh">${icon('refresh', 'sm')}Run checks</button><button class="btn sm" data-act="diag-copy">${icon('clipboard', 'sm')}Copy report</button><button class="btn sm ghost" data-act="open-logs">${icon('folder', 'sm')}Open logs</button></div>
      <div class="diag-grid" data-diag><div class="card diag-item skeleton" style="height:64px"></div><div class="card diag-item skeleton" style="height:64px"></div><div class="card diag-item skeleton" style="height:64px"></div></div>
      <section class="card"><div class="card-head"><h3>Connection to Roblox</h3></div><div class="card-body" data-conn><span class="faint">Not checked yet.</span></div></section>
      <section class="card"><div class="card-head"><h3>Recent log</h3><div class="actions"><button class="btn xs ghost" data-act="load-log">Load</button></div></div><div class="log-view" data-log><span class="faint">Logs never include sign-in cookies or launch tickets.</span></div></section>
      <section class="card"><div class="card-head"><h3>Troubleshooting</h3></div><div class="card-body stack" style="gap:10px;color:var(--text-2)">
        <div><strong style="color:var(--text)">Only one Roblox window opens.</strong> Turn on Multi Roblox, close every Roblox window (Settings → Launching → Close Roblox), then launch again.</div>
        <div><strong style="color:var(--text)">"Sign-in expired".</strong> Roblox signed that account out (password change, "log out of all sessions", or age). Open the account and choose Sign in again.</div>
        <div><strong style="color:var(--text)">Error 773 or accounts swapping.</strong> Close all Roblox windows and launch with Multi Roblox on — it locks Roblox's cookie file so clients don't overwrite each other.</div>
        <div><strong style="color:var(--text)">Status shows "unknown".</strong> Live status hasn't been fetched yet or Roblox can't be reached. Use Refresh, or run the checks above.</div>
      </div></section>`;
  }

  async function loadDiagnostics() {
    try {
      const d = await call('diag:collect');
      const grid = host.querySelector('[data-diag]');
      if (!grid) return;
      const items = [
        ['App version', `${d.app.version}${d.app.packaged ? '' : ' (dev)'}`],
        ['Electron / Chromium', `${d.app.electron} / ${d.app.chrome.split('.')[0]}`],
        ['System', `${d.system.platform} ${d.system.release} (${d.system.arch})`],
        ['Sign-in storage', d.storage.vault.encryptionAvailable ? `Encrypted (${d.storage.vault.backend || 'OS'})` : (d.storage.vault.testCodec ? 'Test mode (not encrypted)' : 'Memory only — OS encryption unavailable')],
        ['Accounts', `${d.accounts.total} · ${d.accounts.sessions.valid} verified · ${d.accounts.sessions.expired} expired · ${d.accounts.sessions.none} without sign-in`],
        ['Roblox launcher', d.roblox.protocolHandler || (d.system.platform === 'win32' ? 'Not found' : 'Windows only')],
        ['Roblox client', d.roblox.clientVersion || '—'],
        ['Multi Roblox', d.roblox.multiRoblox.enabled ? (d.roblox.multiRoblox.active ? 'Active' : 'Enabled, not running') : 'Off'],
        ['Roblox windows open', String(d.roblox.runningClients)],
        ['Roblox requests', `${d.network.requests} sent · ${d.network.failures} failed · ${d.network.rateLimited} rate-limited`],
        ['Last network error', d.network.lastError ? `${d.network.lastError} (${timeAgo(Date.parse(d.network.lastErrorAt))})` : 'None'],
        ['Data folder', d.storage.dataDir],
      ];
      grid.innerHTML = items.map(([k, v]) => `<div class="card diag-item"><div class="k">${esc(k)}</div><div class="v selectable">${esc(v)}</div></div>`).join('');
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e) });
    }
  }

  async function runConnectivity() {
    const el = host.querySelector('[data-conn]');
    if (!el) return;
    el.innerHTML = '<span class="row faint"><span class="spinner"></span>Contacting Roblox…</span>';
    try {
      const probes = await call('diag:connectivity');
      el.innerHTML = probes.map((p) => `<div class="row" style="padding:4px 0">${p.ok ? `<span class="badge green">${icon('check')}OK</span>` : `<span class="badge red">${icon('x')}Failed</span>`}
        <span class="mono">${esc(p.host)}</span><span class="faint">${p.ok ? `${p.ms} ms` : esc(p.error || `HTTP ${p.status}`)}</span></div>`).join('')
        + (probes.every((p) => !p.ok) ? `<div class="note warn" style="margin-top:8px">${icon('alert')}<div>Roblox can't be reached. Check your internet connection, firewall or antivirus.</div></div>` : '');
    } catch (e) { el.textContent = errorMessage(e); }
  }

  function about() {
    return `<section class="card"><div class="card-body row" style="gap:14px">
        <img src="assets/icon.png" alt="" style="width:48px;height:48px">
        <div style="flex:1"><div style="font-weight:650;font-size:15px">Roblox Account Manager</div><div class="faint">Version ${esc(state.version)} · Free and open source (MIT)</div></div>
        <button class="btn sm" data-act="github">${icon('external', 'sm')}GitHub</button>
      </div></section>
      ${renderUpdateCard()}
      <div class="note">${icon('info')}<div>This app is not affiliated with or endorsed by Roblox Corporation. Running several Roblox clients is unsupported by Roblox and may be treated as suspicious; using alternate accounts to break Roblox's Terms of Use is your responsibility.</div></div>`;
  }

  async function onClick(e) {
    const themeBtn = e.target.closest('[data-theme]');
    if (themeBtn) { update({ theme: themeBtn.dataset.theme }); return; }
    const accentBtn = e.target.closest('[data-accent]');
    if (accentBtn) { update({ accentColor: accentBtn.dataset.accent }); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'shortcuts': showShortcuts(); break;
      case 'close-roblox': await closeAllRoblox(); loadLaunchStatus(); break;
      case 'verify-all': {
        b.disabled = true;
        b.innerHTML = '<span class="spinner"></span>Checking';
        try {
          const r = await call('accounts:verify-all-sessions');
          toast({ type: r.expired || r.failed ? 'warning' : 'success', title: 'Sign-ins checked', message: `${r.valid} valid · ${r.expired} expired · ${r.none} without sign-in${r.failed ? ` · ${r.failed} couldn't be checked` : ''}` });
        } catch (err) { toast({ type: 'error', message: errorMessage(err) }); }
        render();
        break;
      }
      case 'refresh-all': {
        b.disabled = true;
        try {
          const r = await call('accounts:refresh', { full: true });
          const errs = Object.keys(r.errors || {});
          toast({ type: errs.length ? 'warning' : 'success', message: errs.length ? `Refreshed with problems: ${errs.join(', ')}` : 'Everything refreshed.' });
        } catch (err) { toast({ type: 'error', message: errorMessage(err) }); }
        b.disabled = false;
        break;
      }
      case 'export': {
        try {
          const r = await call('data:export-backup');
          if (r) toast({ type: 'success', title: 'Backup saved', message: `${plural(r.count, 'account')} exported. Sign-in cookies were not included.` });
        } catch (err) { toast({ type: 'error', message: errorMessage(err) }); }
        break;
      }
      case 'import': importFlow(); break;
      case 'open-folder': call('data:open-folder').catch(() => {}); break;
      case 'clear-cache': {
        try { await call('data:clear-avatar-cache'); toast({ type: 'success', message: 'Avatar cache cleared.' }); loadCacheSize(); } catch (err) { toast({ type: 'error', message: errorMessage(err) }); }
        break;
      }
      case 'clear-sessions': {
        const ok = await confirmDialog({ title: 'Remove every saved sign-in?', message: 'All encrypted sign-ins are deleted from this PC. Accounts stay in your list, but you\'ll need to sign in to each one again before launching it.', confirmLabel: 'Remove all sign-ins', danger: true });
        if (ok) call('accounts:clear-all-sessions').then(() => toast({ type: 'success', message: 'All sign-ins removed.' })).catch((err) => toast({ type: 'error', message: errorMessage(err) }));
        break;
      }
      case 'reset-settings': {
        if (await confirmDialog({ title: 'Reset all settings?', message: 'Theme, launch options and other preferences go back to their defaults.', confirmLabel: 'Reset', danger: true })) {
          try { state.settings = await call('settings:reset'); notify('settings'); toast({ type: 'success', message: 'Settings reset.' }); } catch (err) { toast({ type: 'error', message: errorMessage(err) }); }
        }
        break;
      }
      case 'diag-refresh': loadDiagnostics(); runConnectivity(); break;
      case 'diag-copy': {
        b.disabled = true;
        try { await call('diag:copy-report'); toast({ type: 'success', message: 'Diagnostics copied. Cookies and tickets are removed from the report.' }); } catch (err) { toast({ type: 'error', message: errorMessage(err) }); }
        b.disabled = false;
        break;
      }
      case 'open-logs': call('diag:open-logs').catch(() => {}); break;
      case 'load-log': {
        try { const t = await call('diag:log-tail'); host.querySelector('[data-log]').textContent = t || 'The log is empty.'; } catch (err) { toast({ type: 'error', message: errorMessage(err) }); }
        break;
      }
      case 'github': call('app:open-external', 'https://github.com/Sacttt/roblox-account-manager').catch(() => {}); break;
      default: break;
    }
  }

  host.addEventListener('change', async (e) => {
    if (e.target.dataset.actChange === 'multi') {
      const enabled = e.target.checked;
      e.target.disabled = true;
      try {
        await call('multi:set-enabled', enabled);
        toast({ type: 'success', message: enabled ? 'Multi Roblox is on.' : 'Multi Roblox is off. Only one Roblox window can run.' });
      } catch (err) {
        toast({ type: err.code === 'ROBLOX_ALREADY_RUNNING' ? 'warning' : 'error', message: err.code === 'ROBLOX_ALREADY_RUNNING' ? 'Multi Roblox is on and will start once Roblox is closed.' : errorMessage(err) });
      }
      state.settings = await call('settings:get');
      notify('settings');
    }
    if (e.target.matches('[data-accent-custom]')) update({ accentColor: e.target.value });
  });

  function renderKeepingFocus() {
    const active = document.activeElement;
    let selector = null;
    if (active && host.contains(active)) {
      for (const attr of ['data-setting', 'data-theme', 'data-accent', 'data-act', 'data-act-change']) {
        if (active.hasAttribute(attr)) { selector = `[${attr}="${CSS.escape(active.getAttribute(attr))}"]`; break; }
      }
      if (active.matches('[data-accent-custom]')) return; // don't rebuild while the color picker is open
    }
    render();
    if (selector) { const el = host.querySelector(selector); if (el) el.focus(); }
  }

  render();
  return {
    update(topics) {
      if (topics.has('settings')) renderKeepingFocus();
      else if (topics.has('updates') && state.settingsSection === 'about') renderKeepingFocus();
    },
  };
}

export async function importFlow() {
  let info;
  try {
    info = await call('data:choose-import');
  } catch (e) {
    toast({ type: 'error', message: errorMessage(e) });
    return;
  }
  if (!info) return;
  const m = openModal({
    title: 'Import backup',
    iconName: 'upload',
    subtitle: info.file,
    body: `${info.warnings.map((w) => `<div class="note warn">${icon('alert')}<div>${esc(w)}</div></div>`).join('')}
      <div class="note">${icon('info')}<div>The file has <strong>${plural(info.accounts, 'account')}</strong>${info.existing ? ` (${info.existing} already in your list)` : ''}${info.presets ? `, ${plural(info.presets, 'saved game')}` : ''}${info.hasSettings ? ' and settings' : ''}. Imported accounts have no sign-in — sign in to each before launching.</div></div>
      <label class="row" style="gap:10px"><span class="switch"><input type="checkbox" data-o="merge"><span></span></span>Update nicknames, groups and tags of accounts already in my list</label>
      ${info.presets ? '<label class="row" style="gap:10px"><span class="switch"><input type="checkbox" data-o="presets"><span></span></span>Replace my saved games with the ones in the file</label>' : ''}
      ${info.hasSettings ? '<label class="row" style="gap:10px"><span class="switch"><input type="checkbox" data-o="settings"><span></span></span>Restore settings from the file</label>' : ''}`,
    footer: '<button class="btn ghost" data-modal-close>Cancel</button><button class="btn primary" data-ok>Import</button>',
  });
  m.el.querySelector('[data-ok]').addEventListener('click', async () => {
    const opt = (k) => { const el = m.el.querySelector(`[data-o="${k}"]`); return !!(el && el.checked); };
    m.setBusy(true);
    try {
      const r = await call('data:apply-import', info.token, { mergeExisting: opt('merge'), includePresets: opt('presets'), includeSettings: opt('settings') });
      m.close();
      if (r.settings) { state.settings = await call('settings:get'); notify('settings'); }
      toast({ type: 'success', title: 'Import complete', message: `${r.added} added · ${r.merged} updated · ${r.skipped} skipped${r.invalid ? ` · ${r.invalid} invalid` : ''}` });
    } catch (e) {
      m.setBusy(false);
      toast({ type: 'error', message: errorMessage(e) });
    }
  });
}
