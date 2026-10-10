import { call } from '../api.js';
import { state, notify } from '../store.js';
import { esc, timeAgo, errorMessage } from '../format.js';
import { icon } from '../icons.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openDetail } from '../actions.js';

const TYPE_ICON = {
  'account.added': 'userPlus', 'account.removed': 'trash', 'session.updated': 'key', 'session.cleared': 'key',
  'session.expired': 'shieldOff', 'launch.success': 'play', 'launch.failed': 'alert', 'launch.batch': 'layers',
  'data.export': 'download', 'data.import': 'upload', 'roblox.closed': 'x',
};

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'launch', label: 'Launches', test: (e) => e.type.startsWith('launch') },
  { id: 'accounts', label: 'Accounts', test: (e) => e.type.startsWith('account') || e.type.startsWith('session') },
  { id: 'errors', label: 'Problems', test: (e) => e.level === 'error' || e.level === 'warning' },
];

export function activityItemHtml(e) {
  const acc = e.accountId && state.accounts.get(e.accountId);
  const detail = e.meta && e.meta.error ? ` — ${errorMessage({ code: e.meta.error })}` : '';
  return `<div class="activity-item ${esc(e.level)}" ${acc ? `data-open="${esc(acc.id)}" style="cursor:pointer"` : ''}>
    <span class="ic">${icon(TYPE_ICON[e.type] || 'info')}</span>
    <div style="min-width:0"><div>${esc(e.message)}</div>${detail ? `<div class="faint" style="font-size:12px">${esc(detail.slice(3))}</div>` : ''}</div>
    <span class="t" title="${esc(new Date(e.ts).toLocaleString())}">${esc(timeAgo(e.ts, { short: true }))}</span>
  </div>`;
}

export function mount(root) {
  let filter = 'all';
  root.innerHTML = `<div class="view-inner">
    <div class="page-head">
      <div><h1>Activity</h1><p>What the app has done on this PC. Sign-in cookies are never recorded.</p></div>
      <div class="actions"><button class="btn ghost" data-clear>${icon('trash', 'sm')}Clear history</button></div>
    </div>
    <div class="toolbar"><div class="filter-chips" data-filters></div></div>
    <div data-list></div>
  </div>`;
  root.querySelector('[data-clear]').addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Clear activity history?', message: 'This removes the history shown here. It does not change any accounts.', confirmLabel: 'Clear history', danger: true }))) return;
    try {
      await call('activity:clear');
      state.activity = [];
      notify('activity');
    } catch (e) { toast({ type: 'error', message: errorMessage(e) }); }
  });
  root.querySelector('[data-filters]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (b) { filter = b.dataset.f; render(); }
  });
  root.querySelector('[data-list]').addEventListener('click', (e) => {
    const item = e.target.closest('[data-open]');
    if (item) openDetail(item.dataset.open);
  });

  function render() {
    root.querySelector('[data-filters]').innerHTML = FILTERS.map((f) => `<button class="filter-chip ${filter === f.id ? 'active' : ''}" data-f="${f.id}">${esc(f.label)}</button>`).join('');
    const test = FILTERS.find((f) => f.id === filter).test;
    const items = state.activity.filter(test);
    const host = root.querySelector('[data-list]');
    if (!items.length) {
      host.innerHTML = `<div class="empty"><div class="art">${icon('activity')}</div><h3>Nothing here yet</h3><p>Launches, new accounts, imports and problems will be listed here.</p></div>`;
      return;
    }
    const byDay = new Map();
    for (const e of items) {
      const d = new Date(e.ts);
      const key = d.toDateString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    }
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    host.innerHTML = [...byDay.entries()].map(([day, list]) => `
      <div class="activity-day">${day === today ? 'Today' : day === yesterday ? 'Yesterday' : esc(new Date(list[0].ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</div>
      <section class="card">${list.map(activityItemHtml).join('')}</section>`).join('');
  }

  render();
  return { update(topics) { if (topics.has('activity') || topics.has('tick')) render(); } };
}
