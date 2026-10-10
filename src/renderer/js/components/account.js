import { state } from '../store.js';
import { esc, displayName, presenceInfo, sessionInfo, avatarUrl, monogram, timeAgo } from '../format.js';
import { icon } from '../icons.js';

export function avatarHtml(a, size = '', { presence = true } = {}) {
  const p = presenceInfo(a);
  return `<div class="avatar ${size}">
    <img src="${esc(avatarUrl(a))}" data-fallback="${esc(monogram(displayName(a)))}" alt="" draggable="false" loading="lazy">
    ${presence ? `<span class="pdot ${p.cls} ${p.stale ? 'stale' : ''}" title="${esc(p.title)}"></span>` : ''}
  </div>`;
}

export function presenceHtml(a) {
  const p = presenceInfo(a);
  return `<span class="presence ${p.stale ? 'stale' : ''}" title="${esc(p.title)}">
    <span class="pdot ${p.cls} ${p.stale ? 'stale' : ''}"></span><span class="truncate">${esc(p.text)}</span>${p.stale ? `<span class="faint nowrap">· ${esc(p.asOf)}</span>` : ''}
  </span>`;
}

export function sessionBadge(a) {
  const s = sessionInfo(a);
  return `<span class="badge ${s.cls}" title="${esc(s.title)}">${icon(s.icon)}${esc(s.label)}</span>`;
}

export function statusBadges(a) {
  let out = sessionBadge(a);
  if (a.profile && a.profile.isBanned === true) out += `<span class="badge red" title="Roblox reports this account as banned">${icon('alert')}Banned</span>`;
  else if (a.profile && a.profile.notFound) out += `<span class="badge red" title="Roblox no longer has a user with this ID (deleted or terminated)">${icon('alert')}Not found</span>`;
  return out;
}

export function chipsHtml(a, max = 3) {
  const items = [];
  if (a.group) items.push(`<span class="chip group" title="Group: ${esc(a.group)}">${icon('folder', 'sm')}<span class="truncate">${esc(a.group)}</span></span>`);
  const tags = a.tags || [];
  for (const t of tags.slice(0, max)) items.push(`<span class="chip" title="Tag: ${esc(t)}"><span class="truncate">${esc(t)}</span></span>`);
  if (tags.length > max) items.push(`<span class="chip faint">+${tags.length - max}</span>`);
  return items.length ? `<div class="chips">${items.join('')}</div>` : '';
}

function launchButton(a, size = 'sm') {
  if (a.session.status === 'expired' || a.session.status === 'none') {
    return `<button class="btn ${size}" data-action="relogin" data-id="${esc(a.id)}" title="Sign in to this account again so it can be launched">
      ${icon('logIn', 'sm')}${a.session.status === 'none' ? 'Add sign-in' : 'Sign in again'}</button>`;
  }
  const launching = state.launchingIds.has(a.id);
  const disabled = false;
  return `<button class="btn primary ${size}" data-action="launch" data-id="${esc(a.id)}" ${disabled || launching ? 'disabled' : ''}
    title="${disabled ? 'Add a sign-in to launch this account' : 'Open Roblox signed in as this account'}">
    ${launching ? '<span class="spinner"></span>Launching' : `${icon('play', 'sm')}Launch`}</button>`;
}

export function cardHtml(a) {
  const selected = state.selection.has(a.id);
  const name = displayName(a);
  return `<article class="acc-card ${selected ? 'selected' : ''} ${state.launchingIds.has(a.id) ? 'launching' : ''}" data-id="${esc(a.id)}" data-action="open" tabindex="0" aria-label="${esc(name)}">
    <button class="check ${selected ? 'on' : ''}" data-action="select" data-id="${esc(a.id)}" aria-pressed="${selected}" aria-label="Select ${esc(name)}">${icon('check')}</button>
    <div class="corner">
      <button class="star-btn ${a.favorite ? 'on' : ''}" data-action="favorite" data-id="${esc(a.id)}" aria-pressed="${a.favorite}" title="${a.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button>
    </div>
    <div class="top">
      ${avatarHtml(a, 'lg')}
      <div class="names">
        <div class="name"><span class="truncate" title="${esc(name)}">${esc(name)}</span>${a.pinned ? `<span class="pin-mark" title="Pinned">${icon('pin', 'sm')}</span>` : ''}</div>
        <div class="user truncate">@${esc(a.username)}${a.nickname && a.displayName !== a.username ? ` · ${esc(a.displayName)}` : ''}</div>
      </div>
    </div>
    ${chipsHtml(a, 2)}
    <div class="meta">${presenceHtml(a)}<div class="row" style="gap:4px">${statusBadges(a)}</div></div>
    <div class="foot">
      ${launchButton(a)}
      <button class="btn sm icon-only" data-action="menu" data-id="${esc(a.id)}" aria-label="More actions" title="More actions">${icon('more')}</button>
    </div>
  </article>`;
}

export function rowHtml(a) {
  const selected = state.selection.has(a.id);
  const name = displayName(a);
  return `<tr class="${selected ? 'selected' : ''}" data-id="${esc(a.id)}" data-action="open" tabindex="0">
    <td class="col-check"><button class="check ${selected ? 'on' : ''}" data-action="select" data-id="${esc(a.id)}" aria-pressed="${selected}" aria-label="Select ${esc(name)}">${icon('check')}</button></td>
    <td><div class="who">${avatarHtml(a, 'md')}<div style="min-width:0">
      <div class="row" style="gap:6px"><strong class="truncate">${esc(name)}</strong>${a.pinned ? `<span class="pin-mark">${icon('pin', 'sm')}</span>` : ''}${a.favorite ? `<span class="pin-mark">${icon('star', 'sm fill')}</span>` : ''}</div>
      <div class="faint truncate">@${esc(a.username)}</div></div></div></td>
    <td>${presenceHtml(a)}</td>
    <td><div class="row" style="gap:4px">${statusBadges(a)}</div></td>
    <td class="hide-md">${chipsHtml(a, 2) || '<span class="faint">—</span>'}</td>
    <td class="hide-md nowrap muted" title="${a.lastLaunchedAt ? new Date(a.lastLaunchedAt).toLocaleString() : ''}">${a.lastLaunchedAt ? timeAgo(a.lastLaunchedAt) : '<span class="faint">Never</span>'}</td>
    <td class="col-actions"><div class="row" style="justify-content:flex-end;gap:4px">${launchButton(a, 'xs')}
      <button class="btn xs icon-only ghost" data-action="menu" data-id="${esc(a.id)}" aria-label="More actions">${icon('more')}</button></div></td>
  </tr>`;
}
