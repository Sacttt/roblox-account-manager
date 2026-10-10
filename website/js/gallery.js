// Screenshot tabs (keyboard accessible) with a click-to-zoom lightbox.

export const SHOTS = [
  { id: 'dashboard', title: 'Dashboard', sub: 'Your accounts at a glance', caption: 'The dashboard: totals, who is online, quick launch for favorites, accounts that need attention and recent activity.' },
  { id: 'accounts-grid', title: 'Accounts', sub: 'Cards with live status', caption: 'Every account as a card with its group, tags, live status from Roblox and sign-in state. Search and filter instantly.' },
  { id: 'accounts-bulk', title: 'Launch Together', sub: 'Select several, open all', caption: 'Select accounts and launch them together — each opens in its own Roblox window, one after another.' },
  { id: 'accounts-table', title: 'Table view', sub: 'Dense and sortable', caption: 'Prefer a list? The table view fits many accounts on one screen.' },
  { id: 'account-details', title: 'Account details', sub: 'Organize & manage sign-in', caption: 'Nickname, group, tags and private notes, plus sign-in status with one-click fixes.' },
  { id: 'add-account', title: 'Add an account', sub: 'Verified before saving', caption: 'Sign in with Roblox, or paste a cookie — it is checked with Roblox and previewed before anything is saved.' },
  { id: 'command-palette', title: 'Command palette', sub: 'Ctrl K for everything', caption: 'Press Ctrl K, type a name and hit Enter to launch. Commands for everything else are in the same box.' },
  { id: 'games', title: 'Games', sub: 'Saved games & servers', caption: 'Save games and private servers, see what you launched recently, and pick one in a click.' },
  { id: 'settings-launching', title: 'Settings', sub: 'Launcher & Multi Roblox', caption: 'Choose the launcher (official, Bloxstrap or Fishstrap), Multi Roblox and the delay between accounts.' },
  { id: 'settings-appearance', title: 'Themes', sub: '8 themes + accent colors', caption: 'Eight themes, including a light one, a custom accent color and a compact density.' },
  { id: 'dashboard-light', title: 'Light theme', sub: 'Easy on bright rooms', caption: 'The same app in the light theme.' },
];

const src = (id) => `assets/screens/${id}.webp`;

export function initGallery({ onChange } = {}) {
  const tabs = document.querySelector('[data-gallery-tabs]');
  const img = document.querySelector('[data-gallery-img]');
  const title = document.querySelector('[data-gallery-title]');
  const caption = document.querySelector('[data-gallery-caption]');
  if (!tabs || !img) return;

  tabs.innerHTML = '';
  SHOTS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.shot = s.id;
    b.dataset.sound = '';
    b.setAttribute('aria-selected', String(i === 0));
    b.tabIndex = i === 0 ? 0 : -1;
    b.textContent = s.title;
    const small = document.createElement('small');
    small.textContent = s.sub;
    b.append(small);
    tabs.append(b);
  });

  let current = 0;
  const show = (i, focus = false) => {
    current = (i + SHOTS.length) % SHOTS.length;
    const s = SHOTS[current];
    tabs.querySelectorAll('[role="tab"]').forEach((b, j) => {
      b.setAttribute('aria-selected', String(j === current));
      b.tabIndex = j === current ? 0 : -1;
      if (j === current && focus) b.focus();
    });
    img.classList.add('fading');
    const next = new Image();
    next.onload = () => {
      img.src = next.src;
      img.alt = s.caption;
      img.classList.remove('fading');
    };
    next.src = src(s.id);
    if (title) title.textContent = s.title;
    if (caption) caption.textContent = s.caption;
    if (onChange) onChange(s);
  };

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shot]');
    if (b) show(SHOTS.findIndex((s) => s.id === b.dataset.shot));
  });
  tabs.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); show(current + 1, true); }
    if (['ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); show(current - 1, true); }
  });
  caption.textContent = SHOTS[0].caption;
  img.alt = SHOTS[0].caption;

  // Warm the cache so switching tabs is instant.
  const warm = () => SHOTS.forEach((s) => { const i = new Image(); i.src = src(s.id); });
  if ('requestIdleCallback' in window) requestIdleCallback(warm); else setTimeout(warm, 1500);

  // Lightbox
  const box = document.querySelector('[data-lightbox]');
  const boxImg = document.querySelector('[data-lightbox-img]');
  const opener = document.querySelector('[data-open-lightbox]');
  if (box && boxImg && opener && typeof box.showModal === 'function') {
    opener.addEventListener('click', () => {
      boxImg.src = img.src;
      boxImg.alt = img.alt;
      box.showModal();
    });
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
    const close = box.querySelector('[data-lightbox-close]');
    if (close) close.addEventListener('click', () => box.close());
  }
}

export function initHeroTabs() {
  const img = document.querySelector('[data-hero-img]');
  const buttons = [...document.querySelectorAll('[data-hero-shot]')];
  if (!img || !buttons.length) return;
  let auto = null;
  const select = (b) => {
    buttons.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    img.classList.add('fading');
    const next = new Image();
    next.onload = () => { img.src = next.src; img.classList.remove('fading'); };
    next.src = src(b.dataset.heroShot);
  };
  buttons.forEach((b) => b.addEventListener('click', () => { clearInterval(auto); select(b); }));
  // Gently cycle until the visitor picks one themselves.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let i = 0;
    auto = setInterval(() => {
      if (document.hidden) return;
      i = (i + 1) % buttons.length;
      select(buttons[i]);
    }, 5200);
  }
}
