import { call } from './api.js';
import { state, notify } from './store.js';
import { esc, date } from './format.js';
import { icon } from './icons.js';
import { openModal } from './ui/modal.js';
import { toast } from './ui/toast.js';

let modal = null;
let lastStatus = null;

function statusText() {
  const u = state.updates || {};
  if (u.portable) return 'Portable version — download new versions from the project website or GitHub releases.';
  if (!u.canCheck) return u.supported === false ? 'Updates are unavailable in this build.' : 'Automatic updates run in the installed app.';
  if (lastStatus === 'checking' || u.checking) return 'Checking for updates…';
  if (u.downloaded && u.pending) return `Version ${u.pending.version} is ready to install.`;
  if (u.downloading) return `Downloading update… ${u.percent || 0}%`;
  if (u.pending) return `Version ${u.pending.version} is available.`;
  if (lastStatus === 'error') return 'The last update check failed. You can keep using the app.';
  return "You're on the latest version.";
}

export function renderUpdateCard() {
  const u = state.updates || {};
  const action = u.downloaded ? `<button class="btn sm primary" data-upd="install">${icon('refresh', 'sm')}Restart &amp; update</button>`
    : u.pending ? `<button class="btn sm primary" data-upd="open">${icon('download', 'sm')}View update</button>`
      : u.portable ? `<button class="btn sm" data-upd="releases">${icon('external', 'sm')}Releases</button>`
        : `<button class="btn sm" data-upd="check" ${u.canCheck ? '' : 'disabled'}>${icon('refresh', 'sm')}Check for updates</button>`;
  return `<section class="card"><div class="setting"><div class="txt"><strong>Updates</strong><span data-upd-status>${esc(statusText())}</span></div><div class="ctl">${action}</div></div></section>`;
}

export function bindUpdateCard(root) {
  root.querySelectorAll('[data-upd]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.upd === 'check') {
      b.disabled = true;
      const r = await call('updates:check').catch(() => ({ ok: false }));
      b.disabled = false;
      if (!r.ok) toast({ type: r.reason === 'DEV_BUILD' ? 'info' : 'error', message: r.reason === 'DEV_BUILD' ? 'Updates only run in the installed app.' : 'Could not check for updates right now.' });
      else if (!r.updateAvailable) toast({ type: 'success', message: "You're on the latest version." });
    } else if (b.dataset.upd === 'open') {
      openUpdateModal();
    } else if (b.dataset.upd === 'releases') {
      call('app:open-external', 'https://github.com/Sacttt/roblox-account-manager/releases/latest').catch(() => {});
    } else if (b.dataset.upd === 'install') {
      call('updates:install').catch(() => {});
    }
  }));
}

function sanitizeNotes(html) {
  // Release notes come from GitHub as HTML. Rebuild them from text so nothing
  // executable can get in, keeping simple line structure.
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const lines = [];
  doc.body.querySelectorAll('h1,h2,h3,h4,p,li').forEach((n) => {
    const text = n.textContent.trim();
    if (!text) return;
    if (/^H\d$/.test(n.tagName)) lines.push(`<p><strong>${esc(text)}</strong></p>`);
    else if (n.tagName === 'LI') lines.push(`<p>• ${esc(text)}</p>`);
    else lines.push(`<p>${esc(text)}</p>`);
  });
  if (!lines.length && doc.body.textContent.trim()) lines.push(`<p>${esc(doc.body.textContent.trim())}</p>`);
  return lines.join('');
}

export function openUpdateModal() {
  const p = state.updates && state.updates.pending;
  if (!p || modal) return;
  const notes = Array.isArray(p.releaseNotes) ? p.releaseNotes.map((n) => sanitizeNotes(n.note)).join('') : sanitizeNotes(p.releaseNotes);
  modal = openModal({
    title: p.critical ? 'A required update is available' : `Version ${p.version} is available`,
    subtitle: `You have ${p.currentVersion || state.version}${p.releaseDate ? ` · released ${date(p.releaseDate)}` : ''}`,
    iconName: 'download',
    dismissable: !p.critical,
    body: `${notes ? `<div class="card card-body" style="max-height:240px;overflow:auto;color:var(--text-2)">${notes}</div>` : '<p class="muted" style="margin:0">No release notes were provided.</p>'}
      <div data-progress hidden><div class="progress"><div style="width:0%"></div></div><div class="faint" style="font-size:12px;margin-top:6px" data-progress-text></div></div>
      <div class="note">${icon('shieldCheck')}<div>Updates are downloaded from this project's GitHub releases and verified before installing. Your accounts and settings are kept.</div></div>`,
    footer: `${p.critical ? '' : '<button class="btn ghost" data-modal-close>Later</button>'}<button class="btn primary" data-go>${state.updates.downloaded ? 'Restart &amp; update' : 'Download update'}</button>`,
    onClose: () => { modal = null; },
  });
  modal.el.querySelector('[data-go]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (state.updates.downloaded) { btn.disabled = true; call('updates:install').catch(() => {}); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Downloading';
    const r = await call('updates:download').catch(() => ({ ok: false }));
    if (!r.ok) { btn.disabled = false; btn.textContent = 'Retry'; toast({ type: 'error', message: 'The download failed. Check your connection and try again.' }); }
  });
}

export function handleUpdateStatus(data) {
  lastStatus = data.status;
  const u = (state.updates = { ...(state.updates || {}) });
  switch (data.status) {
    case 'checking': u.checking = true; break;
    case 'not-available': u.checking = false; break;
    case 'available':
      u.checking = false;
      u.pending = { version: data.version, releaseDate: data.releaseDate, releaseNotes: data.releaseNotes, currentVersion: data.currentVersion, critical: data.critical };
      openUpdateModal();
      break;
    case 'downloading':
      u.downloading = true;
      u.percent = data.percent;
      if (modal) {
        modal.el.querySelector('[data-progress]').hidden = false;
        modal.el.querySelector('.progress > div').style.width = `${data.percent || 0}%`;
        const mb = (n) => (n ? (n / 1048576).toFixed(1) : '0.0');
        modal.el.querySelector('[data-progress-text]').textContent = `${data.percent || 0}% · ${mb(data.transferred)} of ${mb(data.total)} MB`;
      }
      break;
    case 'downloaded':
      u.downloading = false;
      u.downloaded = true;
      if (modal) {
        const btn = modal.el.querySelector('[data-go]');
        btn.disabled = false;
        btn.textContent = 'Restart & update';
        modal.el.querySelector('[data-progress-text]').textContent = 'Download complete.';
      } else {
        toast({ type: 'success', title: 'Update ready', message: `Version ${data.version} will install when you restart.`, action: { label: 'Restart', run: () => call('updates:install').catch(() => {}) }, duration: 10000 });
      }
      break;
    case 'error':
      u.checking = false;
      u.downloading = false;
      if (modal) {
        const btn = modal.el.querySelector('[data-go]');
        btn.disabled = false;
        btn.textContent = u.downloaded ? 'Restart & update' : 'Retry';
      }
      break;
    default: break;
  }
  notify('updates');
}
