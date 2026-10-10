import { call } from '../api.js';
import { state, notify, groups, tags, accountList } from '../store.js';
import { esc, plural } from '../format.js';
import { icon } from '../icons.js';
import { CHIPS, chipCounts, filteredAccounts } from '../logic.js';
import { cardHtml, rowHtml } from '../components/account.js';
import { launchBarHtml, bindLaunchBar } from '../components/launch-bar.js';
import { openAddAccount } from '../components/add-account.js';
import {
  openDetail, launchAccounts, toggleFavorite, accountMenu, toggleSelect, clearSelection, bulkMenu,
  removeAccounts, refreshAccounts, assignGroup, addTag, reloginAccount,
} from '../actions.js';

export function mount(root) {
  root.innerHTML = `<div class="view-inner">
    <div class="page-head">
      <div><h1>Accounts</h1><p data-sub></p></div>
      <div class="actions">
        <button class="btn" data-refresh>${icon('refresh', 'sm')}Refresh</button>
        <button class="btn primary" data-add>${icon('plus', 'sm')}Add account</button>
      </div>
    </div>
    ${launchBarHtml()}
    <div class="toolbar">
      <div class="input-wrap search">${icon('search')}<input class="input sm" data-search placeholder="Search name, user, notes, tags…" value="${esc(state.filters.query)}" aria-label="Search accounts">
        <span class="trail"><kbd>Ctrl F</kbd></span></div>
      <span class="spacer"></span>
      <select class="select sm" data-group style="width:150px" aria-label="Filter by group"></select>
      <select class="select sm" data-tag style="width:130px" aria-label="Filter by tag"></select>
      <select class="select sm" data-sort style="width:160px" aria-label="Sort accounts">
        <option value="recent">Recently launched</option><option value="name">Name</option><option value="username">Username</option>
        <option value="added">Recently added</option><option value="status">Online first</option><option value="group">Group</option>
      </select>
      <div class="btn-group" role="group" aria-label="View">
        <button data-view-mode="grid" title="Cards" aria-label="Card view">${icon('grid', 'sm')}</button>
        <button data-view-mode="list" title="Table" aria-label="Table view">${icon('list', 'sm')}</button>
      </div>
    </div>
    <div class="toolbar"><div class="filter-chips" data-chips></div></div>
    <div data-list></div>
  </div>
  <div class="bulk-bar" data-bulk hidden></div>`;

  const $ = (s) => root.querySelector(s);
  const listHost = $('[data-list]');
  let visibleIds = [];

  bindLaunchBar(root);
  $('[data-add]').addEventListener('click', () => openAddAccount());
  $('[data-refresh]').addEventListener('click', () => refreshAccounts(null, { full: true }));
  const search = $('[data-search]');
  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.filters.query = search.value; notify('filters'); }, 120);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; state.filters.query = ''; notify('filters'); }
    if (e.key === 'Enter' && visibleIds.length) openDetail(visibleIds[0]);
  });
  $('[data-chips]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (b) { state.filters.chip = b.dataset.chip; notify('filters'); }
  });
  $('[data-group]').addEventListener('change', (e) => { state.filters.group = e.target.value; notify('filters'); });
  $('[data-tag]').addEventListener('change', (e) => { state.filters.tag = e.target.value; notify('filters'); });
  $('[data-sort]').addEventListener('change', (e) => call('settings:update', { sortMode: e.target.value }).catch(() => {}));
  root.querySelectorAll('[data-view-mode]').forEach((b) => b.addEventListener('click', () => call('settings:update', { viewMode: b.dataset.viewMode }).catch(() => {})));

  listHost.addEventListener('click', onListClick);
  listHost.addEventListener('dblclick', (e) => {
    const item = e.target.closest('[data-action="open"]');
    if (item && !e.target.closest('button')) launchAccounts([item.dataset.id]);
  });
  listHost.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    e.preventDefault();
    accountMenu({ x: e.clientX, y: e.clientY }, item.dataset.id);
  });
  listHost.addEventListener('keydown', (e) => {
    const item = e.target.closest('[data-action="open"]');
    if (!item || e.target !== item) return;
    if (e.key === 'Enter') { e.preventDefault(); openDetail(item.dataset.id); }
    if (e.key === ' ') { e.preventDefault(); toggleSelect(item.dataset.id, { visibleIds }); }
  });
  $('[data-bulk]').addEventListener('click', onBulkClick);

  function onListClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || !listHost.contains(el)) return;
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'select': e.stopPropagation(); toggleSelect(id, { range: e.shiftKey, visibleIds }); break;
      case 'favorite': e.stopPropagation(); toggleFavorite(id); break;
      case 'launch': e.stopPropagation(); launchAccounts(state.selection.has(id) && state.selection.size > 1 ? [...state.selection] : [id]); break;
      case 'relogin': e.stopPropagation(); reloginAccount(id); break;
      case 'menu': e.stopPropagation(); accountMenu(el, id); break;
      case 'select-all': toggleAll(); break;
      case 'clear-filters': state.filters = { query: '', chip: 'all', group: '', tag: '' }; search.value = ''; notify('filters'); break;
      case 'add': openAddAccount(); break;
      case 'open':
        if (e.ctrlKey || e.metaKey || e.shiftKey || state.selection.size) toggleSelect(id, { range: e.shiftKey, visibleIds });
        else openDetail(id);
        break;
      default: break;
    }
  }

  function toggleAll() {
    const allSelected = visibleIds.length && visibleIds.every((id) => state.selection.has(id));
    if (allSelected) visibleIds.forEach((id) => state.selection.delete(id));
    else visibleIds.forEach((id) => state.selection.add(id));
    notify('selection');
  }

  async function onBulkClick(e) {
    const b = e.target.closest('[data-bulk-action]');
    if (!b) return;
    const ids = [...state.selection].filter((id) => state.accounts.has(id));
    switch (b.dataset.bulkAction) {
      case 'launch': launchAccounts(ids); break;
      case 'favorite': call('accounts:bulk-update', ids, { favorite: !ids.every((id) => state.accounts.get(id).favorite) }).catch(() => {}); break;
      case 'group': assignGroup(ids); break;
      case 'tag': addTag(ids); break;
      case 'refresh': refreshAccounts(ids); break;
      case 'remove': if (await removeAccounts(ids)) clearSelection(); break;
      case 'more': bulkMenu(b); break;
      case 'clear': clearSelection(); break;
      default: break;
    }
  }

  function renderToolbar() {
    const counts = chipCounts();
    $('[data-chips]').innerHTML = CHIPS.map((c) => `<button class="filter-chip ${state.filters.chip === c.id ? 'active' : ''}" data-chip="${c.id}">${esc(c.label)}<span class="n">${counts[c.id]}</span></button>`).join('');
    const gs = groups();
    const groupSel = $('[data-group]');
    groupSel.innerHTML = `<option value="">All groups</option>${gs.map((g) => `<option value="${esc(g.name)}">${esc(g.name)} (${g.count})</option>`).join('')}<option value="__none">No group</option>`;
    if (state.filters.group && state.filters.group !== '__none' && !gs.some((g) => g.name === state.filters.group)) state.filters.group = '';
    groupSel.value = state.filters.group;
    const ts = tags();
    const tagSel = $('[data-tag]');
    tagSel.innerHTML = `<option value="">All tags</option>${ts.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${t.count})</option>`).join('')}`;
    if (state.filters.tag && !ts.some((t) => t.name === state.filters.tag)) state.filters.tag = '';
    tagSel.value = state.filters.tag;
    tagSel.hidden = !ts.length;
    $('[data-sort]').value = state.settings.sortMode || 'recent';
    root.querySelectorAll('[data-view-mode]').forEach((b) => b.classList.toggle('active', b.dataset.viewMode === (state.settings.viewMode || 'grid')));
    if (document.activeElement !== search && search.value !== state.filters.query) search.value = state.filters.query;
  }

  function renderList() {
    const total = accountList().length;
    const list = filteredAccounts();
    visibleIds = list.map((a) => a.id);
    $('[data-sub]').textContent = list.length === total ? plural(total, 'account') : `${list.length} of ${plural(total, 'account')} shown`;
    const refreshBtn = $('[data-refresh]');
    refreshBtn.disabled = state.refresh.running;
    refreshBtn.innerHTML = state.refresh.running ? '<span class="spinner"></span>Refreshing' : `${icon('refresh', 'sm')}Refresh`;

    if (!total) {
      listHost.innerHTML = `<div class="empty"><div class="art">${icon('users')}</div><h3>No accounts yet</h3><p>Add your first Roblox account to start launching it in one click.</p><button class="btn primary" data-action="add">${icon('plus', 'sm')}Add account</button></div>`;
      return;
    }
    if (!list.length) {
      listHost.innerHTML = `<div class="empty"><div class="art">${icon('search')}</div><h3>No matching accounts</h3><p>Nothing matches the current search and filters.</p><button class="btn" data-action="clear-filters">Clear filters</button></div>`;
      return;
    }
    if ((state.settings.viewMode || 'grid') === 'list') {
      const all = list.every((a) => state.selection.has(a.id));
      const some = !all && list.some((a) => state.selection.has(a.id));
      listHost.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>
        <th class="col-check"><button class="check ${all ? 'on' : some ? 'partial' : ''}" data-action="select-all" aria-label="Select all">${all ? icon('check') : ''}</button></th>
        <th>Account</th><th>Status</th><th>Sign-in</th><th class="hide-md">Group &amp; tags</th><th class="hide-md">Last launched</th><th class="col-actions"></th>
      </tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table></div>`;
    } else {
      listHost.innerHTML = `<div class="account-grid">${list.map(cardHtml).join('')}</div>`;
    }
    renderSelection();
  }

  function renderSelection() {
    const n = state.selection.size;
    listHost.classList.toggle('has-selection', n > 0);
    listHost.querySelectorAll('[data-id][data-action="open"]').forEach((el) => {
      const on = state.selection.has(el.dataset.id);
      el.classList.toggle('selected', on);
      const cb = el.querySelector('.check');
      if (cb) { cb.classList.toggle('on', on); cb.setAttribute('aria-pressed', String(on)); }
    });
    const head = listHost.querySelector('[data-action="select-all"]');
    if (head) {
      const all = visibleIds.length && visibleIds.every((id) => state.selection.has(id));
      const some = !all && visibleIds.some((id) => state.selection.has(id));
      head.className = `check ${all ? 'on' : some ? 'partial' : ''}`;
      head.innerHTML = all ? icon('check') : '';
    }
    const bar = $('[data-bulk]');
    bar.hidden = n === 0;
    if (n) {
      const ids = [...state.selection];
      const allFav = ids.every((id) => state.accounts.get(id) && state.accounts.get(id).favorite);
      const visible = new Set(visibleIds);
      const hidden = ids.filter((id) => !visible.has(id)).length;
      bar.innerHTML = `<span class="count">${n} selected${hidden ? ` <span class="faint" title="Some selected accounts are hidden by the current search or filters; bulk actions include them.">· ${hidden} hidden</span>` : ''}</span>
        <button class="btn sm primary" data-bulk-action="launch" ${state.launch.busy ? 'disabled' : ''}>${icon('play', 'sm')}Launch together</button>
        <span class="sep"></span>
        <button class="btn sm ghost" data-bulk-action="favorite">${icon('star', 'sm')}${allFav ? 'Unfavorite' : 'Favorite'}</button>
        <button class="btn sm ghost" data-bulk-action="group">${icon('folder', 'sm')}Group</button>
        <button class="btn sm ghost" data-bulk-action="tag">${icon('tag', 'sm')}Tag</button>
        <button class="btn sm ghost" data-bulk-action="refresh">${icon('refresh', 'sm')}Refresh</button>
        <button class="btn sm ghost" data-bulk-action="remove" style="color:var(--red)">${icon('trash', 'sm')}Remove</button>
        <span class="sep"></span>
        <button class="btn sm ghost icon-only" data-bulk-action="clear" title="Clear selection (Esc)" aria-label="Clear selection">${icon('x')}</button>`;
    }
  }

  renderToolbar();
  renderList();

  return {
    visibleIds: () => visibleIds,
    focusSearch() { search.focus(); search.select(); },
    update(topics) {
      if (topics.has('accounts') || topics.has('filters') || topics.has('settings')) renderToolbar();
      if (topics.has('accounts') || topics.has('filters') || topics.has('settings') || topics.has('launch') || topics.has('refresh') || topics.has('tick')) renderList();
      else if (topics.has('selection')) renderSelection();
    },
  };
}
