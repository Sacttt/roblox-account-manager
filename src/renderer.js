/* ---------------- State & Dom Helpers ---------------- */
let accounts = [];
let presets = [];
let settings = {};
let currentView = 'dashboard';
let searchQuery = '';
let sortMode = 'recent';
let pendingRemoveId = null;
let autoRefreshTimer = null;
let addTab = 'cookie';          // 'cookie' | 'web'
let cookieValidated = null;     // holds validated cookie info before saving
let cookieVisible = false;
let selectedAccountIds = new Set();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- Initialization ---------------- */
let eventsBound = false;

async function init() {
  // Bind clicks immediately so the UI never sits frozen waiting on IPC.
  try {
    bindEvents();
  } catch (e) {
    console.error('Failed to bind UI events', e);
  }

  closeModals();
  const ctxMenu = $('#context-menu');
  if (ctxMenu) ctxMenu.hidden = true;

  try {
    settings = await window.api.getSettings();
  } catch (e) {
    settings = {
      theme: 'dark',
      animations: true,
      avatarRefreshMinutes: 30,
      launchBehavior: 'profile',
      notifications: true
    };
  }

  applySettingsToUI();

  try {
    accounts = await window.api.listAccounts();
  } catch (e) {
    accounts = [];
  }

  try {
    presets = await window.api.listPresets();
  } catch (e) {
    presets = [];
  }

  try {
    renderPresets();
    render();
    setupAutoRefresh();
    initUpdates();
  } catch (e) {
    console.error('Failed to render app', e);
  }
}

function applySettingsToUI() {
  document.body.classList.toggle('no-anim', !settings.animations);
  const multiToggle = $('#multi-roblox-toggle');
  if (multiToggle) multiToggle.checked = settings.multiRoblox !== false;
  const launcherSelect = $('#launcher-select');
  if (launcherSelect) launcherSelect.value = settings.launcher || 'auto';
  const delaySelect = $('#launch-delay-select');
  if (delaySelect) delaySelect.value = String(settings.launchDelaySec || 6);
  refreshMultiStatus();

  const refreshSelect = $('#refresh-interval-select');
  if (refreshSelect) refreshSelect.value = String(settings.avatarRefreshMinutes ?? 30);
  const animToggle = $('#animations-toggle');
  if (animToggle) animToggle.checked = !!settings.animations;
  const notifToggle = $('#notifications-toggle');
  if (notifToggle) notifToggle.checked = !!settings.notifications;
}

function setupAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  const minutes = Number(settings.avatarRefreshMinutes);
  if (minutes > 0) {
    autoRefreshTimer = setInterval(async () => {
      try {
        const r = await window.api.refreshAllAccounts();
        if (r && r.accounts) {
          accounts = r.accounts;
          render();
        }
      } catch (e) {
        console.error('Auto-refresh error:', e);
      }
    }, minutes * 60 * 1000);
  }
}

/* ---------------- Presets Rendering ---------------- */
function renderPresets() {
  const row = $('#game-presets-row');
  if (!row) return;

  const gameInput = $('#game-target-input');
  const currentInput = (gameInput ? gameInput.value : '').trim();

  let html = '<span class="presets-label">QUICK PRESETS:</span>';
  presets.forEach(p => {
    const isActive = currentInput === p.target;
    html += `<button class="preset-chip ${isActive ? 'active' : ''}" data-target="${escapeHTML(p.target)}" title="Target: ${escapeHTML(p.target)}">🎮 ${escapeHTML(p.name)}</button>`;
  });

  row.innerHTML = html;

  row.querySelectorAll('.preset-chip').forEach(chip => {
    chip.onclick = () => {
      const target = chip.dataset.target;
      const input = $('#game-target-input');
      const clearBtn = $('#clear-target-btn');
      if (!input) return;
      if (input.value === target) {
        input.value = '';
        chip.classList.remove('active');
        if (clearBtn) clearBtn.style.display = 'none';
      } else {
        input.value = target;
        row.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (clearBtn) clearBtn.style.display = 'inline-block';
        toast(`Selected Game: ${chip.textContent.replace('🎮', '').trim()}`, 'info');
      }
    };
  });
}

/* ---------------- Rendering & Filtering ---------------- */
function getFiltered() {
  let list = [...accounts];
  if (currentView === 'favorites') {
    list = list.filter(a => a.favorite);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(a =>
      (a.username && a.username.toLowerCase().includes(q)) ||
      (a.displayName && a.displayName.toLowerCase().includes(q)) ||
      (a.nickname && a.nickname.toLowerCase().includes(q)) ||
      (a.notes && a.notes.toLowerCase().includes(q))
    );
  }

  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    switch (sortMode) {
      case 'username':
        return (a.username || '').localeCompare(b.username || '');
      case 'display':
        return (a.displayName || '').localeCompare(b.displayName || '');
      case 'favorite':
        return (b.favorite - a.favorite) || (b.lastLaunched || 0) - (a.lastLaunched || 0);
      case 'presence': {
        const presA = a.presence ? a.presence.presenceType : 0;
        const presB = b.presence ? b.presence.presenceType : 0;
        return (presB - presA) || (b.lastLaunched || 0) - (a.lastLaunched || 0);
      }
      case 'recent':
      default:
        return (b.lastLaunched || b.addedAt || 0) - (a.lastLaunched || a.addedAt || 0);
    }
  });

  return list;
}

function letterAvatar(name) {
  const letter = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" rx="14" fill="#1c2030"/><text x="28" y="36" font-size="22" fill="#f0b242" text-anchor="middle" font-family="Segoe UI,sans-serif" font-weight="700">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function staticAvatarSrc(a) {
  // Keep cards deterministic: a local monogram never spins, waits on a CDN,
  // or breaks when an image protocol is unavailable in a packaged build.
  return letterAvatar(a && (a.displayName || a.username));
}

function getPresenceInfo(account) {
  if (account.status === 'banned') {
    return { css: 'banned', text: 'Account Suspended', dotClass: 'banned' };
  }
  const pres = account.presence || {};
  const type = pres.presenceType ?? 0;
  if (type === 2) {
    const loc = pres.lastLocation ? ` · ${pres.lastLocation}` : '';
    return { css: 'ingame', text: `In Game${loc}`, dotClass: 'ingame' };
  }
  if (type === 3) {
    return { css: 'studio', text: 'In Roblox Studio', dotClass: 'studio' };
  }
  if (type === 1) {
    return { css: 'online', text: 'Online Website', dotClass: 'online' };
  }
  return { css: 'offline', text: 'Offline', dotClass: 'offline' };
}

