import { call, on } from './api.js';
import { state, notify, subscribe, upsertAccounts, removeAccounts, groups, accountList } from './store.js';
import { esc, displayName, errorMessage } from './format.js';
import { icon } from './icons.js';
import { applyTheme } from './theme.js';
import { toast } from './ui/toast.js';
import { closeTopModal, hasModal } from './ui/modal.js';
import { closeMenu } from './ui/menu.js';
import { openPalette, closePalette } from './ui/palette.js';
import { syncDrawer, requestCloseDrawer } from './components/drawer.js';
import { openAddAccount } from './components/add-account.js';
import { setTarget, pickTarget } from './components/launch-bar.js';
import { handleUpdateStatus } from './updates.js';
import {
  navigate, openDetail, launchAccounts, refreshAccounts, clearSelection, removeAccounts as confirmRemove,
  closeAllRoblox, showShortcuts, flashLaunchBar,
} from './actions.js';
import * as dashboardView from './views/dashboard.js';
import * as accountsView from './views/accounts.js';
import * as gamesView from './views/games.js';
import * as activityView from './views/activity.js';
import * as settingsView from './views/settings.js';
import { importFlow } from './views/settings.js';

const VIEWS = {
  dashboard: { mod: dashboardView, label: 'Dashboard', icon: 'home' },
  accounts: { mod: accountsView, label: 'Accounts', icon: 'users' },
  games: { mod: gamesView, label: 'Games', icon: 'gamepad' },
  activity: { mod: activityView, label: 'Activity', icon: 'activity' },
  settings: { mod: settingsView, label: 'Settings', icon: 'settings' },
};
const ORDER = ['dashboard', 'accounts', 'games', 'activity', 'settings'];

let mounted = { name: null, ctl: null };
const viewEl = document.getElementById('view');

// ------------------------------------------------------------------ sidebar
function renderSidebar() {
  const total = state.accounts.size;
  const gs = groups();
  const multi = state.multi || {};
  const launch = state.launch;
  const html = `
    ${ORDER.map((name) => `<button class="nav-item ${state.view === name ? 'active' : ''}" data-nav="${name}" title="${VIEWS[name].label}">
      ${icon(VIEWS[name].icon)}<span>${VIEWS[name].label}</span>${name === 'accounts' ? `<span class="count">${total}</span>` : ''}</button>`).join('')}
    ${gs.length ? `<div class="nav-label">Groups</div>
      ${gs.map((g) => `<button class="nav-item ${state.view === 'accounts' && state.filters.group === g.name ? 'active' : ''}" data-group="${esc(g.name)}" title="${esc(g.name)}">
        ${icon('folder')}<span class="truncate">${esc(g.name)}</span><span class="count">${g.count}</span></button>`).join('')}` : ''}
    <div class="sidebar-footer">
      <div class="status-line" title="Roblox clients">${launch.busy
        ? `<span class="pip busy"></span><span>Launching ${launch.done || 0}/${launch.total || 1}…</span>`
        : `<span class="pip ${multi.active ? 'on' : ''}"></span><span>${state.platform === 'win32' ? `${multi.runningClients || 0} Roblox window${multi.runningClients === 1 ? '' : 's'}${multi.enabled ? (multi.active ? ' · Multi on' : ' · Multi ready') : ''}` : 'Launching needs Windows'}</span>`}</div>
      <div class="status-line" title="Live status refresh">${state.refresh.running ? '<span class="pip busy"></span><span>Refreshing…</span>' : `<span class="pip"></span><span>v${esc(state.version)}</span>`}</div>
    </div>`;
  const sb = document.getElementById('sidebar');
  if (sb.dataset.html !== html) { sb.innerHTML = html; sb.dataset.html = html; }
}

document.getElementById('sidebar').addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    navigate(nav.dataset.nav, nav.dataset.nav === 'accounts' ? { filters: { group: '' } } : {});
    return;
  }
  const g = e.target.closest('[data-group]');
  if (g) navigate('accounts', { filters: { group: g.dataset.group, chip: 'all' } });
});

