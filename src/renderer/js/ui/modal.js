import { esc } from '../format.js';
import { icon } from '../icons.js';

const stack = [];
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Opens a modal. `render(body)` fills it; returns { el, close, setBusy }.
 * onClose runs once, whatever closed it (button, Escape, backdrop).
 */
export function openModal({ title, subtitle = '', iconName = null, danger = false, wide = false, body = '', footer = '', onClose, dismissable = true }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        ${iconName ? `<div class="ic ${danger ? 'danger' : ''}">${icon(iconName)}</div>` : ''}
        <div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        ${dismissable ? `<button class="btn ghost sm icon-only x" data-modal-close aria-label="Close">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.getElementById('modal-root').appendChild(backdrop);
  const el = backdrop.querySelector('.modal');
  const previouslyFocused = document.activeElement;
  let closed = false;

  const close = (result) => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    backdrop.remove();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    if (onClose) onClose(result);
  };
  const entry = { close, dismissable, el };
  stack.push(entry);

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissable) close(); });
  el.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', () => close()));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  requestAnimationFrame(() => {
    const auto = el.querySelector('[autofocus]') || el.querySelector('.modal-body ' + FOCUSABLE) || el.querySelector(FOCUSABLE);
    if (auto) auto.focus();
  });

  const setBusy = (busy, selector = '.modal-foot .btn.primary, .modal-foot .btn.danger') => {
    el.querySelectorAll('.modal-foot button, .modal-body input, .modal-body textarea, .modal-body select').forEach((b) => { b.disabled = busy; });
    const btn = el.querySelector(selector);
    if (btn) {
      if (busy) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="spinner"></span>${esc(btn.textContent.trim())}`; }
      else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  };
  return { el, close, setBusy };
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top && top.dismissable) { top.close(); return true; }
  return !!top;
}

export function hasModal() {
  return stack.length > 0;
}

export function confirmDialog({ title, message = '', details = '', confirmLabel = 'Confirm', danger = false, iconName }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      iconName: iconName || (danger ? 'alert' : 'help'),
      danger,
      body: `${message ? `<p style="margin:0;color:var(--text-2)">${esc(message)}</p>` : ''}${details}`,
      footer: `<button class="btn ghost" data-modal-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok autofocus>${esc(confirmLabel)}</button>`,
      onClose: (r) => resolve(r === true),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', confirmLabel = 'Save', hint = '', maxLength = 100, suggestions = [] }) {
  return new Promise((resolve) => {
    const listId = `dl-${Math.random().toString(36).slice(2, 8)}`;
    const m = openModal({
      title,
      body: `<div class="field">${label ? `<label for="prompt-input">${esc(label)}</label>` : ''}
        <input id="prompt-input" class="input" maxlength="${maxLength}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${suggestions.length ? `list="${listId}"` : ''} autofocus>
        ${suggestions.length ? `<datalist id="${listId}">${suggestions.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>` : ''}
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`,
      footer: `<button class="btn ghost" data-modal-close>Cancel</button><button class="btn primary" data-ok>${esc(confirmLabel)}</button>`,
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
    });
    const input = m.el.querySelector('input');
    const submit = () => m.close(input.value.trim());
    m.el.querySelector('[data-ok]').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    requestAnimationFrame(() => input.select());
  });
}
