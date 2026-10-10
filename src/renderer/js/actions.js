import { call } from './api.js';
import { state, notify, groups, tags } from './store.js';
import { esc, displayName, errorMessage, plural } from './format.js';
import { toast } from './ui/toast.js';
import { confirmDialog, promptDialog, openModal } from './ui/modal.js';
import { openMenu } from './ui/menu.js';

export function navigate(view, extra = {}) {
  state.view = view;
  if (extra.settingsSection) state.settingsSection = extra.settingsSection;
  if (extra.filters) state.filters = { ...state.filters, ...extra.filters };
  notify('view');
}

export function openDetail(id) {
  state.detailId = id;
  notify('detail');
}

export function flashLaunchBar() {
  const bar = document.querySelector('.launch-bar');
  if (bar) {
    bar.classList.add('attention');
    setTimeout(() => bar.classList.remove('attention'), 1800);
    const input = bar.querySelector('input');
    if (input) { input.focus(); input.select(); }
  } else {
    navigate('accounts');
    setTimeout(() => flashLaunchBar(), 50);
  }
}

/** Launches one or more accounts into the current game target. */
export async function launchAccounts(ids, { force = false } = {}) {
  ids = ids.filter((id) => state.accounts.has(id));
  if (!ids.length) return;
  const target = (state.target.text || '').trim();
  if (!target) {
    toast({ type: 'warning', title: 'Choose a game first', message: 'Enter a Place ID or paste a game link, or pick one of your saved games.' });
    flashLaunchBar();
    return;
  }
  if (state.launch.busy) {
    toast({ type: 'warning', message: errorMessage({ code: 'LAUNCH_BUSY' }) });
    return;
  }
  ids.forEach((id) => state.launchingIds.add(id));
  notify('accounts', 'launch');
  try {
    const res = await call('launch:start', { ids, target, force });
    const ok = res.results.filter((r) => r.ok).length;
    const failed = res.results.filter((r) => !r.ok && r.error !== 'CANCELLED');
    if (ids.length === 1) {
      if (ok) toast({ type: 'success', title: 'Roblox is opening', message: `${displayName(state.accounts.get(ids[0]))} · ${res.target}` });
      else showLaunchError(failed[0], ids[0]);
    } else {
      toast({
        type: failed.length ? (ok ? 'warning' : 'error') : 'success',
        title: `${ok} of ${ids.length} accounts opened`,
        message: failed.length ? `${plural(failed.length, 'account')} failed — see Activity for details.` : res.target,
        action: failed.length ? { label: 'Activity', run: () => navigate('activity') } : null,
      });
    }
  } catch (e) {
    await handleLaunchPreflightError(e, ids);
  } finally {
    ids.forEach((id) => state.launchingIds.delete(id));
    notify('accounts', 'launch');
  }
}

function showLaunchError(result, id) {
  const a = state.accounts.get(id);
  const code = result ? result.error : 'LAUNCH_FAILED';
  toast({
    type: 'error',
    title: `Couldn't open ${a ? displayName(a) : 'account'}`,
    message: errorMessage({ code }),
    action: code === 'COOKIE_INVALID' || code === 'NO_SESSION' ? { label: 'Fix', run: () => openDetail(id) } : null,
  });
}

async function handleLaunchPreflightError(e, ids) {
  if (e.code === 'RECENTLY_LAUNCHED') {
    const names = (e.accounts || []).map((id) => state.accounts.get(id)).filter(Boolean).map(displayName);
    const ok = await confirmDialog({
      title: 'Launch again?',
      message: `${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} launched less than a minute ago. Opening another window for the same account will usually disconnect the first one.`,
      confirmLabel: 'Launch anyway',
    });
    if (ok) {
      ids.forEach((id) => state.launchingIds.delete(id));
      await launchAccounts(ids, { force: true });
    }
    return;
  }
  if (e.code === 'ROBLOX_ALREADY_RUNNING') {
    const ok = await confirmDialog({
      title: 'Close Roblox first?',
      message: 'Roblox is already open. To run several accounts at once, Multi Roblox has to start before the first Roblox window. Close all Roblox windows now and continue? Unsaved game progress in those windows may be lost.',
      confirmLabel: 'Close Roblox and launch',
      danger: true,
    });
    if (ok) {
      try {
        await call('roblox:close-all');
        ids.forEach((id) => state.launchingIds.delete(id));
        await launchAccounts(ids, { force: true });
      } catch (err) {
        toast({ type: 'error', message: errorMessage(err) });
      }
    }
    return;
  }
  if (e.code === 'NO_SESSION') {
    const names = (e.accounts || []).map((id) => state.accounts.get(id)).filter(Boolean).map(displayName);
    toast({
      type: 'error',
      title: 'Sign-in needed',
      message: `No saved sign-in for ${names.join(', ')}. Open the account and sign in again.`,
      action: e.accounts && e.accounts.length === 1 ? { label: 'Open', run: () => openDetail(e.accounts[0]) } : null,
    });
    return;
  }
  if (['GAME_REQUIRED', 'GAME_TARGET_INVALID', 'SHARE_LINK_UNSUPPORTED'].includes(e.code)) {
    toast({ type: 'warning', message: errorMessage(e) });
    flashLaunchBar();
    return;
  }
  const action = e.code === 'MULTI_ROBLOX_OFF' || e.code === 'LAUNCHER_NOT_FOUND'
    ? { label: 'Settings', run: () => navigate('settings', { settingsSection: 'launching' }) } : null;
  toast({ type: 'error', title: 'Launch failed', message: errorMessage(e), action });
}

