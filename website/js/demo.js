// A tiny, self-contained imitation of the app's Launch Together flow.
// Uses made-up demo accounts; nothing here talks to Roblox.

const ACCOUNTS = [
  { name: 'Main', user: 'BlockBuilder_77', status: 'game', where: 'Adopt Me!' },
  { name: 'Nova', user: 'NovaSprint', status: 'on' },
  { name: 'Harbor', user: 'PixelHarbor', status: 'off' },
  { name: 'Comet', user: 'QuietComet', status: 'game', where: 'Blox Fruits' },
  { name: 'Maple', user: 'MapleRunner', status: 'off' },
  { name: 'Tidal', user: 'TidalForge', status: 'on' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function initDemo({ play, burst }) {
  const grid = document.querySelector('[data-demo-grid]');
  if (!grid) return;
  const search = document.querySelector('[data-demo-search]');
  const game = document.querySelector('[data-demo-game]');
  const all = document.querySelector('[data-demo-all]');
  const launch = document.querySelector('[data-demo-launch]');
  const count = document.querySelector('[data-demo-count]');
  const log = document.querySelector('[data-demo-log]');
  const progress = document.querySelector('[data-demo-progress]');
  const selected = new Set();
  let busy = false;

  ACCOUNTS.forEach((a, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'demo-card';
    card.dataset.index = String(i);
    card.setAttribute('aria-pressed', 'false');
    const img = document.createElement('img');
    img.src = `assets/demo/avatar-${i + 1}.webp`;
    img.alt = '';
    img.width = 44;
    img.height = 44;
    img.loading = 'lazy';
    const who = document.createElement('span');
    who.className = 'who';
    const b = document.createElement('b');
    b.textContent = a.name;
    const line = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = a.status === 'game' ? 'game' : a.status === 'on' ? 'on' : '';
    line.append(dot, a.status === 'game' ? `Playing ${a.where}` : a.status === 'on' ? 'Online' : `@${a.user}`);
    who.append(b, line);
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.setAttribute('aria-hidden', 'true');
    card.append(img, who, tick);
    card.setAttribute('aria-label', `${a.name} (@${a.user})`);
    grid.append(card);
  });
  const cards = [...grid.querySelectorAll('.demo-card')];

  function refresh() {
    cards.forEach((c) => {
      const on = selected.has(Number(c.dataset.index));
      c.setAttribute('aria-pressed', String(on));
      c.querySelector('.tick').textContent = on ? '✓' : '';
    });
    count.textContent = `${selected.size} selected`;
    launch.disabled = busy || selected.size === 0;
    all.textContent = cards.filter((c) => !c.hidden).every((c) => selected.has(Number(c.dataset.index))) ? 'Clear' : 'Select all';
  }

  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.demo-card');
    if (!c || busy) return;
    const i = Number(c.dataset.index);
    if (selected.has(i)) selected.delete(i); else selected.add(i);
    cards.forEach((x) => x.classList.remove('launched'));
    refresh();
  });

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    cards.forEach((c) => {
      const a = ACCOUNTS[Number(c.dataset.index)];
      c.hidden = !!q && !`${a.name} ${a.user}`.toLowerCase().includes(q);
    });
    refresh();
  });

  all.addEventListener('click', () => {
    if (busy) return;
    const visible = cards.filter((c) => !c.hidden).map((c) => Number(c.dataset.index));
    const everything = visible.every((i) => selected.has(i));
    visible.forEach((i) => (everything ? selected.delete(i) : selected.add(i)));
    refresh();
  });

  launch.addEventListener('click', async () => {
    if (busy || !selected.size) return;
    busy = true;
    refresh();
    const order = [...selected].sort((a, b) => a - b);
    progress.hidden = false;
    const bar = progress.firstElementChild;
    bar.style.width = '0%';
    cards.forEach((c) => c.classList.remove('launched'));
    for (let n = 0; n < order.length; n++) {
      const i = order[n];
      const a = ACCOUNTS[i];
      const card = cards[i];
      card.classList.add('launching');
      log.textContent = `Launching ${n + 1} of ${order.length} · getting a sign-in ticket for ${a.name}…`;
      await sleep(650);
      log.textContent = `Launching ${n + 1} of ${order.length} · opening Roblox as ${a.name} in ${game.value}…`;
      await sleep(650);
      card.classList.remove('launching');
      card.classList.add('launched');
      bar.style.width = `${Math.round(((n + 1) / order.length) * 100)}%`;
      const r = card.getBoundingClientRect();
      burst(r.left + r.width - 22, r.top + r.height / 2, { amount: 10 });
      play('pop');
    }
    log.textContent = `${order.length} of ${order.length} accounts opened in ${game.value}. (In the real app, each one gets its own Roblox window.)`;
    play('success');
    await sleep(900);
    progress.hidden = true;
    busy = false;
    refresh();
  });

  refresh();
}