function render() {
  const totalCount = accounts.length;
  const favCount = accounts.filter(a => a.favorite).length;
  const onlineCount = accounts.filter(a => a.presence && a.presence.presenceType > 0 && a.status !== 'banned').length;
  const offlineCount = Math.max(0, totalCount - onlineCount);

  const badgeTotal = $('#badge-total');
  const badgeFav = $('#badge-fav');
  const statOnline = $('#stat-online-count');
  const statOffline = $('#stat-offline-count');
  const statLastSync = $('#stat-lastsync');

  if (badgeTotal) badgeTotal.textContent = totalCount;
  if (badgeFav) badgeFav.textContent = favCount;
  if (statOnline) statOnline.textContent = onlineCount;
  if (statOffline) statOffline.textContent = offlineCount;

  const lastSync = accounts.reduce((max, a) => Math.max(max, a.updatedAt || 0), 0);
  if (statLastSync) statLastSync.textContent = lastSync ? `Synced ${timeAgo(lastSync)}` : 'Not synced yet';

  const titleMap = {
    dashboard: ['Dashboard', 'Select accounts to launch individually or join games together.'],
    accounts: ['All Accounts', 'Complete roster of saved accounts with live presence and instant launch.'],
    favorites: ['Starred Favorites', 'Priority accounts pinned and bookmarked for rapid access.'],
    settings: ['Settings', 'Preferences, launch configurations, and local backup storage.']
  };

  const viewTitleWrap = $('#view-title-wrap');
  const gameLauncherPanel = $('#game-launcher-panel');
  const accountGrid = $('#account-grid');
  const emptyState = $('#empty-state');
  const floatingBatchBar = $('#floating-batch-bar');
  const settingsPanel = $('#settings-panel');

  if (currentView === 'settings') {
    if (viewTitleWrap) viewTitleWrap.hidden = true;
    if (gameLauncherPanel) gameLauncherPanel.hidden = true;
    if (accountGrid) accountGrid.hidden = true;
    if (emptyState) emptyState.hidden = true;
    if (floatingBatchBar) floatingBatchBar.hidden = true;
    if (settingsPanel) settingsPanel.hidden = false;
    return;
  }

  if (settingsPanel) settingsPanel.hidden = true;
  if (viewTitleWrap) viewTitleWrap.hidden = false;
  if (gameLauncherPanel) gameLauncherPanel.hidden = false;

  const viewTitle = $('#view-title');
  const viewSubtitle = $('#view-subtitle');
  const activeCountText = $('#active-count-text');

  if (viewTitle) viewTitle.textContent = titleMap[currentView][0];
  if (viewSubtitle) viewSubtitle.textContent = titleMap[currentView][1];

  const list = getFiltered();
  if (activeCountText) activeCountText.textContent = `${list.length} ${list.length === 1 ? 'account' : 'accounts'}`;

  if (accounts.length === 0) {
    if (accountGrid) accountGrid.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (floatingBatchBar) floatingBatchBar.hidden = true;
    const emptyTitle = $('#empty-title');
    const emptyDesc = $('#empty-desc');
    const emptyAddBtn = $('#empty-add-btn');
    if (emptyTitle) emptyTitle.textContent = 'No accounts added yet';
    if (emptyDesc) emptyDesc.textContent = 'Add your first Roblox account to start organizing your multi-account launcher.';
    if (emptyAddBtn) emptyAddBtn.style.display = '';
    return;
  }

  if (list.length === 0) {
    if (accountGrid) accountGrid.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (floatingBatchBar) floatingBatchBar.hidden = true;
    const emptyTitle = $('#empty-title');
    const emptyDesc = $('#empty-desc');
    const emptyAddBtn = $('#empty-add-btn');
    if (emptyTitle) emptyTitle.textContent = 'No matching accounts';
    if (emptyDesc) emptyDesc.textContent = 'Try adjusting your search query or switching navigation views.';
    if (emptyAddBtn) emptyAddBtn.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.hidden = true;
  if (accountGrid) {
    accountGrid.hidden = false;
    accountGrid.innerHTML = list.map((a, i) => cardHTML(a, i)).join('');

    // Attach card event listeners
    accountGrid.querySelectorAll('.card').forEach(el => {
      const id = el.dataset.id;

      // Checkbox selection
      const checkbox = el.querySelector('.card-select-checkbox');
      if (checkbox) {
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleAccountSelection(id);
        });
      }

      // Card click -> Open Details
      el.addEventListener('click', (e) => {
        if (!e.target.closest('button') && !e.target.closest('.card-select-checkbox')) {
          openDetail(id);
        }
      });

      // Right-click context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, id);
      });

      // Favorite button
      const favBtn = el.querySelector('.fav-star');
      if (favBtn) {
        favBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFavorite(id);
        });
      }

      // Launch button
      const launchBtn = el.querySelector('.launch-btn');
      if (launchBtn) {
        launchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          launchAccount(id);
        });
      }
    });
  }

  updateBatchBar();
}

function cardHTML(a, i) {
  const name = a.nickname || a.displayName || a.username;
  const pres = getPresenceInfo(a);
  const lastActiveText = a.lastLaunched ? `Launched ${timeAgo(a.lastLaunched)}` : 'Never launched';
  const hasCookie = !!a.roblosecurity;
  const isSelected = selectedAccountIds.has(a.id);

  return `
  <div class="card ${isSelected ? 'selected' : ''}" data-id="${a.id}" style="animation-delay:${Math.min(i * 20, 200)}ms">
    <div class="card-icon-btns">
      <button type="button" class="card-select-checkbox" aria-label="${isSelected ? 'Deselect account' : 'Select for multi-launch'}" title="${isSelected ? 'Deselect account' : 'Select for multi-launch'}">${isSelected ? '✓' : ''}</button>
      <button type="button" class="fav-star ${a.favorite ? 'active' : ''}" aria-label="${a.favorite ? 'Remove favorite' : 'Add favorite'}" title="${a.favorite ? 'Remove favorite' : 'Add favorite'}">${a.favorite ? '★' : '☆'}</button>
    </div>
    <div class="card-top">
      <div class="avatar-wrap">
        <img class="avatar" src="${staticAvatarSrc(a)}" alt="" draggable="false" />
        ${a.pinned ? '<div class="pin-badge" title="Pinned to top">📌</div>' : ''}
      </div>
      <div class="card-names">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <div class="card-nick" title="${escapeHTML(name)}">${escapeHTML(name)}</div>
          ${hasCookie ? '<span class="card-cookie-badge">⚡ Auto-Login</span>' : ''}
        </div>
        <div class="card-username">@${escapeHTML(a.username)}</div>
      </div>
    </div>
    <div class="card-meta">
      <span class="presence-dot ${pres.dotClass}"></span>
      <span class="meta-text">${escapeHTML(pres.text)} · ${lastActiveText}</span>
    </div>
    <div class="card-actions">
      <button class="btn primary small launch-btn btn-glow" title="${hasCookie ? 'Instant auto-login launch' : 'Launch account'}">
        <span>${hasCookie ? '⚡ Launch' : 'Launch'}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
    </div>
  </div>`;
}

/* ---------------- Multi-Select Management ---------------- */
function toggleAccountSelection(id) {
  if (selectedAccountIds.has(id)) {
    selectedAccountIds.delete(id);
  } else {
    selectedAccountIds.add(id);
  }
  updateCardSelectionUI(id);
  updateBatchBar();
}

function updateCardSelectionUI(id) {
  const card = $(`#account-grid .card[data-id="${id}"]`);
  if (!card) return;
  const isSel = selectedAccountIds.has(id);
  card.classList.toggle('selected', isSel);
  const cb = card.querySelector('.card-select-checkbox');
  if (cb) cb.innerHTML = isSel ? '&#10003;' : '';
}