// ------------------------------------------------------------------ views
function mountView() {
  if (mounted.name === state.view) return;
  if (state.view !== 'accounts') clearSelection();
  const def = VIEWS[state.view] || VIEWS.dashboard;
  viewEl.scrollTop = 0;
  mounted = { name: state.view, ctl: def.mod.mount(viewEl) };
}

subscribe((topics) => {
  if (topics.has('settings')) applyTheme(state.settings);
  if (topics.has('view')) mountView();
  if (mounted.ctl && mounted.ctl.update) mounted.ctl.update(topics);
  if (topics.has('accounts') || topics.has('view') || topics.has('multi') || topics.has('launch') || topics.has('refresh') || topics.has('filters')) renderSidebar();
  if (topics.has('accounts') || topics.has('detail') || topics.has('launch') || topics.has('tick')) syncDrawer();
  if (topics.has('launch')) renderLaunchPanel();
});

// ------------------------------------------------------------------ launch progress
const STAGE = { ticket: 'Getting a sign-in ticket', opening: 'Opening Roblox', waiting: 'Waiting for the window', launched: 'Opened', failed: 'Failed', cancelling: 'Stopping after this account' };

function renderLaunchPanel() {
  let panel = document.getElementById('launch-panel');
  const l = state.launch;
  if (!l.busy || (l.total || 1) < 2) { if (panel) panel.remove(); return; }
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'launch-panel';
    panel.className = 'launch-panel';
    panel.setAttribute('role', 'status');
    document.getElementById('toasts').appendChild(panel);
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel]')) call('launch:cancel').catch(() => {});
    });
  }
  const a = l.accountId && state.accounts.get(l.accountId);
  const pct = Math.round(((l.done || 0) / (l.total || 1)) * 100);
  panel.innerHTML = `<div class="head">${icon('play', 'sm')}<span>Launching ${Math.min((l.done || 0) + (l.stage === 'launched' || l.stage === 'failed' ? 0 : 1), l.total)} of ${l.total}</span>
      <span class="spacer"></span><button class="btn xs ghost" data-cancel ${l.cancelled ? 'disabled' : ''}>${l.cancelled ? 'Stopping…' : 'Cancel'}</button></div>
    <div class="sub truncate">${a ? `${esc(displayName(a))} — ` : ''}${esc(STAGE[l.stage] || 'Starting')}${l.error ? ` · ${esc(errorMessage({ code: l.error }))}` : ''}</div>
    <div class="progress"><div style="width:${pct}%"></div></div>`;
}

on('launch:progress', (p) => {
  state.launch = { ...state.launch, busy: true, ...p, cancelled: state.launch.cancelled || p.stage === 'cancelling' };
  notify('launch');
});
on('launch:finished', () => {
  state.launch = { busy: false };
  refreshMulti();
  notify('launch');
});

// ------------------------------------------------------------------ main-process events
on('accounts:changed', (list) => upsertAccounts(list));
on('accounts:removed', (ids) => removeAccounts(ids));
on('presets:changed', (list) => { state.presets = list; notify('presets'); });
on('activity:entry', (entry) => { state.activity = [entry, ...state.activity].slice(0, 500); notify('activity'); });
on('settings:changed', (s) => { state.settings = s; notify('settings'); });
on('refresh:state', (s) => { state.refresh = { running: s.running, at: s.at || state.refresh.at, result: s.result || state.refresh.result }; notify('refresh'); });
on('updates:status', handleUpdateStatus);
on('window:maximized', (max) => renderWindowControls(max));
on('app:notice', (n) => toast({ type: n.level || 'info', message: n.message || errorMessage({ code: n.code }) }));

async function refreshMulti() {
  try { state.multi = await call('multi:status'); notify('multi'); } catch (_) { /* ignore */ }
}

