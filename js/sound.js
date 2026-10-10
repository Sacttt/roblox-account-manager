// Small synthesized UI sounds (no audio files). The audio context is only
// created after the visitor's first click, as browsers require.

const KEY = 'ram-site-sound';
let ctx = null;
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (_) { /* storage blocked */ }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(ac, { type = 'sine', from, to, start = 0, dur = 0.08, gain = 0.06 }) {
  const t = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SOUNDS = {
  // soft click for ordinary buttons and tabs
  tap: (ac) => tone(ac, { type: 'triangle', from: 900, to: 420, dur: 0.07, gain: 0.05 }),
  // bubbly "bloop" for primary actions and popped bubbles
  pop: (ac) => {
    tone(ac, { from: 260, to: 980, dur: 0.09, gain: 0.09 });
    tone(ac, { type: 'triangle', from: 1400, to: 700, start: 0.03, dur: 0.06, gain: 0.025 });
  },
  // three rising notes when the demo finishes
  success: (ac) => [1046.5, 1318.5, 1568].forEach((f, i) => tone(ac, { from: f, to: f * 1.01, start: i * 0.075, dur: 0.16, gain: 0.05 })),
  toggle: (ac) => tone(ac, { type: 'square', from: 660, to: 880, dur: 0.05, gain: 0.025 }),
};

export function play(kind = 'tap') {
  if (!enabled) return;
  const ac = audio();
  if (ac && SOUNDS[kind]) SOUNDS[kind](ac);
}

export function isEnabled() {
  return enabled;
}

export function setEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (_) { /* ignore */ }
}
