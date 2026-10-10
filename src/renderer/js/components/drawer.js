import { call } from '../api.js';
import { state, notify, groups } from '../store.js';
import { esc, displayName, presenceInfo, sessionInfo, timeAgo, dateTime, date, errorMessage } from '../format.js';
import { icon } from '../icons.js';
import { avatarHtml, presenceHtml } from './account.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { launchAccounts, removeAccounts, refreshAccounts, verifySession, copyText, accountMenu, reloginAccount } from '../actions.js';

let mounted = null; // { id, el, backdrop, draft, dirty }

export function syncDrawer() {
  const id = state.detailId;
  const a = id ? state.accounts.get(id) : null;
  if (!a) { unmount(); return; }
  if (!mounted || mounted.id !== id) { unmount(); mount(a); return; }
  if (!mounted.dirty) syncFields(a);
  renderDynamic(a);
}

function syncFields(a) {
  const next = draftFrom(a);
  if (JSON.stringify(next) === JSON.stringify(mounted.draft)) return;
  mounted.draft = next;
  const q = (s) => mounted.el.querySelector(s);
  const active = document.activeElement;
  if (active !== q('#d-nick')) q('#d-nick').value = a.nickname;
  if (active !== q('#d-group')) q('#d-group').value = a.group;
  if (active !== q('#d-notes')) q('#d-notes').value = a.notes;
  q('#d-fav').checked = a.favorite;
  q('#d-pin').checked = a.pinned;
  renderTags();
}

export function drawerIsDirty() {
  return !!(mounted && mounted.dirty);
}

export async function requestCloseDrawer() {
  if (!mounted) return true;
  if (mounted.dirty) {
    const ok = await confirmDialog({ title: 'Discard changes?', message: 'You have unsaved changes to this account.', confirmLabel: 'Discard', danger: true });
    if (!ok) return false;
  }
  state.detailId = null;
  notify('detail');
  return true;
}

function unmount() {
  if (!mounted) return;
  mounted.el.remove();
  mounted.backdrop.remove();
  mounted = null;
}

