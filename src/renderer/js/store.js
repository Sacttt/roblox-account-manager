// Single source of UI state. Views subscribe; changes are batched per frame.

export const state = {
  ready: false,
  version: '',
  platform: '',
  packaged: false,
  settings: {},
  accounts: new Map(),
  presets: [],
  activity: [],
  notes: [],
  vault: null,
  view: 'dashboard',
  settingsSection: 'general',
  selection: new Set(),
  filters: { query: '', chip: 'all', group: '', tag: '' },
  detailId: null,
  launch: { busy: false },
  launchingIds: new Set(),
  refresh: { running: false, result: null, at: null },
  target: { text: '', parsed: null },
  updates: null,
};

const listeners = new Set();
let pending = new Set();
let scheduled = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Marks parts of the state as changed, e.g. notify('accounts'). */
export function notify(...topics) {
  for (const t of topics) pending.add(t);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const topicsNow = pending;
    pending = new Set();
    for (const fn of listeners) {
      try { fn(topicsNow); } catch (e) { console.error(e); }
    }
  });
}

export function accountList() {
  return [...state.accounts.values()];
}

export function upsertAccounts(list) {
  for (const a of list) state.accounts.set(a.id, a);
  notify('accounts');
}

export function removeAccounts(ids) {
  for (const id of ids) {
    state.accounts.delete(id);
    state.selection.delete(id);
  }
  if (state.detailId && ids.includes(state.detailId)) state.detailId = null;
  notify('accounts', 'selection', 'detail');
}

export function groups() {
  const map = new Map();
  for (const a of state.accounts.values()) if (a.group) map.set(a.group, (map.get(a.group) || 0) + 1);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

export function tags() {
  const map = new Map();
  for (const a of state.accounts.values()) for (const t of a.tags || []) map.set(t, (map.get(t) || 0) + 1);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}