export async function toggleFavorite(id) {
  const a = state.accounts.get(id);
  if (!a) return;
  try { await call('accounts:update', id, { favorite: !a.favorite }); } catch (e) { toast({ type: 'error', message: errorMessage(e) }); }
}

export async function togglePinned(id) {
  const a = state.accounts.get(id);
  if (!a) return;
  try { await call('accounts:update', id, { pinned: !a.pinned }); } catch (e) { toast({ type: 'error', message: errorMessage(e) }); }
}

export async function removeAccounts(ids) {
  const list = ids.map((id) => state.accounts.get(id)).filter(Boolean);
  if (!list.length) return false;
  const names = list.slice(0, 6).map((a) => `<li>${esc(displayName(a))} <span class="faint">@${esc(a.username)}</span></li>`).join('');
  const ok = await confirmDialog({
    title: list.length === 1 ? `Remove ${displayName(list[0])}?` : `Remove ${list.length} accounts?`,
    message: 'This deletes them from this app, including their saved sign-ins, notes and organisation. Your Roblox accounts themselves are not affected.',
    details: `<ul style="margin:0;padding-left:18px;color:var(--text-2)">${names}${list.length > 6 ? `<li>and ${list.length - 6} more…</li>` : ''}</ul>`,
    confirmLabel: list.length === 1 ? 'Remove account' : `Remove ${list.length} accounts`,
    danger: true,
    iconName: 'trash',
  });
  if (!ok) return false;
  try {
    const n = await call('accounts:remove', list.map((a) => a.id));
    toast({ type: 'success', message: `Removed ${plural(n, 'account')}.` });
    return true;
  } catch (e) {
    toast({ type: 'error', message: errorMessage(e) });
    return false;
  }
}

export async function refreshAccounts(ids = null, { full = false, quiet = false } = {}) {
  try {
    const r = await call('accounts:refresh', { ids, full });
    if (quiet) return r;
    const failed = Object.keys(r.errors || {});
    if (!failed.length) toast({ type: 'success', message: ids && ids.length === 1 ? 'Account refreshed.' : `Refreshed ${plural(r.total, 'account')}.` });
    else toast({ type: 'warning', title: 'Refreshed with problems', message: `Could not update: ${failed.join(', ')}. ${errorMessage({ code: Object.values(r.errors)[0] })}` });
    return r;
  } catch (e) {
    if (!quiet) toast({ type: 'error', message: errorMessage(e) });
    return null;
  }
}

export async function verifySession(id) {
  try {
    const r = await call('accounts:verify-session', id);
    if (r.error) toast({ type: 'warning', message: `Couldn't check right now: ${errorMessage({ code: r.error })}` });
    else if (r.status === 'valid') toast({ type: 'success', message: 'Sign-in is valid.' });
    else if (r.status === 'expired') toast({ type: 'error', title: 'Sign-in expired', message: 'Sign in to this account again to keep launching it.' });
    return r;
  } catch (e) {
    toast({ type: 'error', message: errorMessage(e) });
    return null;
  }
}

export async function assignGroup(ids) {
  const current = ids.length === 1 ? (state.accounts.get(ids[0]) || {}).group || '' : '';
  const name = await promptDialog({
    title: ids.length === 1 ? 'Move to group' : `Move ${ids.length} accounts to a group`,
    label: 'Group name',
    value: current,
    placeholder: 'e.g. Main, Alts, Trading',
    hint: 'Leave empty to remove from the group.',
    maxLength: 40,
    suggestions: groups().map((g) => g.name),
    confirmLabel: 'Move',
  });
  if (name === null) return;
  try {
    await call('accounts:bulk-update', ids, { group: name });
    toast({ type: 'success', message: name ? `Moved to “${name}”.` : 'Removed from group.' });
  } catch (e) { toast({ type: 'error', message: errorMessage(e) }); }
}

export async function addTag(ids) {
  const name = await promptDialog({
    title: ids.length === 1 ? 'Add tag' : `Tag ${ids.length} accounts`,
    label: 'Tag',
    placeholder: 'e.g. farming, verified, 2FA',
    maxLength: 24,
    suggestions: tags().map((t) => t.name),
    confirmLabel: 'Add tag',
  });
  if (!name) return;
  try { await call('accounts:bulk-update', ids, { addTag: name }); } catch (e) { toast({ type: 'error', message: errorMessage(e) }); }
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(String(text));
    toast({ type: 'success', message: label, duration: 1800 });
  } catch (_) {
    toast({ type: 'error', message: 'Could not copy to the clipboard.' });
  }
}