function mount(a) {
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const el = document.createElement('aside');
  el.className = 'drawer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Account ${displayName(a)}`);
  document.getElementById('drawer-root').append(backdrop, el);
  mounted = { id: a.id, el, backdrop, dirty: false, draft: draftFrom(a) };
  backdrop.addEventListener('mousedown', () => requestCloseDrawer());

  const groupList = groups().map((g) => `<option value="${esc(g.name)}">`).join('');
  el.innerHTML = `
    <div class="drawer-head" data-head></div>
    <div class="drawer-body">
      <div class="row" style="margin:14px 0 4px;gap:6px;flex-wrap:wrap" data-actions></div>
      <div class="section-title">Sign-in</div>
      <div data-session></div>
      <div class="section-title">Organize</div>
      <div class="stack" style="gap:12px">
        <div class="form-grid">
          <div class="field"><label for="d-nick">Nickname</label><input id="d-nick" class="input" maxlength="60" placeholder="Shown instead of the display name"></div>
          <div class="field"><label for="d-group">Group</label><input id="d-group" class="input" maxlength="40" list="d-groups" placeholder="No group"><datalist id="d-groups">${groupList}</datalist></div>
        </div>
        <div class="field"><label>Tags</label><div class="tag-input" data-tags></div><span class="hint">Press Enter or comma to add a tag.</span></div>
        <div class="field"><label for="d-notes">Notes</label><textarea id="d-notes" class="textarea" maxlength="4000" rows="4" placeholder="Private notes — stored only on this PC"></textarea></div>
        <div class="row" style="gap:18px">
          <label class="row" style="gap:8px;cursor:pointer"><span class="switch"><input type="checkbox" id="d-fav"><span></span></span>Favorite</label>
          <label class="row" style="gap:8px;cursor:pointer"><span class="switch"><input type="checkbox" id="d-pin"><span></span></span>Pin to top</label>
        </div>
      </div>
      <div class="section-title">Details</div>
      <dl class="kv" data-details></dl>
      <div class="section-title">Icon</div>
      <div class="row" data-icon></div>
      <div class="section-title">Danger zone</div>
      <button class="btn danger-ghost" data-remove>${icon('trash')}Remove account</button>
    </div>
    <div class="drawer-foot" data-foot hidden>
      <span class="faint" style="margin-right:auto;align-self:center">Unsaved changes</span>
      <button class="btn ghost" data-revert>Revert</button>
      <button class="btn primary" data-save>${icon('check', 'sm')}Save</button>
    </div>`;

  const q = (s) => el.querySelector(s);
  q('#d-nick').value = a.nickname;
  q('#d-group').value = a.group;
  q('#d-notes').value = a.notes;
  q('#d-fav').checked = a.favorite;
  q('#d-pin').checked = a.pinned;
  renderTags();

  const markDirty = () => {
    const d = mounted.draft;
    d.nickname = q('#d-nick').value;
    d.group = q('#d-group').value;
    d.notes = q('#d-notes').value;
    d.favorite = q('#d-fav').checked;
    d.pinned = q('#d-pin').checked;
    const cur = state.accounts.get(mounted.id);
    mounted.dirty = !!cur && JSON.stringify(normalizeDraft(d)) !== JSON.stringify(normalizeDraft(draftFrom(cur)));
    q('[data-foot]').hidden = !mounted.dirty;
  };
  for (const s of ['#d-nick', '#d-group', '#d-notes']) q(s).addEventListener('input', markDirty);
  for (const s of ['#d-fav', '#d-pin']) q(s).addEventListener('change', markDirty);
  mounted.markDirty = markDirty;

  q('[data-save]').addEventListener('click', save);
  q('[data-revert]').addEventListener('click', () => { const cur = state.accounts.get(mounted.id); unmount(); if (cur) mount(cur); });
  q('[data-remove]').addEventListener('click', async () => {
    if (await removeAccounts([a.id])) { mounted && (mounted.dirty = false); }
  });
  el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (mounted.dirty) save(); }
  });
  el.addEventListener('click', onClick);
  renderDynamic(a);
  requestAnimationFrame(() => q('[data-actions] .btn')?.focus());
}

function draftFrom(a) {
  return { nickname: a.nickname, group: a.group, notes: a.notes, tags: [...(a.tags || [])], favorite: a.favorite, pinned: a.pinned };
}

function normalizeDraft(d) {
  return { nickname: d.nickname.trim(), group: d.group.trim(), notes: d.notes.trim(), tags: d.tags, favorite: d.favorite, pinned: d.pinned };
}

async function save() {
  if (!mounted) return;
  const btn = mounted.el.querySelector('[data-save]');
  btn.disabled = true;
  try {
    await call('accounts:update', mounted.id, normalizeDraft(mounted.draft));
    mounted.dirty = false;
    mounted.el.querySelector('[data-foot]').hidden = true;
    toast({ type: 'success', message: 'Saved.', duration: 1800 });
  } catch (e) {
    toast({ type: 'error', message: errorMessage(e) });
  } finally {
    btn.disabled = false;
  }
}

