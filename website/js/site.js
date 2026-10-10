import { loadRelease, applyRelease } from './release.js';
import { play, isEnabled, setEnabled } from './sound.js';
import { startBubbles } from './bubbles.js';
import { initGallery, initHeroTabs } from './gallery.js';
import { initDemo } from './demo.js';

const fx = startBubbles({ onPop: () => play('pop') });

// Click sounds + a ripple and bubble burst on every button.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-sound], .btn, button');
  if (!el || el.disabled) return;
  play(el.dataset.sound || 'tap');
  if (el.classList.contains('btn')) {
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    el.append(ripple);
    setTimeout(() => ripple.remove(), 650);
    fx.burst(e.clientX, e.clientY, { amount: el.classList.contains('primary') ? 16 : 9, ring: el.classList.contains('primary') });
  }
});
// Keyboard activation gets the sound too.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-sound], .btn, button, summary')) play(e.target.dataset.sound || 'tap');
});

// Sound toggle
const toggle = document.getElementById('sound-toggle');
const syncToggle = () => {
  toggle.setAttribute('aria-pressed', String(isEnabled()));
  toggle.title = isEnabled() ? 'Click sounds on' : 'Click sounds off';
};
toggle.addEventListener('click', () => {
  setEnabled(!isEnabled());
  syncToggle();
  play('toggle');
});
syncToggle();

// Latest release -> download buttons
loadRelease().then(applyRelease);

initHeroTabs();
initGallery();
initDemo({ play, burst: fx.burst });

// Reveal-on-scroll
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  : null;
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i % 4, 3) * 70}ms`;
  if (io) io.observe(el); else el.classList.add('in');
});