export function accountMenu(anchor, id) {
  const a = state.accounts.get(id);
  if (!a) return;
  const many = state.selection.size > 1 && state.selection.has(id);
  if (many) { bulkMenu(anchor); return; }
  openMenu(anchor, [
    { label: 'Launch', icon: 'play', run: () => launchAccounts([id]), disabled: a.session.status === 'none' },
    { label: 'Open details', icon: 'sliders', run: () => openDetail(id), kbd: 'Enter' },
    { label: 'Open Roblox profile', icon: 'external', run: () => call('accounts:open-profile', a.userId).catch(() => {}) },
    { separator: true },
    { label: a.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', run: () => toggleFavorite(id) },
    { label: a.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', run: () => togglePinned(id) },
    { label: a.group ? `Group: ${a.group}…` : 'Move to group…', icon: 'folder', run: () => assignGroup([id]) },
    { label: 'Add tag…', icon: 'tag', run: () => addTag([id]) },
    { separator: true },
    { label: 'Refresh profile', icon: 'refresh', run: () => refreshAccounts([id], { full: true }) },
    { label: 'Check sign-in', icon: 'shieldCheck', run: () => verifySession(id), disabled: a.session.status === 'none' },
    { label: 'Copy user ID', icon: 'copy', run: () => copyText(a.userId, 'User ID copied') },
    { label: 'Copy username', icon: 'copy', run: () => copyText(a.username, 'Username copied') },
    { separator: true },
    { label: 'Remove account…', icon: 'trash', danger: true, run: () => removeAccounts([id]) },
  ]);
}

export function bulkMenu(anchor) {
  const ids = [...state.selection];
  openMenu(anchor, [
    { heading: `${ids.length} selected` },
    { label: 'Launch together', icon: 'play', run: () => launchAccounts(ids) },
    { label: 'Add to favorites', icon: 'star', run: () => call('accounts:bulk-update', ids, { favorite: true }).catch(() => {}) },
    { label: 'Remove from favorites', icon: 'star', run: () => call('accounts:bulk-update', ids, { favorite: false }).catch(() => {}) },
    { label: 'Move to group…', icon: 'folder', run: () => assignGroup(ids) },
    { label: 'Add tag…', icon: 'tag', run: () => addTag(ids) },
    { label: 'Refresh', icon: 'refresh', run: () => refreshAccounts(ids) },
    { separator: true },
    { label: `Remove ${ids.length} accounts…`, icon: 'trash', danger: true, run: async () => { if (await removeAccounts(ids)) clearSelection(); } },
  ]);
}

export function clearSelection() {
  if (!state.selection.size) return;
  state.selection.clear();
  notify('selection');
}

export function toggleSelect(id, { range = false, visibleIds = [] } = {}) {
  if (range && state.lastSelected && visibleIds.includes(state.lastSelected)) {
    const a = visibleIds.indexOf(state.lastSelected);
    const b = visibleIds.indexOf(id);
    for (const x of visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selection.add(x);
  } else if (state.selection.has(id)) {
    state.selection.delete(id);
  } else {
    state.selection.add(id);
  }
  state.lastSelected = id;
  notify('selection');
}

export async function closeAllRoblox() {
  const ok = await confirmDialog({
    title: 'Close all Roblox windows?',
    message: 'Every running Roblox game window will be closed immediately. Unsaved progress in those games may be lost.',
    confirmLabel: 'Close Roblox',
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await call('roblox:close-all');
    toast({ type: 'success', message: r.closed ? `Closed ${plural(r.closed, 'Roblox window')}.` : 'No Roblox windows were open.' });
  } catch (e) { toast({ type: 'error', message: errorMessage(e) }); }
}

export function showShortcuts() {
  const rows = [
    ['Search accounts & commands', 'Ctrl K'], ['Filter accounts', 'Ctrl F'], ['Add account', 'Ctrl N'],
    ['Refresh all', 'Ctrl R'], ['Select all visible', 'Ctrl A'], ['Launch selected', 'Ctrl Enter'],
    ['Remove selected', 'Delete'], ['Go to Dashboard / Accounts / Games / Activity / Settings', 'Ctrl 1 – 5'],
    ['Close dialog, menu or selection', 'Esc'],
  ];
  openModal({
    title: 'Keyboard shortcuts',
    iconName: 'keyboard',
    body: `<div class="shortcut-list" style="padding:0">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${v.split(' ').map((x) => (x === '–' ? ' – ' : `<kbd>${esc(x)}</kbd>`)).join(' ')}</span>`).join('')}</div>`,
    footer: '<button class="btn primary" data-modal-close>Done</button>',
  });
}