function renderTags() {
  const host = mounted.el.querySelector('[data-tags]');
  host.innerHTML = `${mounted.draft.tags.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-tag-remove="${i}" aria-label="Remove tag ${esc(t)}">${icon('x', 'sm')}</button></span>`).join('')}
    <input type="text" maxlength="24" placeholder="${mounted.draft.tags.length ? '' : 'Add a tag…'}" aria-label="Add tag">`;
  const input = host.querySelector('input');
  const commit = () => {
    const v = input.value.replace(/,/g, '').trim();
    if (v && !mounted.draft.tags.some((t) => t.toLowerCase() === v.toLowerCase()) && mounted.draft.tags.length < 12) {
      mounted.draft.tags.push(v);
      renderTags();
      mounted.markDirty && mounted.markDirty();
      mounted.el.querySelector('[data-tags] input').focus();
    } else input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !input.value && mounted.draft.tags.length) { mounted.draft.tags.pop(); renderTags(); mounted.markDirty && mounted.markDirty(); mounted.el.querySelector('[data-tags] input').focus(); }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
  host.onclick = (e) => {
    const rm = e.target.closest('[data-tag-remove]');
    if (rm) { mounted.draft.tags.splice(Number(rm.dataset.tagRemove), 1); renderTags(); mounted.markDirty && mounted.markDirty(); return; }
    if (e.target === host) input.focus();
  };
}

function renderDynamic(a) {
  const q = (s) => mounted.el.querySelector(s);
  const p = presenceInfo(a);
  q('[data-head]').innerHTML = `
    ${avatarHtml(a, 'xl')}
    <div class="names">
      <h2><span class="truncate">${esc(displayName(a))}</span>${a.favorite ? `<span class="pin-mark">${icon('star', 'sm fill')}</span>` : ''}</h2>
      <div class="faint truncate">@${esc(a.username)}${a.displayName && a.displayName !== displayName(a) ? ` · ${esc(a.displayName)}` : ''}</div>
      <div style="margin-top:6px" class="row">${presenceHtml(a)}${a.profile.isBanned === true ? `<span class="badge red">${icon('alert')}Banned</span>` : ''}</div>
    </div>
    <button class="btn ghost sm icon-only" data-d="close" aria-label="Close">${icon('x')}</button>`;

  const launching = state.launchingIds.has(a.id);
  q('[data-actions]').innerHTML = `
    <button class="btn primary" data-d="launch" ${a.session.status === 'none' || launching ? 'disabled' : ''}>${launching ? '<span class="spinner"></span>Launching' : `${icon('play', 'sm')}Launch`}</button>
    <button class="btn" data-d="profile">${icon('external', 'sm')}Profile</button>
    <button class="btn" data-d="refresh">${icon('refresh', 'sm')}Refresh</button>
    <button class="btn icon-only" data-d="more" aria-label="More actions">${icon('more')}</button>`;

  const s = sessionInfo(a);
  const sessionText = {
    valid: `Works — ${a.session.checkedAt ? `verified ${timeAgo(a.session.checkedAt)}` : 'verified'}. Launching signs in automatically.`,
    unknown: 'A sign-in is saved. It will be checked the next time you launch or verify it.',
    expired: 'Roblox no longer accepts the saved sign-in (it was signed out or expired). Sign in again to keep launching this account.',
    none: 'No sign-in is saved for this account, so it can\'t be launched yet.',
  }[s.status];
  q('[data-session]').innerHTML = `<div class="session-card ${s.status}">
      <div class="head"><div class="ic">${icon(s.icon)}</div><div style="flex:1;min-width:0"><strong>${esc(s.label === 'Saved' ? 'Sign-in saved' : s.label)}</strong><div class="faint" style="font-size:12.5px">${esc(sessionText)}</div></div></div>
      <div class="row" style="flex-wrap:wrap;gap:6px">
        ${s.status !== 'none' ? `<button class="btn sm" data-d="verify">${icon('shieldCheck', 'sm')}Check now</button>` : ''}
        <button class="btn sm ${s.status === 'expired' || s.status === 'none' ? 'primary' : ''}" data-d="relogin">${icon('logIn', 'sm')}${s.status === 'none' ? 'Sign in' : 'Sign in again'}</button>
        <button class="btn sm ghost" data-d="paste">${icon('key', 'sm')}Paste cookie</button>
        ${s.status !== 'none' ? `<button class="btn sm ghost" data-d="clear-session" style="color:var(--red)">Remove</button>` : ''}
      </div></div>`;

  q('[data-details]').innerHTML = `
    <dt>User ID</dt><dd class="row" style="gap:6px"><span class="mono selectable">${esc(a.userId)}</span><button class="icon-btn" data-d="copy-id" title="Copy" style="width:22px;height:22px">${icon('copy', 'sm')}</button></dd>
    <dt>Display name</dt><dd>${esc(a.displayName)}</dd>
    <dt>Account created</dt><dd>${a.profile.created ? date(a.profile.created) : '<span class="faint">Not loaded yet</span>'}</dd>
    <dt>Ban status</dt><dd>${a.profile.isBanned === null ? '<span class="faint">Not checked yet</span>' : (a.profile.isBanned ? '<span style="color:var(--red)">Banned</span>' : 'Not banned')}${a.profile.fetchedAt ? ` <span class="faint">· checked ${timeAgo(a.profile.fetchedAt)}</span>` : ''}</dd>
    <dt>Status</dt><dd>${esc(p.text)} ${a.presence ? `<span class="faint">· ${esc(p.asOf)}</span>` : ''}</dd>
    <dt>Last launched</dt><dd>${a.lastLaunchedAt ? `${dateTime(a.lastLaunchedAt)} <span class="faint">· ${a.launchCount} total</span>` : '<span class="faint">Never</span>'}</dd>
    <dt>Added</dt><dd>${dateTime(a.addedAt)}</dd>`;

  q('[data-icon]').innerHTML = `<button class="btn sm" data-d="pick-icon">${icon('image', 'sm')}${a.hasCustomIcon ? 'Change custom icon' : 'Use a custom icon'}</button>
    ${a.hasCustomIcon ? `<button class="btn sm ghost" data-d="clear-icon">Use Roblox avatar</button>` : '<span class="faint">Shown instead of the Roblox avatar in this app.</span>'}`;
}

async function onClick(e) {
  const b = e.target.closest('[data-d]');
  if (!b || !mounted) return;
  const id = mounted.id;
  const a = state.accounts.get(id);
  if (!a) return;
  switch (b.dataset.d) {
    case 'close': requestCloseDrawer(); break;
    case 'launch': launchAccounts([id]); break;
    case 'profile': call('accounts:open-profile', a.userId).catch(() => {}); break;
    case 'refresh': b.disabled = true; await refreshAccounts([id], { full: true }); b.disabled = false; break;
    case 'more': accountMenu(b, id); break;
    case 'verify': b.disabled = true; await verifySession(id); b.disabled = false; break;
    case 'copy-id': copyText(a.userId, 'User ID copied'); break;
    case 'relogin': reloginAccount(id); break;
    case 'paste': pasteCookie(a); break;
    case 'clear-session': {
      const ok = await confirmDialog({ title: 'Remove saved sign-in?', message: `The encrypted sign-in for @${a.username} will be deleted from this PC. You'll need to sign in again to launch it. Your Roblox account is not affected.`, confirmLabel: 'Remove sign-in', danger: true });
      if (ok) call('accounts:clear-session', id).then(() => toast({ type: 'success', message: 'Sign-in removed.' })).catch((err) => toast({ type: 'error', message: errorMessage(err) }));
      break;
    }
    case 'pick-icon': call('accounts:pick-icon', id).catch((err) => toast({ type: 'error', message: errorMessage(err) })); break;
    case 'clear-icon': call('accounts:clear-icon', id).catch((err) => toast({ type: 'error', message: errorMessage(err) })); break;
    default: break;
  }
}


function pasteCookie(a) {
  const m = openModal({
    title: `Update sign-in for @${a.username}`,
    iconName: 'key',
    body: `<div class="note warn">${icon('alert')}<div>Only paste the cookie for <strong>@${esc(a.username)}</strong>. It is verified with Roblox and stored encrypted.</div></div>
      <div class="field"><label for="pc">.ROBLOSECURITY cookie</label><textarea id="pc" class="textarea mono input masked" rows="4" spellcheck="false" autocomplete="off" autofocus></textarea><span class="error" hidden data-err></span></div>`,
    footer: '<button class="btn ghost" data-modal-close>Cancel</button><button class="btn primary" data-ok>Verify &amp; save</button>',
  });
  m.el.querySelector('[data-ok]').addEventListener('click', async () => {
    const v = m.el.querySelector('#pc').value;
    m.setBusy(true);
    try {
      await call('accounts:set-session', a.id, v);
      m.close();
      toast({ type: 'success', message: 'Sign-in updated.' });
    } catch (e) {
      m.setBusy(false);
      const err = m.el.querySelector('[data-err]');
      err.textContent = errorMessage(e);
      err.hidden = false;
    }
  });
}