// ------------------------------------------------------------------ titlebar
function renderWindowControls(maximized = false) {
  document.getElementById('win-min').innerHTML = icon('minus', 'sm');
  document.getElementById('win-max').innerHTML = icon(maximized ? 'squares' : 'square', 'sm');
  document.getElementById('win-max').setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
  document.getElementById('win-close').innerHTML = icon('x', 'sm');
}
document.getElementById('win-min').addEventListener('click', () => call('window:minimize'));
document.getElementById('win-max').addEventListener('click', () => call('window:toggle-maximize'));
document.getElementById('win-close').addEventListener('click', () => call('window:close'));
document.querySelector('.titlebar .brand').addEventListener('dblclick', () => call('window:toggle-maximize'));
document.getElementById('open-palette').innerHTML = `${icon('search', 'sm')}<span>Search accounts or run a command…</span><kbd>Ctrl K</kbd>`;
document.getElementById('open-palette').addEventListener('click', showPalette);

// ------------------------------------------------------------------ command palette
function showPalette() {
  const go = (view, extra) => () => navigate(view, extra);
  openPalette({
    onAccount: (a, { shift }) => {
      if (shift || !state.target.text.trim() || a.session.status === 'none') openDetail(a.id);
      else launchAccounts([a.id]);
    },
    commands: [
      { label: 'Add account', icon: 'userPlus', hint: 'Ctrl N', run: () => openAddAccount(), keywords: 'new sign in login' },
      { label: 'Choose game to launch', icon: 'gamepad', run: () => { navigate('accounts'); setTimeout(() => flashLaunchBar(), 60); }, keywords: 'place target server' },
      { label: 'Launch selected accounts', icon: 'play', hint: 'Ctrl Enter', run: () => launchAccounts([...state.selection]), keywords: 'together multi' },
      { label: 'Refresh all accounts', icon: 'refresh', hint: 'Ctrl R', run: () => refreshAccounts(null, { full: true }), keywords: 'sync update status' },
      { label: 'Go to Dashboard', icon: 'home', hint: 'Ctrl 1', run: go('dashboard') },
      { label: 'Go to Accounts', icon: 'users', hint: 'Ctrl 2', run: go('accounts') },
      { label: 'Go to Games', icon: 'gamepad', hint: 'Ctrl 3', run: go('games') },
      { label: 'Go to Activity', icon: 'activity', hint: 'Ctrl 4', run: go('activity') },
      { label: 'Open Settings', icon: 'settings', hint: 'Ctrl 5', run: go('settings') },
      { label: 'Show accounts that need attention', icon: 'alert', run: go('accounts', { filters: { chip: 'attention', group: '', tag: '', query: '' } }) },
      { label: 'Show favorites', icon: 'star', run: go('accounts', { filters: { chip: 'favorites', group: '', tag: '', query: '' } }) },
      { label: 'Check all sign-ins', icon: 'shieldCheck', run: () => navigate('settings', { settingsSection: 'sync' }), keywords: 'verify sessions cookies' },
      { label: 'Close all Roblox windows', icon: 'x', run: () => closeAllRoblox(), keywords: 'kill stop' },
      { label: 'Launch settings & Multi Roblox', icon: 'sliders', run: go('settings', { settingsSection: 'launching' }), keywords: 'launcher bloxstrap delay' },
      { label: 'Change theme', icon: 'palette', run: go('settings', { settingsSection: 'appearance' }), keywords: 'appearance color dark light accent' },
      { label: 'Export backup', icon: 'download', run: () => navigate('settings', { settingsSection: 'data' }), keywords: 'save file' },
      { label: 'Import backup', icon: 'upload', run: () => importFlow(), keywords: 'restore file' },
      { label: 'Diagnostics', icon: 'stethoscope', run: go('settings', { settingsSection: 'diagnostics' }), keywords: 'logs troubleshoot help' },
      { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => showShortcuts(), keywords: 'help keys hotkeys' },
      { label: 'Quit app', icon: 'power', run: () => call('app:quit'), keywords: 'exit close' },
    ],
  });
}

