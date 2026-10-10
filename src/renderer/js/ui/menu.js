import { esc } from '../format.js';
import { icon } from '../icons.js';

let current = null;

/**
 * Shows a context menu. items: [{ label, icon, run, danger, disabled, kbd }
 * | { separator: true } | { heading: 'Text' }]. Anchor is an element or {x, y}.
 */
export function openMenu(anchor, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => {
    if (it.separator) return '<div class="sep" role="separator"></div>';
    if (it.heading) return `<div class="label">${esc(it.heading)}</div>`;
    return `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>
      ${it.icon ? icon(it.icon) : ''}<span class="truncate">${esc(it.label)}</span>${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : ''}</button>`;
  }).join('');
  document.getElementById('menu-root').appendChild(menu);

  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = anchor instanceof Element ? rect.right - mw : rect.left;
  let y = rect.bottom + 4;
  if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
  if (x < 8) x = 8;
  if (y + mh > innerHeight - 8) y = Math.max(8, (anchor instanceof Element ? rect.top - mh - 4 : innerHeight - mh - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const buttons = [...menu.querySelectorAll('button:not([disabled])')];
  let focus = -1;
  const setFocus = (i) => {
    buttons.forEach((b) => b.classList.remove('focus'));
    focus = (i + buttons.length) % buttons.length;
    if (buttons[focus]) { buttons[focus].classList.add('focus'); buttons[focus].focus(); }
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenu();
    if (it && it.run) it.run();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(focus + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(focus - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  });
  const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  window.addEventListener('blur', closeMenu, { once: true });
  current = { menu, onDown };
  if (!(anchor instanceof Element) || anchor.matches(':focus-visible')) setFocus(0);
}

export function closeMenu() {
  if (!current) return false;
  document.removeEventListener('mousedown', current.onDown, true);
  current.menu.remove();
  current = null;
  return true;
}