function updateBatchBar() {
  const bar = $('#floating-batch-bar');
  if (!bar) return;
  const count = selectedAccountIds.size;
  if (count > 0 && currentView !== 'settings') {
    bar.hidden = false;
    const batchCountBadge = $('#batch-count-badge');
    const batchCountText = $('#batch-count-text');
    const batchLaunchCount = $('#batch-launch-count');
    const toggleSelectAllBtn = $('#toggle-select-all-btn');
    if (batchCountBadge) batchCountBadge.textContent = count;
    if (batchCountText) batchCountText.textContent = count === 1 ? 'account selected' : 'accounts selected';
    if (batchLaunchCount) batchLaunchCount.textContent = count;
    if (toggleSelectAllBtn) toggleSelectAllBtn.textContent = 'Deselect All';
  } else {
    bar.hidden = true;
    const toggleSelectAllBtn = $('#toggle-select-all-btn');
    if (toggleSelectAllBtn) toggleSelectAllBtn.textContent = 'Select All';
  }
}

function selectAllFiltered() {
  const filtered = getFiltered();
  if (selectedAccountIds.size === filtered.length && filtered.length > 0) {
    selectedAccountIds.clear();
  } else {
    filtered.forEach(a => selectedAccountIds.add(a.id));
  }
  render();
}

function clearSelection() {
  selectedAccountIds.clear();
  render();
}

