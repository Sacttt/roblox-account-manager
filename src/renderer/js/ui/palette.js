import { state, accountList } from '../store.js';
import { esc, displayName } from '../format.js';
import { icon } from '../icons.js';
import { scoreAccount, sortAccounts } from '../logic.js';
import { avatarHtml, presenceHtml } from '../components/account.js';

let current = null;

/**
 * commands: [{ id, label, icon, hint, run, keywords }]
 * onAccount(account, { shift }) runs when an account result is chosen.
 */
export function openPalette({ commands, onAccount }) {
  if (current) { current.input.focus(); return; }
  const backdrop = document.createElement('div');
  backdrop.className = 'palette-backdrop';
  backdrop.innerHTML = `<div class="palette" role="dialog" aria-label="Command palette">
    <div class="input-wrap">${icon('search')}<input class="input" placeholder="Search accounts or type a command…" aria-label="Search" autocomplete="off" spellcheck="false"></div>
    <div class="palette-results" role="listbox"></div>
    <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> launch / run</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> details</span><span><kbd>Esc</kbd> close</span></div>
  </div>`;
  document.getElementById('menu-root').appendChild(backdrop);
  const input = backdrop.querySelector('input');
  const results = backdrop.querySelector('.palette-results');
  let items = [];
  let active = 0;

  function compute() {
    const q = input.value.trim();
    const accs = (q ? accountList().map((a) => ({ a, s: scoreAccount(a, q) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.a)
      : sortAccounts(accountList(), 'recent')).slice(0, q ? 8 : 5);
    const ql = q.toLowerCase();
    const cmds = commands.filter((c) => !q || `${c.label} ${c.keywords || ''}`.toLowerCase().includes(ql)).slice(0, q ? 8 : 6);
    items = [...accs.map((a) => ({ kind: 'account', a })), ...cmds.map((c) => ({ kind: 'command', c }))];
    active = Math.min(active, Math.max(0, items.length - 1));
    const target = state.target.text.trim();
    let html = '';
    if (accs.length) {
      html += `<div class="palette-group">${q ? 'Accounts' : 'Recent accounts'}</div>`;
      html += accs.map((a, i) => `<div class="palette-item ${i === active ? 'active' : ''}" data-i="${i}" role="option">
        ${avatarHtml(a, 'sm')}<div class="grow"><div class="truncate"><strong>${esc(displayName(a))}</strong> <span class="faint">@${esc(a.username)}</span></div></div>
        ${presenceHtml(a)}<span class="hint">${target && a.session.status !== 'none' ? 'Enter to launch' : 'Enter to open'}</span></div>`).join('');
    }
    if (cmds.length) {
      html += '<div class="palette-group">Commands</div>';
      html += cmds.map((c, j) => {
        const i = accs.length + j;
        return `<div class="palette-item ${i === active ? 'active' : ''}" data-i="${i}" role="option">${icon(c.icon || 'chevronRight')}<div class="grow">${esc(c.label)}</div>${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}</div>`;
      }).join('');
    }
    if (!items.length) html = '<div class="empty" style="padding:28px"><p>No matches.</p></div>';
    results.innerHTML = html;
    const el = results.querySelector('.palette-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function choose(i, shift = false) {
    const it = items[i];
    if (!it) return;
    close();
    if (it.kind === 'account') onAccount(it.a, { shift });
    else it.c.run();
  }

  function close() {
    if (!current) return;
    backdrop.remove();
    current = null;
  }

  input.addEventListener('input', () => { active = 0; compute(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); compute(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); compute(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active, e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  results.addEventListener('mousemove', (e) => {
    const it = e.target.closest('[data-i]');
    if (it && Number(it.dataset.i) !== active) {
      active = Number(it.dataset.i);
      results.querySelectorAll('.palette-item').forEach((n) => n.classList.toggle('active', Number(n.dataset.i) === active));
    }
  });
  results.addEventListener('click', (e) => {
    const it = e.target.closest('[data-i]');
    if (it) choose(Number(it.dataset.i), e.shiftKey);
  });
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

  current = { input, close };
  compute();
  input.focus();
}

export function closePalette() {
  if (!current) return false;
  current.close();
  return true;
}
