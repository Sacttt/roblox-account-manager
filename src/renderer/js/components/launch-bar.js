import { call } from '../api.js';
import { state, notify } from '../store.js';
import { esc, errorMessage } from '../format.js';
import { icon } from '../icons.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { promptDialog } from '../ui/modal.js';
import { navigate } from '../actions.js';

export function launchBarHtml() {
  return `<div class="launch-bar">
    <span class="label">${icon('gamepad')}Game</span>
    <div class="target">
      <input class="input" data-target-input spellcheck="false" autocomplete="off" maxlength="500"
        placeholder="Place ID, game link or private server link…" value="${esc(state.target.text)}" aria-label="Game to launch">
      <span class="parsed" data-target-parsed></span>
    </div>
    <button class="btn sm" data-target-pick title="Saved and recent games">${icon('layers', 'sm')}Saved games${icon('chevronDown', 'sm')}</button>
    <button class="btn sm ghost icon-only" data-target-save title="Save this game" aria-label="Save this game">${icon('plus')}</button>
  </div>`;
}

let parseTimer = null;
let parseSeq = 0;

export async function setTarget(text, { persist = true } = {}) {
  state.target.text = text;
  const seq = ++parseSeq;
  if (!text.trim()) {
    state.target.parsed = null;
  } else {
    try {
      const parsed = await call('launch:parse-target', text);
      if (seq !== parseSeq) return;
      state.target.parsed = parsed;
    } catch (_) {
      state.target.parsed = null;
    }
  }
  updateParsedLabels();
  if (persist) {
    clearTimeout(setTarget.saveTimer);
    setTarget.saveTimer = setTimeout(() => call('settings:update', { lastGameTarget: text.trim().slice(0, 500) }).catch(() => {}), 600);
  }
  notify('target');
}

export function updateParsedLabels() {
  const p = state.target.parsed;
  document.querySelectorAll('[data-target-parsed]').forEach((el) => {
    if (!state.target.text.trim()) { el.innerHTML = ''; return; }
    if (!p) { el.innerHTML = ''; return; }
    el.innerHTML = p.error
      ? `<span style="color:var(--orange)">${esc(p.error === 'SHARE_LINK_UNSUPPORTED' ? 'Share links not supported' : 'Not a game link')}</span>`
      : `<span class="faint">${esc(p.label)}</span>`;
    el.title = p.error ? errorMessage({ code: p.error }) : '';
  });
  document.querySelectorAll('[data-target-input]').forEach((input) => {
    if (document.activeElement !== input && input.value !== state.target.text) input.value = state.target.text;
  });
}

export function bindLaunchBar(root) {
  const input = root.querySelector('[data-target-input]');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(parseTimer);
    state.target.text = input.value;
    parseTimer = setTimeout(() => setTarget(input.value), 250);
  });
  root.querySelector('[data-target-pick]').addEventListener('click', (e) => pickTarget(e.currentTarget));
  root.querySelector('[data-target-save]').addEventListener('click', () => saveCurrentAsPreset());
  updateParsedLabels();
}

export function pickTarget(anchor) {
  const items = [];
  if (state.presets.length) {
    items.push({ heading: 'Saved games' });
    for (const p of state.presets.slice(0, 15)) items.push({ label: p.name, icon: 'gamepad', run: () => setTarget(p.target) });
  }
  const recent = (state.settings.recentTargets || []).filter((t) => !state.presets.some((p) => p.target === t)).slice(0, 5);
  if (recent.length) {
    items.push({ heading: 'Recent' });
    for (const t of recent) items.push({ label: t, icon: 'clock', run: () => setTarget(t) });
  }
  if (items.length) items.push({ separator: true });
  items.push({ label: 'Manage saved games…', icon: 'sliders', run: () => navigate('games') });
  openMenu(anchor, items);
}

export async function saveCurrentAsPreset(target = state.target.text) {
  const t = String(target || '').trim();
  if (!t) { toast({ type: 'warning', message: 'Enter a game first, then save it.' }); return; }
  const parsed = await call('launch:parse-target', t).catch(() => null);
  if (!parsed || parsed.error) { toast({ type: 'warning', message: errorMessage({ code: parsed ? parsed.error : 'GAME_TARGET_INVALID' }) }); return; }
  const name = await promptDialog({ title: 'Save game', label: 'Name', placeholder: 'e.g. Blox Fruits', maxLength: 40, hint: parsed.label, confirmLabel: 'Save' });
  if (!name) return;
  try {
    await call('presets:upsert', { name, target: t });
    toast({ type: 'success', message: `Saved “${name}”.` });
  } catch (e) {
    toast({ type: 'error', message: errorMessage(e) });
  }
}