// ------------------------------------------------------------------ keyboard
function inField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

document.addEventListener('keydown', async (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (closeMenu() || closePalette() || closeTopModal()) { e.preventDefault(); return; }
    if (state.detailId) { e.preventDefault(); requestCloseDrawer(); return; }
    if (state.selection.size && !inField(e)) { clearSelection(); return; }
    return;
  }
  if (hasModal()) return;
  if (mod && key === 'k') { e.preventDefault(); showPalette(); return; }
  if (mod && key === 'n') { e.preventDefault(); openAddAccount(); return; }
  if (mod && key === 'r') { e.preventDefault(); refreshAccounts(null, { full: true }); return; }
  if (mod && key === 'f') {
    e.preventDefault();
    if (state.view !== 'accounts') navigate('accounts');
    requestAnimationFrame(() => mounted.ctl && mounted.ctl.focusSearch && mounted.ctl.focusSearch());
    return;
  }
  if (mod && /^[1-5]$/.test(e.key)) { e.preventDefault(); navigate(ORDER[Number(e.key) - 1]); return; }
  if (mod && e.key === 'Enter' && state.selection.size) { e.preventDefault(); launchAccounts([...state.selection]); return; }
  if (inField(e) || state.detailId) return;
  if (mod && key === 'a' && state.view === 'accounts' && mounted.ctl && mounted.ctl.visibleIds) {
    e.preventDefault();
    mounted.ctl.visibleIds().forEach((id) => state.selection.add(id));
    notify('selection');
    return;
  }
  if ((e.key === 'Delete') && state.selection.size && state.view === 'accounts') {
    e.preventDefault();
    if (await confirmRemove([...state.selection])) clearSelection();
  }
  if (e.key === '?' && e.shiftKey) showShortcuts();
});

// Broken or missing avatar images fall back to a monogram.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
}, true);

// Keyboard shortcut hint for the saved-games picker from anywhere (Alt+G).
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 'g' && !hasModal()) {
    const btn = document.querySelector('[data-target-pick]');
    if (btn) { e.preventDefault(); pickTarget(btn); }
  }
});

// ------------------------------------------------------------------ boot
async function boot() {
  renderWindowControls(false);
  try {
    const b = await call('app:bootstrap');
    Object.assign(state, {
      ready: true,
      version: b.version,
      platform: b.platform,
      packaged: b.packaged,
      settings: b.settings,
      presets: b.presets,
      activity: b.activity,
      notes: b.notes,
      vault: b.vault,
      updates: b.updates,
      launch: b.launch,
      refresh: { running: b.refreshing, result: b.lastRefresh, at: null },
    });
    state.accounts = new Map(b.accounts.map((a) => [a.id, a]));
    applyTheme(state.settings);
    state.view = b.accounts.length ? 'dashboard' : 'dashboard';
    await setTarget(state.settings.lastGameTarget || '', { persist: false });
    document.getElementById('boot').remove();
    mountView();
    renderSidebar();
    refreshMulti();
    for (const note of b.notes) toast({ type: 'warning', message: note, duration: 12000 });
    if (b.updates && b.updates.pending && b.updates.downloaded) handleUpdateStatus({ status: 'downloaded', ...b.updates.pending });
    if (!state.settings.onboardingDone) call('settings:update', { onboardingDone: true }).catch(() => {});
  } catch (e) {
    document.getElementById('boot').innerHTML = `<div class="empty"><div class="art">${icon('alert')}</div><h3>The app couldn't start</h3><p>${esc(errorMessage(e))}</p></div>`;
    return;
  }
  setInterval(() => { notify('tick'); refreshMulti(); }, 30 * 1000);
}

window.addEventListener('focus', () => refreshMulti());
boot();

// Expose a tiny hook for automated UI tests only (no privileged access).
window.__ram = { state, accountList };