/* ---------------- Detail & Edit Modal ---------------- */
function openDetail(id) {
  const a = accounts.find(x => x.id === id);
  if (!a) return;
  const pres = getPresenceInfo(a);

  const modal = $('#detail-modal');
  if (!modal) return;

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Account Overview</h2>
      <button class="modal-close-btn" id="d-close-x">&times;</button>
    </div>
    <div class="detail-head">
      <div class="detail-avatar-box">
        <img class="detail-avatar" src="${staticAvatarSrc(a)}" alt="" />
        <div class="detail-presence-badge">
          <span class="presence-dot ${pres.dotClass}"></span>
          <span>${escapeHTML(pres.text.split('·')[0])}</span>
        </div>
      </div>
      <div class="detail-names">
        <div class="detail-name">${escapeHTML(a.nickname || a.displayName || a.username)}</div>
        <div class="detail-username">@${escapeHTML(a.username)} · ${escapeHTML(a.displayName)}</div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-item">
        <div class="label">Roblox User ID</div>
        <div class="value">${a.userId}</div>
      </div>
      <div class="detail-item">
        <div class="label">Account Status</div>
        <div class="value">${a.status === 'banned' ? 'Suspended' : 'Active'}</div>
      </div>
      <div class="detail-item">
        <div class="label">Auto-Login Cookie</div>
        <div class="value" style="color:${a.roblosecurity ? '#27c75e' : '#f59e0b'}; font-weight:700;">
          ${a.roblosecurity ? '⚡ Authenticated' : 'Not Configured'}
        </div>
      </div>
      <div class="detail-item">
        <div class="label">Last Launched</div>
        <div class="value">${a.lastLaunched ? timeAgo(a.lastLaunched) : 'Never'}</div>
      </div>
    </div>

    <div class="detail-edit-box">
      <label class="field">
        <span>Nickname <em>(local label)</em></span>
        <input id="d-edit-nick" type="text" value="${escapeHTML(a.nickname || '')}" placeholder="e.g. Main, Trader, Alt..." />
      </label>
      <label class="field" style="margin-top: 10px;">
        <span>Private Notes</span>
        <textarea id="d-edit-notes" rows="2" placeholder="Account notes, goals, inventory reminders...">${escapeHTML(a.notes || '')}</textarea>
      </label>
      <label class="field" style="margin-top: 10px;">
        <span>Update .ROBLOSECURITY Cookie <em>(for instant 1-click auto-login)</em></span>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <input id="d-edit-cookie" type="password" placeholder="${a.roblosecurity ? 'Cookie saved (paste new to replace)' : 'Paste .ROBLOSECURITY here...'}" autocomplete="off" spellcheck="false" style="flex:1;" />
          <button class="btn ghost small" id="d-save-cookie-btn">Update Cookie</button>
          ${a.roblosecurity ? '<button class="btn ghost danger small" id="d-remove-cookie-btn">Clear</button>' : ''}
        </div>
      </label>
      <button class="btn ghost small" id="d-save-notes" style="margin-top: 12px; width: 100%;">
        Save Nickname &amp; Notes
      </button>
    </div>

    <div class="detail-actions">
      <button class="btn primary btn-glow" id="d-launch">
        <span>${a.roblosecurity ? '⚡ Instant Launch' : 'Launch'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <button class="btn ghost" id="d-web-profile" title="Open official Roblox web profile">
        Roblox Profile &#8599;
      </button>
      <button class="btn ghost" id="d-refresh">
        Sync Profile
      </button>
      <button class="btn ghost danger" id="d-remove">
        Remove
      </button>
    </div>
  `;

  const detailOverlay = $('#detail-modal-overlay');
  if (detailOverlay) detailOverlay.hidden = false;

  const dCloseX = $('#d-close-x');
  const dLaunch = $('#d-launch');
  const dWebProfile = $('#d-web-profile');
  const dRefresh = $('#d-refresh');
  const dRemove = $('#d-remove');
  const dSaveNotes = $('#d-save-notes');
  const dSaveCookieBtn = $('#d-save-cookie-btn');
  const dRemoveCookieBtn = $('#d-remove-cookie-btn');

  if (dCloseX) dCloseX.onclick = closeModals;
  if (dLaunch) dLaunch.onclick = () => launchAccount(id);
  if (dWebProfile) dWebProfile.onclick = () => window.api.openProfile(a.userId);
  if (dRefresh) dRefresh.onclick = () => refreshAccount(id, true);
  if (dRemove) dRemove.onclick = () => { closeModals(); confirmRemove(id); };

  if (dSaveNotes) {
    dSaveNotes.onclick = async () => {
      const nick = ($('#d-edit-nick') || {}).value || '';
      const notes = ($('#d-edit-notes') || {}).value || '';
      const updated = await window.api.updateAccount(id, { nickname: nick.trim(), notes: notes.trim() });
      Object.assign(a, updated);
      render();
      toast('Saved nickname & notes', 'success');
    };
  }

  if (dSaveCookieBtn) {
    dSaveCookieBtn.onclick = async () => {
      const cookieEl = $('#d-edit-cookie');
      const cookieVal = (cookieEl ? cookieEl.value : '').trim();
      if (!cookieVal) {
        toast('Please enter a cookie value first.', 'error');
        return;
      }
      try {
        await window.api.setCookie(id, cookieVal);
        a.roblosecurity = cookieVal;
        render();
        openDetail(id);
        toast('⚡ Cookie updated and verified for auto-login!', 'success');
      } catch (err) {
        toast('Invalid cookie or cookie does not match this user.', 'error');
      }
    };
  }

  if (dRemoveCookieBtn) {
    dRemoveCookieBtn.onclick = async () => {
      await window.api.setCookie(id, '');
      a.roblosecurity = null;
      render();
      openDetail(id);
      toast('Auto-login cookie removed.', 'info');
    };
  }
}

/* ---------------- Actions ---------------- */
async function toggleFavorite(id) {
  const a = accounts.find(x => x.id === id);
  if (!a) return;
  const updated = await window.api.updateAccount(id, { favorite: !a.favorite });
  Object.assign(a, updated);
  render();
}

/* ---------------- Multi Roblox helpers ---------------- */
async function refreshMultiStatus() {
  const el = $('#multi-roblox-status');
  if (!el || !window.api.multiStatus) return;
  try {
    const s = await window.api.multiStatus();
    if (!s.supported) {
      el.textContent = 'Multi Roblox only works on Windows.';
    } else if (!s.enabled) {
      el.textContent = `Off · ${s.runningClients} Roblox window(s) open`;
    } else if (s.active) {
      const lock = s.cookieLock && s.cookieLock.startsWith('ok') ? ' · error 773 fix on' : '';
      el.textContent = `● Ready · ${s.runningClients} Roblox window(s) open${lock}`;
    } else {
      el.textContent = s.runningClients > 0
        ? '○ Waiting · close Roblox, then launch (or use the button below)'
        : '○ Starts on your next launch';
    }
  } catch (_) {
    el.textContent = '';
  }
}

// Multi Roblox has to grab Roblox's lock before the first window opens. If
// Roblox is already open, offer to close it and try again.
async function withRobloxClosed(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!String(e && e.message).includes('ROBLOX_ALREADY_RUNNING')) throw e;
    const ok = window.confirm('Roblox is already open. To run several accounts at once, Roblox has to be closed first so Multi Roblox can start.\n\nClose all Roblox windows now and continue?');
    if (!ok) throw new Error('CANCELED');
    await window.api.closeAllRoblox();
    return await fn();
  }
}

async function launchAccount(id) {
  const a = accounts.find(x => x.id === id);
  if (!a) return;
  if (!a.roblosecurity) {
    toast(`${a.displayName || a.username} has no login saved. Open the account and paste its cookie, or re-add it with Sign In.`, 'error');
    return;
  }
  const targetUrl = requireGameTarget();
  if (!targetUrl) return;
  try {
    toast(`Signing in ${a.displayName || a.username}…`, 'info');
    const res = await withRobloxClosed(() => window.api.launchAccount(id, targetUrl));
    a.lastLaunched = res.launchedAt;
    render();
    toast(`Opening Roblox as ${a.displayName || a.username}…`, 'success');
  } catch (e) {
    if (String(e && e.message).includes('CANCELED')) return;
    toast(friendlyError(e), 'error');
  } finally {
    refreshMultiStatus();
  }
}

async function launchSelectedAccounts() {
  const ids = Array.from(selectedAccountIds);
  if (ids.length === 0) return;

  const missing = ids.map(id => accounts.find(a => a.id === id)).filter(a => a && !a.roblosecurity);
  if (missing.length) {
    toast(`No login saved for: ${missing.map(a => a.displayName || a.username).join(', ')}. Add their cookie first.`, 'error');
    return;
  }

  const targetUrl = requireGameTarget();
  if (!targetUrl) return;
  const delay = settings.launchDelaySec || 6;
  toast(`Launching ${ids.length} accounts, one every ~${delay}s after each window opens…`, 'info');

  try {
    const res = await withRobloxClosed(() => window.api.launchMany(ids, targetUrl));
    const successCount = res.launched.filter(r => r.ok).length;

    res.launched.forEach(r => {
      const a = accounts.find(acc => acc.id === r.id);
      if (a && r.ok) a.lastLaunched = r.launchedAt;
    });

    clearSelection();
    render();
    toast(`Opened Roblox for ${successCount} of ${ids.length} accounts.`, successCount === ids.length ? 'success' : 'error');
  } catch (e) {
    if (String(e && e.message).includes('CANCELED')) return;
    toast(friendlyError(e), 'error');
  } finally {
    refreshMultiStatus();
  }
}

function requireGameTarget() {
  const gameInput = $('#game-target-input');
  const targetUrl = (gameInput ? gameInput.value : '').trim();
  if (targetUrl) return targetUrl;

  toast('Add a Place ID, game URL, or private server link first. Launch then opens the real Roblox app.', 'error');
  const panel = $('#game-launcher-panel');
  if (panel) {
    panel.classList.add('needs-target');
    setTimeout(() => panel.classList.remove('needs-target'), 2200);
  }
  if (gameInput) {
    gameInput.focus();
    gameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return null;
}

async function refreshAccount(id, fromDetail) {
  try {
    const updated = await window.api.refreshAccount(id);
    const idx = accounts.findIndex(x => x.id === id);
    if (idx !== -1) accounts[idx] = updated;
    render();
    if (fromDetail) openDetail(id);
    toast(`Refreshed ${updated.username}`, 'success');
  } catch (e) {
    toast(friendlyError(e), 'error');
  }
}

async function refreshAll() {
  const btn = $('#refresh-all-btn');
  if (!btn) return;
  btn.disabled = true;
  const icon = btn.querySelector('.spin-icon');
  if (icon) icon.style.transform = 'rotate(360deg)';

  try {
    const res = await window.api.refreshAllAccounts();
    if (res && res.accounts) {
      accounts = res.accounts;
      render();
      const failed = res.results ? res.results.filter(r => !r.ok).length : 0;
      toast(failed ? `Synced with ${failed} error(s)` : 'All accounts & avatars synced', failed ? 'error' : 'success');
    }
  } catch (e) {
    toast('Sync encountered an error. Check network.', 'error');
  } finally {
    btn.disabled = false;
    if (icon) icon.style.transform = '';
  }
}

function confirmRemove(id) {
  pendingRemoveId = id;
  const a = accounts.find(x => x.id === id);
  if (!a) return;
  const confirmTitle = $('#confirm-title');
  const confirmBody = $('#confirm-body');
  const confirmOverlay = $('#confirm-modal-overlay');
  if (confirmTitle) confirmTitle.textContent = 'Remove Account?';
  if (confirmBody) confirmBody.textContent = `Are you sure you want to remove @${a.username} from this manager? Your local notes will be cleared, but your Roblox account itself will not be affected.`;
  if (confirmOverlay) confirmOverlay.hidden = false;
}

/* ---------------- Add Account Segmented Tab Switching ---------------- */
function switchAddTab(tab) {
  addTab = tab;
  cookieValidated = null;

  $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  const tabCookie = $('#add-tab-cookie');
  const tabWeb = $('#add-tab-web');
  const modalActions = $('#add-modal-actions');
  const cookieValidateBtn = $('#cookie-validate-btn');

  if (tabCookie) tabCookie.hidden = (tab !== 'cookie');
  if (tabWeb) tabWeb.hidden = (tab !== 'web');
  if (modalActions) modalActions.style.display = (tab === 'web') ? 'none' : 'flex';
  if (cookieValidateBtn) cookieValidateBtn.hidden = (tab !== 'cookie');

  if (tab === 'cookie') {
    const cookiePreview = $('#cookie-preview');
    const cookieExtraFields = $('#cookie-extra-fields');
    const cookieError = $('#cookie-error');
    const addConfirmBtn = $('#add-confirm-btn');
    if (cookiePreview) cookiePreview.hidden = true;
    if (cookieExtraFields) cookieExtraFields.hidden = true;
    if (cookieError) cookieError.textContent = '';
    if (addConfirmBtn) {
      addConfirmBtn.textContent = 'Add Account';
      addConfirmBtn.disabled = true;
    }
  }
}

/* ---------------- Cookie Validate Flow ---------------- */
async function validateAndPreviewCookie() {
  const cookieInput = $('#add-cookie-input');
  const cookie = (cookieInput ? cookieInput.value : '').trim();
  const errEl = $('#cookie-error');
  if (errEl) errEl.textContent = '';
  cookieValidated = null;

  const cookiePreview = $('#cookie-preview');
  const cookieExtraFields = $('#cookie-extra-fields');
  const addConfirmBtn = $('#add-confirm-btn');
  if (cookiePreview) cookiePreview.hidden = true;
  if (cookieExtraFields) cookieExtraFields.hidden = true;
  if (addConfirmBtn) addConfirmBtn.disabled = true;

  if (!cookie) {
    if (errEl) errEl.textContent = 'Please paste your .ROBLOSECURITY cookie.';
    return;
  }

  const btn = $('#cookie-validate-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying...';
  }

  try {
    const result = await window.api.validateCookie(cookie);
    cookieValidated = result;

    const previewDisplay = $('#preview-display');
    const previewUsername = $('#preview-username');
    const previewUid = $('#preview-uid');
    if (previewDisplay) previewDisplay.textContent = result.displayName || result.username;
    if (previewUsername) previewUsername.textContent = `@${result.username}`;
    if (previewUid) previewUid.textContent = `User ID: ${result.userId}`;

    const avatarImg = $('#preview-avatar');
    if (avatarImg) {
      avatarImg.src = letterAvatar(result.displayName || result.username);
    }

    if (cookiePreview) cookiePreview.hidden = false;
    if (cookieExtraFields) cookieExtraFields.hidden = false;
    if (addConfirmBtn) {
      addConfirmBtn.disabled = false;
      addConfirmBtn.textContent = 'Add Account';
    }
    toast(`✓ Verified as ${result.displayName || result.username}`, 'success');
  } catch (e) {
    const msg = (e && e.message) || '';
    if (errEl) {
      if (msg.includes('INVALID_COOKIE')) {
        errEl.textContent = 'Cookie is invalid or has expired. Please copy a fresh one.';
      } else if (msg.includes('DUPLICATE')) {
        errEl.textContent = 'This account is already in your manager.';
      } else if (msg.includes('RATE_LIMITED')) {
        errEl.textContent = 'Roblox API rate limit reached. Please wait a few seconds.';
      } else {
        errEl.textContent = 'Could not verify cookie. Check your network.';
      }
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify Cookie';
    }
  }
}

/* ---------------- Add Account Submissions ---------------- */
async function submitAddAccount() {
  return submitAddWithCookie();
}

async function submitAddWithCookie() {
  if (!cookieValidated) {
    const cookieError = $('#cookie-error');
    if (cookieError) cookieError.textContent = 'Please verify your cookie first.';
    return;
  }

  const cookieInput = $('#add-cookie-input');
  const nicknameInput = $('#add-cookie-nickname');
  const notesInput = $('#add-cookie-notes');

  const cookie = (cookieInput ? cookieInput.value : '').trim();
  const nickname = (nicknameInput ? nicknameInput.value : '').trim();
  const notes = (notesInput ? notesInput.value : '').trim();

  const btn = $('#add-confirm-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adding Account...';
  }

  try {
    const acc = await window.api.addWithCookie({ cookie, nickname, notes });
    accounts.push(acc);
    closeModals();
    clearAddForm();
    currentView = 'dashboard';
    setActiveNav('dashboard');
    render();
    toast(`⚡ ${acc.displayName || acc.username} added with auto-login!`, 'success');
  } catch (e) {
    const msg = (e && e.message) || '';
    const cookieError = $('#cookie-error');
    if (cookieError) {
      if (msg.includes('DUPLICATE')) {
        cookieError.textContent = 'This account is already in your manager.';
      } else if (msg.includes('INVALID_COOKIE')) {
        cookieError.textContent = 'Cookie expired — please copy a fresh one.';
      } else {
        cookieError.textContent = 'Failed to add account. Try again.';
      }
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Add Account';
    }
  }
}

async function handleWebLogin() {
  toast('Opening official Roblox sign-in window...', 'info');
  try {
    const res = await window.api.startWebLogin();
    if (res && res.success && res.account) {
      if (res.isNew) {
        accounts.push(res.account);
        toast(`⚡ Connected @${res.account.username}!`, 'success');
      } else {
        const idx = accounts.findIndex(a => a.id === res.account.id);
        if (idx !== -1) accounts[idx] = res.account;
        toast(`⚡ Refreshed login for @${res.account.username}!`, 'success');
      }
      closeModals();
      clearAddForm();
      render();
    }
  } catch (err) {
    toast('Web sign-in was canceled or encountered an issue.', 'error');
  }
}

function clearAddForm() {
  const cookieInput = $('#add-cookie-input');
  if (cookieInput) {
    cookieInput.value = '';
    cookieInput.classList.remove('cookie-visible');
    cookieInput.classList.add('cookie-masked');
  }
  const visIcon = $('#vis-icon');
  const visText = $('#vis-text');
  if (visIcon) visIcon.textContent = '👁️';
  if (visText) visText.textContent = 'Show Cookie';
  cookieVisible = false;

  const nicknameInput = $('#add-cookie-nickname');
  const notesInput = $('#add-cookie-notes');
  const cookieError = $('#cookie-error');
  const cookiePreview = $('#cookie-preview');
  const cookieExtraFields = $('#cookie-extra-fields');

  if (nicknameInput) nicknameInput.value = '';
  if (notesInput) notesInput.value = '';
  if (cookieError) cookieError.textContent = '';
  if (cookiePreview) cookiePreview.hidden = true;
  if (cookieExtraFields) cookieExtraFields.hidden = true;
  cookieValidated = null;

  switchAddTab('cookie');
}

function friendlyError(e) {
  const msg = (e && e.message) || '';
  if (msg.includes('GAME_REQUIRED')) return 'Enter a Place ID or game link in the bar above before launching.';
  if (msg.includes('ROBLOX_ALREADY_RUNNING')) return 'Close Roblox first so Multi Roblox can start (Settings → Close all Roblox windows).';
  if (msg.includes('MULTI_ROBLOX_OFF')) return 'Turn on Multi Roblox in Settings to launch several accounts together.';
  if (msg.includes('MULTI_ROBLOX')) return 'Multi Roblox could not start. Try running the app again, or restart your PC if Roblox is stuck in the background.';
  if (msg.includes('LAUNCHER_NOT_FOUND')) return 'The selected launcher is not installed. Pick another one in Settings.';
  if (msg.includes('NO_COOKIE')) return 'This account needs a cookie before it can launch the Roblox app.';
  if (msg.includes('COOKIE_INVALID')) return 'This cookie was rejected by Roblox. Paste a fresh one.';
  if (msg.includes('AUTH_TICKET_FAILED')) return 'Could not get a Roblox launch ticket. Try again in a few seconds.';
  if (msg.includes('DUPLICATE')) return 'This account has already been added.';
  if (msg.includes('RATE_LIMITED')) return 'Roblox API rate limit reached. Please wait a few seconds.';
  if (msg.includes('NETWORK_ERROR') || msg.includes('TIMEOUT')) return 'Network timeout reaching Roblox servers. Check connection.';
  return 'Error processing request. Please try again.';
}

/* ---------------- Context Menu ---------------- */
function openContextMenu(x, y, id) {
  const a = accounts.find(acc => acc.id === id);
  if (!a) return;
  const menu = $('#context-menu');
  if (!menu) return;

  menu.innerHTML = `
    <button data-a="launch">&#9654; Launch Account</button>
    <button data-a="profile">&#8599; Open Roblox Profile</button>
    <button data-a="detail">&#9881; View &amp; Edit Details</button>
    <button data-a="pin">${a.pinned ? '&#128204; Unpin from Top' : '&#128204; Pin to Top'}</button>
    <button data-a="fav">${a.favorite ? '&#9734; Remove Favorite' : '&#9733; Add Favorite'}</button>
    <button data-a="refresh">&#8635; Refresh Profile</button>
    <hr />
    <button data-a="remove" class="danger">&#128465; Remove Account</button>
  `;

  const menuWidth = 190;
  const menuHeight = 250;
  const posX = (x + menuWidth > window.innerWidth) ? (window.innerWidth - menuWidth - 12) : x;
  const posY = (y + menuHeight > window.innerHeight) ? (window.innerHeight - menuHeight - 12) : y;

  menu.style.left = posX + 'px';
  menu.style.top = posY + 'px';
  menu.hidden = false;

  menu.querySelectorAll('button').forEach(b => {
    b.onclick = async () => {
      menu.hidden = true;
      const act = b.dataset.a;
      if (act === 'launch') launchAccount(id);
      if (act === 'profile') window.api.openProfile(a.userId);
      if (act === 'detail') openDetail(id);
      if (act === 'pin') {
        const u = await window.api.updateAccount(id, { pinned: !a.pinned });
        Object.assign(a, u);
        render();
      }
      if (act === 'fav') toggleFavorite(id);
      if (act === 'refresh') refreshAccount(id);
      if (act === 'remove') confirmRemove(id);
    };
  });
}

/* ---------------- Toast Notifications ---------------- */
function toast(message, type = 'info') {
  const stack = $('#toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;

  const icon = type === 'success' ? '&#10003;' : type === 'error' ? '&#9888;' : '&#9432;';
  el.innerHTML = `<span>${icon}</span> <span>${escapeHTML(message)}</span>`;

  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* ---------------- Modals & Navigation ---------------- */
function closeModals() {
  $$('.modal-overlay').forEach(o => o.hidden = true);
}

function setActiveNav(view) {
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
}

/* ---------------- Helpers ---------------- */
function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------------- Event Bindings ---------------- */
function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  // Window controls
  const winMin = $('#win-min');
  const winMax = $('#win-max');
  const winClose = $('#win-close');
  if (winMin) winMin.addEventListener('click', () => window.api.minimizeWindow());
  if (winMax) winMax.addEventListener('click', () => window.api.maximizeWindow());
  if (winClose) winClose.addEventListener('click', () => window.api.closeWindow());

  // Navigation
  $$('.nav-item').forEach(n => n.addEventListener('click', () => {
    currentView = n.dataset.view;
    setActiveNav(currentView);
    render();
  }));

  // Search & Filter
  const searchInput = $('#search-input');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      searchQuery = e.target.value;
      render();
    }, 160));
  }

  const sortSelect = $('#sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      sortMode = e.target.value;
      render();
    });
  }

  // Game Launcher Input Handlers
  const gameInput = $('#game-target-input');
  const clearTargetBtn = $('#clear-target-btn');
  if (gameInput) {
    gameInput.addEventListener('input', () => {
      const val = gameInput.value.trim();
      if (clearTargetBtn) clearTargetBtn.style.display = val ? 'inline-block' : 'none';
      $$('.preset-chip').forEach(c => c.classList.toggle('active', c.dataset.target === val));
    });
  }
  if (clearTargetBtn) {
    clearTargetBtn.addEventListener('click', () => {
      if (gameInput) gameInput.value = '';
      clearTargetBtn.style.display = 'none';
      $$('.preset-chip').forEach(c => c.classList.remove('active'));
    });
  }

  // Save Preset Handler
  const savePresetBtn = $('#save-preset-btn');
  if (savePresetBtn) {
    savePresetBtn.addEventListener('click', async () => {
      const target = (gameInput ? gameInput.value : '').trim();
      if (!target) {
        toast('Please enter a Place ID or Game Link first to save as preset.', 'error');
        return;
      }
      const name = prompt('Enter a name for this Game Preset:', 'Custom Game');
      if (!name || !name.trim()) return;

      const newPreset = {
        id: `p_${Date.now()}`,
        name: name.trim(),
        target: target
      };
      presets.push(newPreset);
      await window.api.savePresets(presets);
      renderPresets();
      toast(`Saved preset "${name.trim()}"!`, 'success');
    });
  }

  // Multi-Selection Controls
  const toggleSelectAllBtn = $('#toggle-select-all-btn');
  const batchClearBtn = $('#batch-clear-btn');
  const batchLaunchBtn = $('#batch-launch-btn');
  const batchFavBtn = $('#batch-fav-btn');
  const batchSyncBtn = $('#batch-sync-btn');

  if (toggleSelectAllBtn) toggleSelectAllBtn.addEventListener('click', selectAllFiltered);
  if (batchClearBtn) batchClearBtn.addEventListener('click', clearSelection);
  if (batchLaunchBtn) batchLaunchBtn.addEventListener('click', launchSelectedAccounts);

  if (batchFavBtn) {
    batchFavBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedAccountIds);
      for (const id of ids) {
        const a = accounts.find(acc => acc.id === id);
        if (a && !a.favorite) {
          await window.api.updateAccount(id, { favorite: true });
          a.favorite = true;
        }
      }
      render();
      toast(`Starred ${ids.length} accounts!`, 'success');
    });
  }

  if (batchSyncBtn) {
    batchSyncBtn.addEventListener('click', async () => {
      const ids = Array.from(selectedAccountIds);
      toast(`Syncing ${ids.length} selected accounts...`, 'info');
      for (const id of ids) {
        try {
          const u = await window.api.refreshAccount(id);
          const idx = accounts.findIndex(a => a.id === id);
          if (idx !== -1) accounts[idx] = u;
        } catch (_) {}
      }
      render();
      toast(`Synced ${ids.length} accounts!`, 'success');
    });
  }

  // Modal Triggers
  const openAddModal = () => {
    clearAddForm();
    const addModalOverlay = $('#add-modal-overlay');
    if (addModalOverlay) addModalOverlay.hidden = false;
  };

  const addAccountBtn = $('#add-account-btn');
  const emptyAddBtn = $('#empty-add-btn');
  const addCloseX = $('#add-close-x');
  const addCancelBtn = $('#add-cancel-btn');
  const addConfirmBtn = $('#add-confirm-btn');

  if (addAccountBtn) addAccountBtn.addEventListener('click', openAddModal);
  if (emptyAddBtn) emptyAddBtn.addEventListener('click', openAddModal);
  if (addCloseX) addCloseX.addEventListener('click', () => { closeModals(); clearAddForm(); });
  if (addCancelBtn) addCancelBtn.addEventListener('click', () => { closeModals(); clearAddForm(); });
  if (addConfirmBtn) addConfirmBtn.addEventListener('click', submitAddAccount);

  // Cookie Visibility Toggle
  const toggleCookieVisBtn = $('#toggle-cookie-vis-btn');
  if (toggleCookieVisBtn) {
    toggleCookieVisBtn.addEventListener('click', () => {
      cookieVisible = !cookieVisible;
      const input = $('#add-cookie-input');
      const icon = $('#vis-icon');
      const text = $('#vis-text');
      if (input) {
        if (cookieVisible) {
          input.classList.remove('cookie-masked');
          input.classList.add('cookie-visible');
        } else {
          input.classList.remove('cookie-visible');
          input.classList.add('cookie-masked');
        }
      }
      if (icon) icon.textContent = cookieVisible ? '🔒' : '👁️';
      if (text) text.textContent = cookieVisible ? 'Hide Cookie' : 'Show Cookie';
    });
  }

  // Segmented Tabs
  $$('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchAddTab(btn.dataset.tab);
    });
  });

  // Web Login Button
  const startWebLoginBtn = $('#start-web-login-btn');
  if (startWebLoginBtn) startWebLoginBtn.addEventListener('click', handleWebLogin);

  // Cookie Validation Triggers
  const cookieValidateBtn = $('#cookie-validate-btn');
  if (cookieValidateBtn) {
    cookieValidateBtn.addEventListener('click', validateAndPreviewCookie);
  }

  const cookieInput = $('#add-cookie-input');
  if (cookieInput) {
    cookieInput.addEventListener('paste', () => {
      setTimeout(validateAndPreviewCookie, 50);
    });
    cookieInput.addEventListener('input', debounce(() => {
      if (cookieInput.value.trim().length > 20 && !cookieValidated) {
        validateAndPreviewCookie();
      }
    }, 350));
  }

  // Refresh All
  const refreshAllBtn = $('#refresh-all-btn');
  if (refreshAllBtn) refreshAllBtn.addEventListener('click', refreshAll);

  // Remove confirmation
  const confirmCancelBtn = $('#confirm-cancel-btn');
  const confirmOkBtn = $('#confirm-ok-btn');

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => {
      closeModals();
      pendingRemoveId = null;
    });
  }

  if (confirmOkBtn) {
    confirmOkBtn.addEventListener('click', async () => {
      if (!pendingRemoveId) return;
      await window.api.removeAccount(pendingRemoveId);
      accounts = accounts.filter(a => a.id !== pendingRemoveId);
      selectedAccountIds.delete(pendingRemoveId);
      pendingRemoveId = null;
      closeModals();
      render();
      toast('Account removed', 'success');
    });
  }

  // Global Key & Click handlers
  $$('.modal-overlay').forEach(o => o.addEventListener('click', (e) => {
    if (e.target === o) closeModals();
  }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModals();
      const ctxMenu = $('#context-menu');
      if (ctxMenu) ctxMenu.hidden = true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  document.addEventListener('click', (e) => {
    const ctxMenu = $('#context-menu');
    if (ctxMenu && !e.target.closest('#context-menu')) ctxMenu.hidden = true;
  });

  // Settings Handlers
  const multiToggle = $('#multi-roblox-toggle');
  if (multiToggle) {
    multiToggle.addEventListener('change', async (e) => {
      settings.multiRoblox = e.target.checked;
      try {
        if (settings.multiRoblox) {
          await withRobloxClosed(() => window.api.enableMulti());
          toast('Multi Roblox is on. You can now launch several accounts.', 'success');
        } else {
          await window.api.disableMulti();
          toast('Multi Roblox is off. Only one Roblox window can run.', 'info');
        }
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
      refreshMultiStatus();
    });
  }

  const launcherSelect = $('#launcher-select');
  if (launcherSelect) {
    launcherSelect.addEventListener('change', (e) => {
      settings.launcher = e.target.value;
      window.api.updateSettings({ launcher: settings.launcher });
      refreshMultiStatus();
      toast('Launcher saved', 'success');
    });
  }

  const delaySelect = $('#launch-delay-select');
  if (delaySelect) {
    delaySelect.addEventListener('change', (e) => {
      settings.launchDelaySec = Number(e.target.value);
      window.api.updateSettings({ launchDelaySec: settings.launchDelaySec });
      toast('Launch delay saved', 'success');
    });
  }

  const closeAllBtn = $('#close-all-roblox-btn');
  if (closeAllBtn) {
    closeAllBtn.addEventListener('click', async () => {
      const res = await window.api.closeAllRoblox();
      toast(res.closed ? `Closed ${res.closed} Roblox window${res.closed === 1 ? '' : 's'}.` : 'No Roblox windows were open.', 'info');
      refreshMultiStatus();
    });
  }

  if (window.api.onLaunchProgress) {
    window.api.onLaunchProgress((p) => {
      const a = accounts.find(x => x.id === p.id);
      const name = a ? (a.displayName || a.username) : 'Account';
      if (p.ok) toast(`${p.done}/${p.total} · ${name} launched`, 'success');
      else toast(`${p.done}/${p.total} · ${name}: ${friendlyError({ message: p.error })}`, 'error');
    });
  }

  const refreshIntervalSelect = $('#refresh-interval-select');
  if (refreshIntervalSelect) {
    refreshIntervalSelect.addEventListener('change', (e) => {
      settings.avatarRefreshMinutes = Number(e.target.value);
      window.api.updateSettings({ avatarRefreshMinutes: settings.avatarRefreshMinutes });
      setupAutoRefresh();
      toast('Auto-sync interval updated', 'success');
    });
  }

  const animationsToggle = $('#animations-toggle');
  if (animationsToggle) {
    animationsToggle.addEventListener('change', (e) => {
      settings.animations = e.target.checked;
      document.body.classList.toggle('no-anim', !settings.animations);
      window.api.updateSettings({ animations: settings.animations });
    });
  }

  const notificationsToggle = $('#notifications-toggle');
  if (notificationsToggle) {
    notificationsToggle.addEventListener('change', (e) => {
      settings.notifications = e.target.checked;
      window.api.updateSettings({ notifications: settings.notifications });
    });
  }

  const openDataBtn = $('#open-data-btn');
  if (openDataBtn) openDataBtn.addEventListener('click', () => window.api.openDataFolder());

  const clearCacheBtn = $('#clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      await window.api.clearCache();
      toast('Avatar cache cleared', 'success');
    });
  }

  // Backup Export & Import Handlers
  const exportDataBtn = $('#export-data-btn');
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', async () => {
      try {
        const jsonStr = await window.api.exportAccounts();
        await navigator.clipboard.writeText(jsonStr);
        toast('Backup JSON copied to clipboard!', 'success');
      } catch (e) {
        toast('Failed to export backup.', 'error');
      }
    });
  }

  const importDataBtn = $('#import-data-btn');
  if (importDataBtn) {
    importDataBtn.addEventListener('click', () => {
      const importJsonInput = $('#import-json-input');
      if (importJsonInput) importJsonInput.value = '';
      const importModalOverlay = $('#import-modal-overlay');
      if (importModalOverlay) importModalOverlay.hidden = false;
    });
  }

  const importCloseX = $('#import-close-x');
  const importCancelBtn = $('#import-cancel-btn');
  const importConfirmBtn = $('#import-confirm-btn');

  if (importCloseX) importCloseX.addEventListener('click', closeModals);
  if (importCancelBtn) importCancelBtn.addEventListener('click', closeModals);

  if (importConfirmBtn) {
    importConfirmBtn.addEventListener('click', async () => {
      const importJsonInput = $('#import-json-input');
      const raw = (importJsonInput ? importJsonInput.value : '').trim();
      if (!raw) {
        toast('Please paste your accounts JSON.', 'error');
        return;
      }
      try {
        const res = await window.api.importAccounts(raw);
        accounts = await window.api.listAccounts();
        closeModals();
        render();
        toast(`Imported ${res.addedCount} new account(s)!`, 'success');
      } catch (e) {
        toast('Invalid backup format. Ensure valid JSON.', 'error');
      }
    });
  }
}

/* ---------------- Auto-Update UI ---------------- */
let updateInfo = { version: null, critical: false, downloaded: false };

async function initUpdates() {
  if (!window.api || !window.api.updateState) return;

  // Show the running version in the About card.
  try {
    const v = await window.api.getVersion();
    const badge = $('#about-version');
    if (badge) badge.textContent = v;
  } catch (_) {}

  // React to updater events from the main process.
  if (window.api.onUpdateStatus) window.api.onUpdateStatus(renderUpdateStatus);

  // "Check for updates" button in Settings.
  const checkBtn = $('#check-updates-btn');
  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      setUpdateSettingsStatus('Checking for updates…');
      checkBtn.disabled = true;
      try {
        const r = await window.api.checkForUpdates();
        if (!r.ok && r.reason === 'DEV_BUILD') setUpdateSettingsStatus('Updates only run in the installed app.');
        else if (!r.ok) setUpdateSettingsStatus('Could not check right now. Try again later.');
        else if (!r.updateAvailable) setUpdateSettingsStatus("You're up to date.");
        // If an update IS available, the 'available' event opens the modal.
      } finally {
        checkBtn.disabled = false;
      }
    });
  }

  // Modal buttons.
  const laterBtn = $('#update-later-btn');
  if (laterBtn) laterBtn.addEventListener('click', () => { $('#update-modal-overlay').hidden = true; });

  const notesBtn = $('#update-notes-btn');
  if (notesBtn) notesBtn.addEventListener('click', () => {
    const notes = $('#update-notes');
    if (notes) notes.hidden = !notes.hidden;
  });

  const primaryBtn = $('#update-primary-btn');
  if (primaryBtn) primaryBtn.addEventListener('click', onUpdatePrimary);

  // If an update was already downloaded before this window opened, reflect it.
  try {
    const st = await window.api.updateState();
    if (st && st.downloaded && st.pending) {
      updateInfo.version = st.pending.version;
      updateInfo.critical = st.pending.critical;
      updateInfo.downloaded = true;
    }
  } catch (_) {}
}

function setUpdateSettingsStatus(text, type) {
  const el = $('#update-settings-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = type === 'error' ? '#f87171' : '';
}

function openUpdateModal() {
  const overlay = $('#update-modal-overlay');
  if (overlay) overlay.hidden = false;
}

function renderReleaseNotes(notes) {
  const wrap = $('#update-notes');
  const body = $('#update-notes-body');
  if (!wrap || !body) return;
  let html = '';
  if (Array.isArray(notes)) {
    html = notes.map(n => (n && n.note) ? `<p>${escapeHTML(n.version || '')}</p>${sanitizeNotes(n.note)}` : '').join('');
  } else if (typeof notes === 'string' && notes.trim()) {
    html = sanitizeNotes(notes);
  }
  if (html) {
    body.innerHTML = html;
    wrap.hidden = false;      // show notes by default when we have them
  } else {
    body.innerHTML = '<p>No release notes were provided for this version.</p>';
    wrap.hidden = true;
  }
}

// GitHub release notes arrive as HTML. Allow only basic formatting tags and
// strip scripts, styles, and event handlers before inserting.
function sanitizeNotes(html) {
  let s = String(html);
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '');
  return s;
}

function renderUpdateStatus(data) {
  if (!data) return;
  const statusLine = $('#update-status-line');
  const progressWrap = $('#update-progress-wrap');
  const primaryBtn = $('#update-primary-btn');
  const laterBtn = $('#update-later-btn');

  switch (data.status) {
    case 'checking':
      setUpdateSettingsStatus('Checking for updates…');
      break;

    case 'not-available':
      setUpdateSettingsStatus("You're up to date.");
      break;

    case 'available': {
      updateInfo = { version: data.version, critical: !!data.critical, downloaded: false };
      $('#update-title').textContent = data.critical
        ? 'A required update is available'
        : 'A new version is available';
      $('#update-current-ver').textContent = data.currentVersion || '—';
      $('#update-new-ver').textContent = data.version || '—';
      $('#update-date').textContent = formatReleaseDate(data.releaseDate);
      $('#update-critical-badge').hidden = !data.critical;
      if (laterBtn) laterBtn.hidden = !!data.critical; // required updates can't be postponed
      if (progressWrap) progressWrap.hidden = true;
      if (statusLine) statusLine.hidden = true;
      if (primaryBtn) { primaryBtn.disabled = false; primaryBtn.textContent = 'Update Now'; }
      renderReleaseNotes(data.releaseNotes);
      setUpdateSettingsStatus(`Version ${data.version} is available.`);
      openUpdateModal();
      break;
    }

    case 'downloading': {
      if (progressWrap) progressWrap.hidden = false;
      const bar = $('#update-progress-bar');
      const text = $('#update-progress-text');
      if (bar) bar.style.width = `${data.percent || 0}%`;
      if (text) {
        const mb = (n) => (n ? (n / 1048576).toFixed(1) : '0.0');
        const speed = data.bytesPerSecond ? ` · ${mb(data.bytesPerSecond)} MB/s` : '';
        text.textContent = `Downloading ${data.percent || 0}% (${mb(data.transferred)} / ${mb(data.total)} MB)${speed}`;
      }
      if (primaryBtn) { primaryBtn.disabled = true; primaryBtn.textContent = 'Downloading…'; }
      if (laterBtn) laterBtn.hidden = updateInfo.critical;
      break;
    }

    case 'downloaded': {
      updateInfo.version = data.version;
      updateInfo.downloaded = true;
      if (progressWrap) $('#update-progress-bar').style.width = '100%';
      if ($('#update-progress-text')) $('#update-progress-text').textContent = 'Download complete — ready to install.';
      if (primaryBtn) { primaryBtn.disabled = false; primaryBtn.textContent = 'Restart & Install'; }
      setUpdateSettingsStatus(`Version ${data.version} is ready to install.`);
      openUpdateModal();
      break;
    }

    case 'error': {
      if (statusLine) {
        statusLine.hidden = false;
        statusLine.className = 'update-status-line error';
        statusLine.textContent = `Update failed: ${data.message || 'unknown error'}. Your current version is unaffected.`;
      }
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = updateInfo.downloaded ? 'Restart & Install' : 'Retry';
      }
      setUpdateSettingsStatus('Update check failed. You can keep using the app.', 'error');
      break;
    }
  }
}

async function onUpdatePrimary() {
  const primaryBtn = $('#update-primary-btn');
  const statusLine = $('#update-status-line');
  if (statusLine) statusLine.hidden = true;

  // Already downloaded -> install and restart.
  if (updateInfo.downloaded) {
    if (primaryBtn) { primaryBtn.disabled = true; primaryBtn.textContent = 'Restarting…'; }
    const r = await window.api.installUpdate();
    if (!r.ok && statusLine) {
      statusLine.hidden = false;
      statusLine.className = 'update-status-line error';
      statusLine.textContent = 'Could not start the installer. Please download the latest version manually.';
      if (primaryBtn) { primaryBtn.disabled = false; primaryBtn.textContent = 'Restart & Install'; }
    }
    return;
  }

  // Otherwise start (or retry) the download.
  if (primaryBtn) { primaryBtn.disabled = true; primaryBtn.textContent = 'Starting…'; }
  const r = await window.api.downloadUpdate();
  if (!r.ok && statusLine) {
    statusLine.hidden = false;
    statusLine.className = 'update-status-line error';
    statusLine.textContent = 'Download could not start. Check your connection and try again.';
    if (primaryBtn) { primaryBtn.disabled = false; primaryBtn.textContent = 'Retry'; }
  }
}

function formatReleaseDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (_) { return '—'; }
}

// Start application logic
init();
