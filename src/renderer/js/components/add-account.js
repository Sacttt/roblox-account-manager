import { call } from '../api.js';
import { state, groups } from '../store.js';
import { esc, errorMessage, monogram } from '../format.js';
import { icon } from '../icons.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openDetail } from '../actions.js';

let open = null;

export function openAddAccount({ method = 'web' } = {}) {
  if (open) return;
  let current = method;
  let preview = null;
  let verifyToken = 0;
  let waiting = false;

  const groupOptions = groups().map((g) => `<option value="${esc(g.name)}">`).join('');
  const m = openModal({
    title: 'Add a Roblox account',
    subtitle: 'Your sign-in stays on this PC, encrypted by Windows.',
    iconName: 'userPlus',
    wide: true,
    body: `
      <div class="method-tabs" role="tablist">
        <button role="tab" data-method="web">${icon('globe')}Sign in with Roblox</button>
        <button role="tab" data-method="cookie">${icon('key')}Paste a cookie</button>
      </div>
      <div data-pane="web"></div>
      <div data-pane="cookie" class="stack" style="gap:12px" hidden>
        <div class="note warn">${icon('alert')}<div><strong>Treat this cookie like a password.</strong> Anyone who has it can sign in as you. Only paste cookies for your own accounts, and never share them.</div></div>
        <div class="field">
          <div class="row"><label for="add-cookie">.ROBLOSECURITY cookie</label><span class="spacer"></span>
            <button class="btn xs ghost" type="button" data-toggle-mask>${icon('eye', 'sm')}<span>Show</span></button></div>
          <textarea id="add-cookie" class="textarea mono input masked" rows="4" spellcheck="false" autocomplete="off" placeholder="_|WARNING:-DO-NOT-SHARE-THIS…"></textarea>
          <span class="error" data-cookie-error hidden></span>
        </div>
        <details class="howto"><summary>${icon('help', 'sm')}How do I find it?</summary>
          <ol><li>Sign in at roblox.com in your browser.</li><li>Press <kbd>F12</kbd> → <b>Application</b> (Chrome/Edge) or <b>Storage</b> (Firefox) → <b>Cookies</b> → https://www.roblox.com.</li>
          <li>Copy the value of <code>.ROBLOSECURITY</code> and paste it above.</li></ol></details>
        <div data-preview></div>
      </div>
      <div class="form-grid" data-org hidden>
        <div class="field"><label for="add-nick">Nickname <span class="faint">(optional)</span></label><input id="add-nick" class="input" maxlength="60" placeholder="e.g. Main, Alt 2"></div>
        <div class="field"><label for="add-group">Group <span class="faint">(optional)</span></label><input id="add-group" class="input" maxlength="40" list="add-group-list" placeholder="e.g. Alts"><datalist id="add-group-list">${groupOptions}</datalist></div>
      </div>`,
    footer: '<button class="btn ghost" data-modal-close>Cancel</button><button class="btn primary" data-submit disabled>Add account</button>',
    onClose: () => { open = null; verifyToken++; },
  });
  open = m;
  const $ = (s) => m.el.querySelector(s);
  const submit = $('[data-submit]');
  const cookieInput = $('#add-cookie');
  const errorEl = $('[data-cookie-error]');

  function renderWeb() {
    $('[data-pane="web"]').innerHTML = waiting
      ? `<div class="waiting"><span class="spinner"></span><div><strong style="color:var(--text)">Waiting for you to sign in…</strong><br>Finish signing in in the Roblox window. This closes automatically when you're done.</div></div>`
      : `<div class="stack" style="gap:12px">
          <div class="note ok">${icon('shieldCheck')}<div><strong>Recommended.</strong> Opens Roblox's own sign-in page in a private window. Use your password, a one-time code, or Quick Sign-In — the account is added automatically, nothing to copy.</div></div>
          <div class="note">${icon('info')}<div>The window keeps nothing after it closes. Signing in to an account that is already in your list just refreshes its saved sign-in.</div></div>
        </div>`;
    submit.disabled = waiting;
    submit.innerHTML = waiting ? '<span class="spinner"></span>Waiting…' : `${icon('logIn', 'sm')}Open Roblox sign-in`;
  }

  function renderPreview() {
    const host = $('[data-preview]');
    $('[data-org]').hidden = !(current === 'web' || preview);
    if (!preview) { host.innerHTML = ''; submit.disabled = true; submit.textContent = 'Add account'; return; }
    const img = preview.avatarVersion ? `app://ram/avatar/${preview.userId}?v=${preview.avatarVersion}` : monogram(preview.displayName);
    const existing = preview.existingAccountId ? state.accounts.get(preview.existingAccountId) : null;
    host.innerHTML = `<div class="preview-card">
        <div class="avatar lg"><img src="${esc(img)}" data-fallback="${esc(monogram(preview.displayName))}" alt=""></div>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px" class="truncate">${esc(preview.displayName)}</div>
        <div class="faint">@${esc(preview.username)} · ID ${esc(preview.userId)}</div></div>
        <span class="badge green">${icon('check')}Verified by Roblox</span></div>
      ${existing ? `<div class="note warn" style="margin-top:10px">${icon('info')}<div>This account is already in your list. Adding it again will <strong>replace its saved sign-in</strong>; nickname, notes and groups are kept.</div></div>` : ''}`;
    submit.disabled = false;
    submit.textContent = existing ? 'Update sign-in' : 'Add account';
    $('[data-org]').hidden = !!existing;
  }

  async function verify() {
    const value = cookieInput.value.trim();
    preview = null;
    errorEl.hidden = true;
    renderPreview();
    if (value.length < 50) return;
    const token = ++verifyToken;
    $('[data-preview]').innerHTML = `<div class="preview-card"><div class="avatar lg skeleton"></div><div class="stack" style="flex:1;gap:6px"><div class="skeleton" style="height:12px;width:40%"></div><div class="skeleton" style="height:10px;width:25%"></div></div><span class="faint row"><span class="spinner"></span>Checking with Roblox…</span></div>`;
    try {
      const r = await call('accounts:preview-cookie', value);
      if (token !== verifyToken) return;
      preview = r;
    } catch (e) {
      if (token !== verifyToken) return;
      errorEl.textContent = errorMessage(e);
      errorEl.hidden = false;
    }
    renderPreview();
  }

  function setMethod(next) {
    if (waiting) return;
    current = next;
    m.el.querySelectorAll('[data-method]').forEach((b) => {
      b.classList.toggle('active', b.dataset.method === next);
      b.setAttribute('aria-selected', String(b.dataset.method === next));
    });
    $('[data-pane="web"]').hidden = next !== 'web';
    $('[data-pane="cookie"]').hidden = next !== 'cookie';
    if (next === 'web') { renderWeb(); $('[data-org]').hidden = false; } else { renderPreview(); cookieInput.focus(); }
  }

  m.el.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => setMethod(b.dataset.method)));
  $('[data-toggle-mask]').addEventListener('click', (e) => {
    const masked = cookieInput.classList.toggle('masked');
    e.currentTarget.innerHTML = `${icon(masked ? 'eye' : 'eyeOff', 'sm')}<span>${masked ? 'Show' : 'Hide'}</span>`;
  });
  let debounce = null;
  let pasted = false;
  cookieInput.addEventListener('paste', () => {
    pasted = true;
    clearTimeout(debounce);
    debounce = setTimeout(() => { pasted = false; verify(); }, 50);
  });
  cookieInput.addEventListener('input', () => {
    if (pasted) return;
    clearTimeout(debounce);
    debounce = setTimeout(verify, 400);
  });

  const org = () => ({ nickname: $('#add-nick').value.trim(), group: $('#add-group').value.trim() });

  submit.addEventListener('click', async () => {
    if (current === 'web') {
      waiting = true;
      renderWeb();
      try {
        const r = await call('accounts:web-login', org());
        waiting = false;
        if (!r || r.canceled) { renderWeb(); return; }
        done(r);
      } catch (e) {
        waiting = false;
        renderWeb();
        toast({ type: 'error', message: errorMessage(e) });
      }
      return;
    }
    if (!preview) return;
    m.setBusy(true);
    try {
      const r = await call('accounts:add-cookie', { cookie: cookieInput.value, ...org(), updateExisting: !!preview.existingAccountId });
      done(r);
    } catch (e) {
      m.setBusy(false);
      errorEl.textContent = errorMessage(e);
      errorEl.hidden = false;
    }
  });

  function done(r) {
    m.close();
    const name = r.account.nickname || r.account.displayName || r.account.username;
    toast({
      type: 'success',
      title: r.isNew ? 'Account added' : 'Sign-in updated',
      message: r.persisted === false ? `${name} — saved for this session only (Windows encryption unavailable).` : `${name} is ready to launch.`,
      action: { label: 'Open', run: () => openDetail(r.account.id) },
    });
  }

  setMethod(method);
}
