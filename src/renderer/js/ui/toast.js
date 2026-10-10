import { esc } from '../format.js';
import { icon } from '../icons.js';

const ICONS = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };
const recent = new Map();

function root() {
  return document.getElementById('toasts');
}

/**
 * toast('Saved', 'success') or toast({ title, message, type, action: { label, run } })
 * Identical messages within 2s are collapsed.
 */
export function toast(input, type = 'info') {
  const opts = typeof input === 'string' ? { message: input, type } : { type, ...input };
  const key = `${opts.type}|${opts.title || ''}|${opts.message || ''}`;
  if (recent.has(key) && Date.now() - recent.get(key) < 2000) return null;
  recent.set(key, Date.now());

  const el = document.createElement('div');
  el.className = `toast ${opts.type}`;
  el.setAttribute('role', opts.type === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="ic">${icon(ICONS[opts.type] || 'info')}</span>
    <div class="msg">${opts.title ? `<strong>${esc(opts.title)}</strong>` : ''}<span>${esc(opts.message || '')}</span></div>
    <div class="act">
      ${opts.action ? `<button class="btn xs" data-act>${esc(opts.action.label)}</button>` : ''}
      <button class="btn xs ghost icon-only" data-close aria-label="Dismiss">${icon('x', 'sm')}</button>
    </div>`;
  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 170);
  };
  el.querySelector('[data-close]').onclick = close;
  if (opts.action) el.querySelector('[data-act]').onclick = () => { close(); opts.action.run(); };
  const host = root();
  host.appendChild(el);
  while (host.querySelectorAll('.toast').length > 5) host.querySelector('.toast').remove();
  const ms = opts.duration ?? (opts.type === 'error' ? 7000 : 3800);
  let timer = setTimeout(close, ms);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2000); });
  return { close };
}
