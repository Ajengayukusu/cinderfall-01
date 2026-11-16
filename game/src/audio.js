// audio.js — every sound is synthesized with WebAudio: no audio files, nothing to load, so the
// game stays fully offline. Noise bursts through band filters read as gunfire, a filtered
// square blip as the charge's beep, and distance does the mixing for other people's shots.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ dur = 0.12, freq = 1800, q = 0.8, gain = 0.5, type = 'bandpass', slideTo = null, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.setValueAtTime(freq, t); filter.Q.value = q;
  if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}

function tone({ freq = 440, dur = 0.1, gain = 0.2, type = 'square', delay = 0, slideTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type; osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// A shot, mixed by distance from the listener: your own gun is full and bright, a shot across
// the yard is a dull crack. kind colours the weapon: the sniper booms, the SMG chatters thin.
export function sfxShot(dist, kind) {
  if (!ctx) return;
  const near = Math.max(0.12, 1 - dist / 55);
  const base = { rifle: 1500, smg: 2100, pistol: 1900, shotgun: 900, sniper: 620 }[kind] ?? 1500;
  burst({ dur: kind === 'sniper' ? 0.34 : 0.13, freq: base * (0.5 + near * 0.7), gain: 0.55 * near + 0.05, slideTo: 220 });
  if (dist < 2) burst({ dur: 0.05, freq: 3400, gain: 0.3, type: 'highpass' });
}

export function sfxReload() {
  tone({ freq: 300, dur: 0.05, gain: 0.12, type: 'square' });
  tone({ freq: 210, dur: 0.05, gain: 0.12, type: 'square', delay: 0.16 });
  tone({ freq: 380, dur: 0.06, gain: 0.14, type: 'square', delay: 0.34 });
}

export function sfxHit(head) {
  tone({ freq: head ? 1560 : 1050, dur: 0.07, gain: 0.22, type: 'sine' });
  if (head) tone({ freq: 2100, dur: 0.09, gain: 0.16, type: 'sine', delay: 0.03 });
}

export function sfxHurt() {
  burst({ dur: 0.1, freq: 300, gain: 0.3, type: 'lowpass' });
}

export function sfxThrow() {
  burst({ dur: 0.14, freq: 900, gain: 0.1, slideTo: 2400 });
}

export function sfxExplosion(big) {
  if (!ctx) return;
  burst({ dur: big ? 1.4 : 0.7, freq: 300, gain: big ? 0.95 : 0.6, type: 'lowpass', slideTo: 60 });
  tone({ freq: 90, dur: big ? 1.1 : 0.5, gain: 0.5, type: 'sine', slideTo: 34 });
}

export function sfxFlash() {
  burst({ dur: 0.3, freq: 5200, gain: 0.4, type: 'highpass' });
  tone({ freq: 3400, dur: 0.5, gain: 0.1, type: 'sine', slideTo: 2800 });
}

export function sfxBeep(final) {
  tone({ freq: final ? 1480 : 980, dur: final ? 0.3 : 0.09, gain: 0.2, type: 'square' });
}

export function sfxPlantDone() {
  tone({ freq: 740, dur: 0.09, gain: 0.2, type: 'square' });
  tone({ freq: 1108, dur: 0.14, gain: 0.2, type: 'square', delay: 0.1 });
}

export function sfxRoundWin(won) {
  const seq = won ? [523, 659, 784] : [392, 330, 262];
  seq.forEach((f, i) => tone({ freq: f, dur: 0.16, gain: 0.16, type: 'triangle', delay: i * 0.13 }));
}

export function sfxBuy() {
  tone({ freq: 880, dur: 0.05, gain: 0.12, type: 'sine' });
  tone({ freq: 1320, dur: 0.07, gain: 0.12, type: 'sine', delay: 0.05 });
}

export function sfxDenied() {
  tone({ freq: 160, dur: 0.12, gain: 0.18, type: 'square' });
}
