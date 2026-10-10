import { state, accountList } from '../store.js';
import { esc, displayName, isOnline, needsAttention, timeAgo, sessionInfo, plural } from '../format.js';
import { icon } from '../icons.js';
import { avatarHtml, presenceHtml } from '../components/account.js';
import { launchBarHtml, bindLaunchBar } from '../components/launch-bar.js';
import { activityItemHtml } from './activity.js';
import { openAddAccount } from '../components/add-account.js';
import { navigate, openDetail, launchAccounts, refreshAccounts } from '../actions.js';

export function mount(root) {
  root.innerHTML = '<div class="view-inner" data-dash></div>';
  const host = root.querySelector('[data-dash]');
  let lastShape = '';

  function render() {
    const list = accountList();
    if (!list.length) {
      if (lastShape === 'empty') return;
      lastShape = 'empty';
      host.innerHTML = onboardingHtml();
      host.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openAddAccount({ method: b.dataset.add })));
      return;
    }
    const firstRender = lastShape !== 'full';
    lastShape = 'full';
    if (firstRender) {
      host.innerHTML = `
        <div class="page-head">
          <div><h1>Overview</h1><p data-sub></p></div>
          <div class="actions">
            <button class="btn" data-refresh>${icon('refresh', 'sm')}Refresh</button>
            <button class="btn primary" data-add-account>${icon('plus', 'sm')}Add account</button>
          </div>
        </div>
        ${launchBarHtml()}
        <div class="stats" data-stats></div>
        <div class="dash-grid">
          <div class="stack" style="gap:12px">
            <section class="card"><div class="card-head"><h3>Quick launch</h3><span class="faint">Favorites</span><div class="actions"><button class="btn xs ghost" data-go="accounts" data-chip="favorites">View all</button></div></div><div data-quick style="padding-top:12px"></div></section>
            <section class="card"><div class="card-head"><h3>Recently launched</h3><div class="actions"><button class="btn xs ghost" data-go="accounts">All accounts</button></div></div><div class="list" data-recent style="margin-top:8px"></div></section>
          </div>
          <div class="stack" style="gap:12px">
            <section class="card"><div class="card-head"><h3>Needs attention</h3></div><div class="list" data-attention style="margin-top:8px"></div></section>
            <section class="card"><div class="card-head"><h3>Recent activity</h3><div class="actions"><button class="btn xs ghost" data-go="activity">View all</button></div></div><div data-activity style="margin-top:6px"></div></section>
          </div>
        </div>`;
      bindLaunchBar(host);
      host.querySelector('[data-add-account]').addEventListener('click', () => openAddAccount());
      host.querySelector('[data-refresh]').addEventListener('click', () => refreshAccounts(null, { full: true }));
      host.addEventListener('click', onClick);
    }
    renderParts(list);
  }

  function renderParts(list) {
    const online = list.filter(isOnline);
    const ready = list.filter((a) => a.session.status === 'valid' || a.session.status === 'unknown');
    const attention = list.filter(needsAttention);
    const presenceTimes = list.map((a) => a.presence && a.presence.fetchedAt).filter(Boolean);
    const newest = presenceTimes.length ? Math.max(...presenceTimes) : null;
    const lastSync = state.refresh.running ? 'Refreshing…' : (newest ? `Live status updated ${timeAgo(newest)}` : 'Live status not loaded yet');
    host.querySelector('[data-sub]').textContent = `${plural(list.length, 'account')} · ${lastSync}`;
    const refreshBtn = host.querySelector('[data-refresh]');
    refreshBtn.disabled = state.refresh.running;
    refreshBtn.innerHTML = state.refresh.running ? '<span class="spinner"></span>Refreshing' : `${icon('refresh', 'sm')}Refresh`;

    host.querySelector('[data-stats]').innerHTML = [
      stat('users', 'Accounts', list.length, `${list.filter((a) => a.favorite).length} favorites`, 'all'),
      stat('shieldCheck', 'Ready to launch', ready.length, `${list.filter((a) => a.session.status === 'valid').length} verified this session`, 'ready'),
      stat('alert', 'Needs attention', attention.length, attention.length ? 'Expired or missing sign-ins' : 'All good', 'attention', attention.length > 0),
      stat('activity', 'Online now', newest ? online.length : '—', newest ? `Reported by Roblox ${timeAgo(newest, { short: true })}` : 'Refresh to load live status', 'online'),
    ].join('');

    const favorites = list.filter((a) => a.favorite).slice(0, 12);
    host.querySelector('[data-quick]').innerHTML = favorites.length
      ? `<div class="quick-row">${favorites.map((a) => `<button class="quick-tile" data-quick-launch="${esc(a.id)}" title="Launch ${esc(displayName(a))}" ${a.session.status === 'none' ? 'disabled' : ''}>
          ${avatarHtml(a, 'lg')}<span class="n truncate">${esc(displayName(a))}</span>
          <span class="play">${state.launchingIds.has(a.id) ? '<span class="spinner" style="width:11px;height:11px"></span>Launching' : `${icon('play', 'sm')}Launch`}</span></button>`).join('')}</div>`
      : `<div class="empty" style="padding:18px 16px 22px"><p>Star accounts to launch them in one click from here.</p></div>`;

    const recent = list.filter((a) => a.lastLaunchedAt).sort((a, b) => b.lastLaunchedAt - a.lastLaunchedAt).slice(0, 6);
    host.querySelector('[data-recent]').innerHTML = recent.length
      ? recent.map((a) => `<div class="list-item" data-open="${esc(a.id)}">${avatarHtml(a, 'md')}
          <div class="grow"><div class="title truncate">${esc(displayName(a))}</div><div class="sub">Launched ${timeAgo(a.lastLaunchedAt)} · ${presenceHtml(a)}</div></div>
          <button class="btn sm" data-quick-launch="${esc(a.id)}" ${a.session.status === 'none' ? 'disabled' : ''}>${icon('play', 'sm')}Launch</button></div>`).join('')
      : `<div class="empty" style="padding:22px 16px"><p>Accounts you launch will show up here.</p></div>`;

    host.querySelector('[data-attention]').innerHTML = attention.length
      ? attention.slice(0, 6).map((a) => {
        const s = sessionInfo(a);
        const reason = a.profile.isBanned ? 'Roblox reports this account as banned' : s.title;
        return `<div class="list-item" data-open="${esc(a.id)}">${avatarHtml(a, 'md', { presence: false })}
          <div class="grow"><div class="title truncate">${esc(displayName(a))}</div><div class="sub truncate">${esc(reason)}</div></div>
          <span class="badge ${a.profile.isBanned ? 'red' : s.cls}">${esc(a.profile.isBanned ? 'Banned' : s.label)}</span></div>`;
      }).join('') + (attention.length > 6 ? `<div class="list-item" data-go="accounts" data-chip="attention"><span class="muted">View all ${attention.length}…</span></div>` : '')
      : `<div class="empty" style="padding:22px 16px"><div class="art" style="width:40px;height:40px">${icon('check')}</div><p>Every account has a saved sign-in.</p></div>`;

    const items = state.activity.slice(0, 6);
    host.querySelector('[data-activity]').innerHTML = items.length
      ? items.map(activityItemHtml).join('')
      : '<div class="empty" style="padding:22px 16px"><p>No activity yet.</p></div>';
  }

  function stat(ic, label, value, sub, chip, warn = false) {
    return `<button class="card stat ${warn ? 'warn' : ''}" data-go="accounts" data-chip="${chip}">
      <span class="k">${icon(ic, 'sm')}${esc(label)}</span><span class="v">${esc(value)}</span><span class="s">${esc(sub)}</span></button>`;
  }

  function onClick(e) {
    const ql = e.target.closest('[data-quick-launch]');
    if (ql) { e.stopPropagation(); launchAccounts([ql.dataset.quickLaunch]); return; }
    const go = e.target.closest('[data-go]');
    if (go) { navigate(go.dataset.go, go.dataset.chip ? { filters: { chip: go.dataset.chip, group: '', tag: '', query: '' } } : {}); return; }
    const open = e.target.closest('[data-open]');
    if (open) openDetail(open.dataset.open);
  }

  render();
  return {
    update(topics) {
      if (topics.has('accounts') || topics.has('activity') || topics.has('refresh') || topics.has('launch') || topics.has('tick')) render();
    },
  };
}

function onboardingHtml() {
  return `<div class="onboard">
    <img class="logo" src="assets/icon.png" alt="">
    <h1>Welcome to Roblox Account Manager</h1>
    <p>Keep all of your Roblox accounts in one place and open any of them — or several at once — signed in and ready to play.</p>
    <div class="choice-grid">
      <button class="choice" data-add="web"><span class="ic">${icon('globe')}</span><h4>Sign in with Roblox</h4><p>Recommended. Use Roblox's own sign-in page; the account is added automatically.</p></button>
      <button class="choice" data-add="cookie"><span class="ic">${icon('key')}</span><h4>Paste a session cookie</h4><p>For advanced users who already have a .ROBLOSECURITY value.</p></button>
    </div>
    <div class="note" style="margin-top:18px">${icon('shield')}<div><strong>Private by design.</strong> Sign-ins are encrypted with Windows' built-in protection and never leave this PC except to talk to Roblox. Backups never contain them.</div></div>
  </div>`;
}
