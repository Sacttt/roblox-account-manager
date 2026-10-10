import { call } from '../api.js';
import { state } from '../store.js';
import { esc, timeAgo, errorMessage } from '../format.js';
import { icon } from '../icons.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { launchBarHtml, bindLaunchBar, setTarget, saveCurrentAsPreset } from '../components/launch-bar.js';
import { navigate } from '../actions.js';

export function mount(root) {
  root.innerHTML = `<div class="view-inner">
    <div class="page-head">
      <div><h1>Games</h1><p>Save the games and private servers you play so any account can jump in quickly.</p></div>
      <div class="actions"><button class="btn primary" data-new>${icon('plus', 'sm')}Add game</button></div>
    </div>
    ${launchBarHtml()}
    <section class="card"><div class="card-head"><h3>Saved games</h3><span class="faint" data-count></span></div><div data-presets style="margin-top:8px"></div></section>
    <div class="section-title">Recently launched games</div>
    <section class="card" data-recent-wrap><div data-recent></div></section>
    <div class="note" style="margin-top:14px">${icon('info')}<div>Supported: Place IDs (<code>920587237</code>), game links (<code>roblox.com/games/…</code>), private server links that contain <code>privateServerLinkCode=</code>, and specific servers (<code>?gameInstanceId=…</code>). Roblox "share" links must be opened in a browser first.</div></div>
  </div>`;
  const inner = root.querySelector('.view-inner');
  bindLaunchBar(inner);
  inner.querySelector('[data-new]').addEventListener('click', () => editPreset(null));
  inner.addEventListener('click', onClick);

  function render() {
    const current = state.target.text.trim();
    inner.querySelector('[data-count]').textContent = state.presets.length ? `${state.presets.length}` : '';
    inner.querySelector('[data-presets]').innerHTML = state.presets.length
      ? state.presets.map((p) => `<div class="preset-row ${p.target === current ? 'current' : ''}">
          <span class="ic">${icon('gamepad')}</span>
          <div class="grow"><div class="title truncate">${esc(p.name)}</div><div class="sub truncate mono">${esc(p.target)}</div></div>
          <span class="faint nowrap" style="font-size:12px">${p.lastUsedAt ? `Used ${timeAgo(p.lastUsedAt)}` : 'Not used yet'}</span>
          <button class="btn sm ${p.target === current ? 'primary' : ''}" data-use="${esc(p.id)}">${p.target === current ? `${icon('check', 'sm')}Selected` : 'Use'}</button>
          <button class="btn sm ghost icon-only" data-edit="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">${icon('edit', 'sm')}</button>
          <button class="btn sm ghost icon-only" data-del="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">${icon('trash', 'sm')}</button>
        </div>`).join('')
      : `<div class="empty" style="padding:28px"><div class="art">${icon('gamepad')}</div><h3>No saved games</h3><p>Add the games you play most so you can pick them in one click.</p></div>`;
    const recent = (state.settings.recentTargets || []).slice(0, 10);
    inner.querySelector('[data-recent]').innerHTML = recent.length
      ? recent.map((t) => {
        const preset = state.presets.find((p) => p.target === t);
        return `<div class="preset-row ${t === current ? 'current' : ''}"><span class="ic" style="color:var(--text-3)">${icon('clock')}</span>
          <div class="grow"><div class="title truncate">${esc(preset ? preset.name : t)}</div>${preset ? `<div class="sub mono truncate">${esc(t)}</div>` : ''}</div>
          <button class="btn sm" data-use-target="${esc(t)}">Use</button>
          ${preset ? '' : `<button class="btn sm ghost" data-save-target="${esc(t)}">${icon('plus', 'sm')}Save</button>`}</div>`;
      }).join('')
      : '<div class="empty" style="padding:22px"><p>Games you launch will appear here.</p></div>';
  }

  async function onClick(e) {
    const b = e.target.closest('[data-use],[data-edit],[data-del],[data-use-target],[data-save-target]');
    if (!b) return;
    if (b.dataset.use) {
      const p = state.presets.find((x) => x.id === b.dataset.use);
      if (p) { await setTarget(p.target); toast({ type: 'success', message: `“${p.name}” selected. Launch accounts from the Accounts page.`, action: { label: 'Accounts', run: () => navigate('accounts') } }); }
    } else if (b.dataset.edit) {
      editPreset(state.presets.find((x) => x.id === b.dataset.edit));
    } else if (b.dataset.del) {
      const p = state.presets.find((x) => x.id === b.dataset.del);
      if (p && await confirmDialog({ title: `Delete “${p.name}”?`, message: 'This only removes it from your saved games.', confirmLabel: 'Delete', danger: true })) {
        call('presets:remove', p.id).catch((err) => toast({ type: 'error', message: errorMessage(err) }));
      }
    } else if (b.dataset.useTarget) {
      setTarget(b.dataset.useTarget);
    } else if (b.dataset.saveTarget) {
      saveCurrentAsPreset(b.dataset.saveTarget);
    }
  }

  render();
  return { update(topics) { if (topics.has('presets') || topics.has('settings') || topics.has('target')) render(); } };
}

function editPreset(preset) {
  const m = openModal({
    title: preset ? 'Edit game' : 'Add game',
    iconName: 'gamepad',
    body: `<div class="field"><label for="pn">Name</label><input id="pn" class="input" maxlength="40" value="${esc(preset ? preset.name : '')}" placeholder="e.g. Blox Fruits" autofocus></div>
      <div class="field"><label for="pt">Place ID or link</label><input id="pt" class="input mono" maxlength="500" value="${esc(preset ? preset.target : state.target.text)}" placeholder="920587237 or https://www.roblox.com/games/…"><span class="hint" data-hint></span></div>`,
    footer: '<button class="btn ghost" data-modal-close>Cancel</button><button class="btn primary" data-ok>Save</button>',
  });
  const name = m.el.querySelector('#pn');
  const target = m.el.querySelector('#pt');
  const hint = m.el.querySelector('[data-hint]');
  const check = async () => {
    const v = target.value.trim();
    if (!v) { hint.textContent = ''; return null; }
    const r = await call('launch:parse-target', v).catch(() => null);
    hint.textContent = r ? (r.error ? errorMessage({ code: r.error }) : r.label) : '';
    hint.style.color = r && r.error ? 'var(--orange)' : '';
    return r;
  };
  target.addEventListener('input', check);
  check();
  m.el.querySelector('[data-ok]').addEventListener('click', async () => {
    const r = await check();
    if (!name.value.trim() || !r || r.error) { toast({ type: 'warning', message: errorMessage({ code: 'PRESET_INVALID' }) }); return; }
    try {
      await call('presets:upsert', { id: preset ? preset.id : undefined, name: name.value, target: target.value.trim() });
      m.close();
      toast({ type: 'success', message: 'Game saved.' });
    } catch (e) { toast({ type: 'error', message: errorMessage(e) }); }
  });
}
