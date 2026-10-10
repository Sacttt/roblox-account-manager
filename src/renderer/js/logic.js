import { state, accountList } from './store.js';
import { displayName, isOnline, needsAttention } from './format.js';

export const CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'online', label: 'Online' },
  { id: 'ready', label: 'Ready' },
  { id: 'attention', label: 'Needs attention' },
];

const chipTest = {
  all: () => true,
  favorites: (a) => a.favorite,
  online: (a) => isOnline(a),
  ready: (a) => a.session.status === 'valid' || a.session.status === 'unknown',
  attention: (a) => needsAttention(a),
};

export function chipCounts() {
  const list = accountList();
  const out = {};
  for (const c of CHIPS) out[c.id] = list.filter(chipTest[c.id]).length;
  return out;
}

function matchesQuery(a, q) {
  if (!q) return true;
  const hay = [a.username, a.displayName, a.nickname, a.notes, a.group, ...(a.tags || []), String(a.userId)].join('\n').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const SORTS = {
  recent: (a, b) => (b.lastLaunchedAt || 0) - (a.lastLaunchedAt || 0) || (b.addedAt - a.addedAt),
  name: (a, b) => collator.compare(displayName(a), displayName(b)),
  username: (a, b) => collator.compare(a.username, b.username),
  added: (a, b) => b.addedAt - a.addedAt,
  status: (a, b) => presenceRank(b) - presenceRank(a) || collator.compare(displayName(a), displayName(b)),
  group: (a, b) => collator.compare(a.group || '￿', b.group || '￿') || collator.compare(displayName(a), displayName(b)),
};

function presenceRank(a) {
  if (!isOnline(a)) return 0;
  return { 2: 3, 3: 2, 1: 1 }[a.presence.type] || 0;
}

export function sortAccounts(list, mode = state.settings.sortMode) {
  const fn = SORTS[mode] || SORTS.recent;
  return [...list].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || fn(a, b));
}

export function filteredAccounts() {
  const { query, chip, group, tag } = state.filters;
  const test = chipTest[chip] || chipTest.all;
  const list = accountList().filter((a) => test(a)
    && (!group || (group === '__none' ? !a.group : a.group === group))
    && (!tag || (a.tags || []).includes(tag))
    && matchesQuery(a, query));
  return sortAccounts(list);
}

/** Fuzzy-ish scoring for the command palette. */
export function scoreAccount(a, q) {
  if (!q) return 1;
  const ql = q.toLowerCase();
  const fields = [displayName(a), a.username, a.displayName, a.group, ...(a.tags || [])].filter(Boolean).map((s) => s.toLowerCase());
  let best = 0;
  for (const f of fields) {
    if (f === ql) best = Math.max(best, 100);
    else if (f.startsWith(ql)) best = Math.max(best, 80);
    else if (f.includes(ql)) best = Math.max(best, 50);
    else if (isSubsequence(ql, f)) best = Math.max(best, 20);
  }
  return best;
}

function isSubsequence(q, s) {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}
