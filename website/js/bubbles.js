// Floating bubbles in the background (clickable — they pop!) and little
// bubble bursts when buttons are pressed. Pauses when the tab is hidden and
// stays static for visitors who prefer reduced motion.

const COLORS = [[245, 180, 60], [255, 210, 122], [78, 168, 255], [167, 139, 250], [63, 207, 142]];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const resize = () => {
    canvas.width = Math.floor(innerWidth * DPR);
    canvas.height = Math.floor(innerHeight * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
  return ctx;
}

function drawBubble(ctx, x, y, r, [cr, cg, cb], alpha) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, `rgba(255, 255, 255, ${0.10 * alpha})`);
  g.addColorStop(0.65, `rgba(${cr}, ${cg}, ${cb}, ${0.08 * alpha})`);
  g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, ${0.32 * alpha})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.45 * alpha})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  // glossy highlight
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 * alpha})`;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.68, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();
}

export function startBubbles({ onPop } = {}) {
  const bg = document.getElementById('bubbles');
  const fx = document.getElementById('bursts');
  if (!bg || !fx) return { burst() {} };
  const bctx = setupCanvas(bg);
  const fctx = setupCanvas(fx);

  const count = () => Math.round(Math.min(34, Math.max(12, (innerWidth * innerHeight) / 52000)));
  const make = (initial) => {
    const r = 6 + Math.random() ** 1.8 * 30;
    return {
      x: Math.random() * innerWidth,
      y: initial ? Math.random() * innerHeight : innerHeight + r + Math.random() * 80,
      r,
      vy: 0.18 + Math.random() * 0.45 + (30 - r) * 0.006,
      phase: Math.random() * Math.PI * 2,
      wobble: 0.3 + Math.random() * 0.7,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 0.55 + Math.random() * 0.45,
      pushX: 0,
    };
  };
  const bubbles = Array.from({ length: count() }, () => make(true));
  addEventListener('resize', () => {
    const n = count();
    while (bubbles.length < n) bubbles.push(make(true));
    if (bubbles.length > n) bubbles.length = n;
  });

  const pointer = { x: -999, y: -999 };
  addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

  let particles = [];
  let fxRunning = false;

  function burst(x, y, { amount = 14, color = null, ring = true } = {}) {
    if (reduced) return;
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 3.2;
      particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 1.6,
        r: 2 + Math.random() * 6, life: 1, decay: 0.012 + Math.random() * 0.02,
        color: color || COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
    if (ring) particles.push({ ring: true, x, y, r: 4, life: 1, decay: 0.035, color: color || COLORS[0] });
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
  }

  function fxLoop() {
    fctx.clearRect(0, 0, innerWidth, innerHeight);
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.life -= p.decay;
      if (p.ring) {
        p.r += 3.2;
        fctx.strokeStyle = `rgba(${p.color.join(',')}, ${Math.max(0, p.life) * 0.6})`;
        fctx.lineWidth = 2;
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        fctx.stroke();
      } else {
        p.vy += 0.035;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        drawBubble(fctx, p.x, p.y, p.r, p.color, Math.max(0, p.life) * 1.6);
      }
    }
    if (particles.length) requestAnimationFrame(fxLoop);
    else { fxRunning = false; fctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  let running = true;
  let last = performance.now();
  function loop(now) {
    if (!running) return;
    const dt = Math.min(48, now - last) / 16.7;
    last = now;
    bctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bubbles) {
      b.phase += 0.012 * dt;
      b.y -= b.vy * dt;
      const dx = b.x - pointer.x;
      const dy = b.y - pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < 120 && d > 0) b.pushX += (dx / d) * (120 - d) * 0.004 * dt;
      b.pushX *= 0.95;
      b.x += Math.sin(b.phase) * b.wobble * 0.4 * dt + b.pushX;
      if (b.y < -b.r - 20) Object.assign(b, make(false));
      drawBubble(bctx, b.x, b.y, b.r, b.color, b.alpha);
    }
    requestAnimationFrame(loop);
  }

  if (reduced) {
    for (const b of bubbles) drawBubble(bctx, b.x, b.y, b.r, b.color, b.alpha * 0.8);
  } else {
    requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running) { last = performance.now(); requestAnimationFrame(loop); }
    });
  }

  // Clicking a background bubble pops it (but never steals clicks from controls).
  document.addEventListener('pointerdown', (e) => {
    if (reduced || e.target.closest('a, button, input, select, textarea, summary, label, dialog, .window, .demo-app')) return;
    const hit = bubbles.find((b) => Math.hypot(b.x - e.clientX, b.y - e.clientY) <= b.r + 6);
    if (!hit) return;
    burst(hit.x, hit.y, { amount: Math.round(8 + hit.r / 2), color: hit.color });
    Object.assign(hit, make(false));
    if (onPop) onPop();
  });

  return { burst };
}
