// Generated ambience and phase cues. No audio files, no network requests —
// everything here is synthesised with the Web Audio API.
//
// One AudioContext is created lazily on the first user gesture and then reused,
// so switching soundscape mid-session does not restart or lose the pause state.

let ctx = null;
let master = null;
let bed = null;          // nodes belonging to the current soundscape
let current = 'none';
let volume = 0.5;
let noiseBuffer = null;

export const SOUNDSCAPES = [
  { id: 'ocean', label: 'Ocean' },
  { id: 'rain',  label: 'Rain' },
  { id: 'bowl',  label: 'Singing Bowl' },
  { id: 'none',  label: 'Silent' },
];

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  return ctx;
}

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const length = ctx.sampleRate * 3;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  // Brownian-ish noise: softer and less hissy than white noise.
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return noiseBuffer;
}

function teardownBed() {
  if (!bed) return;
  bed.forEach((node) => {
    try { node.stop?.(); } catch { /* already stopped */ }
    try { node.disconnect?.(); } catch { /* already detached */ }
  });
  bed = null;
}

function buildBed(id) {
  teardownBed();
  if (id === 'none' || !ctx) return;

  const nodes = [];
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(master);
  nodes.push(bus);

  if (id === 'ocean' || id === 'rain') {
    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer();
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = id === 'ocean' ? 'lowpass' : 'bandpass';
    filter.frequency.value = id === 'ocean' ? 420 : 1800;
    filter.Q.value = id === 'ocean' ? 0.7 : 0.9;

    // Slow sweep of the filter gives the sense of waves / shifting rain.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = id === 'ocean' ? 0.07 : 0.13;
    lfoGain.gain.value = id === 'ocean' ? 260 : 420;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    source.connect(filter);
    filter.connect(bus);
    source.start();
    lfo.start();
    nodes.push(source, filter, lfo, lfoGain);
  }

  if (id === 'bowl') {
    // A fundamental plus two quiet partials, each drifting slightly out of
    // phase with the others so the drone never sits perfectly still.
    [[174, 0.5], [261.6, 0.22], [392, 0.12]].forEach(([freq, level], index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = level;

      const drift = ctx.createOscillator();
      const driftGain = ctx.createGain();
      drift.frequency.value = 0.05 + index * 0.017;
      driftGain.gain.value = 0.06 * level;
      drift.connect(driftGain);
      driftGain.connect(gain.gain);

      osc.connect(gain);
      gain.connect(bus);
      osc.start();
      drift.start();
      nodes.push(osc, gain, drift, driftGain);
    });
  }

  // Fade the bed in rather than clicking it on.
  bus.gain.setValueAtTime(0, ctx.currentTime);
  bus.gain.linearRampToValueAtTime(id === 'bowl' ? 0.10 : 0.16, ctx.currentTime + 2.5);
  bed = nodes;
}

/* ------------------------------------------------------------------ public */

export function setVolume(value) {
  volume = Math.max(0, Math.min(1, value));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
}

export function setSoundscape(id) {
  current = id;
  if (!ctx) return;          // takes effect the next time audio starts
  buildBed(id);
}

/** Must be called from a user gesture the first time. */
export function start(id = current) {
  current = id;
  if (!ensureContext()) return;
  if (ctx.state === 'suspended') ctx.resume();
  buildBed(current);
}

export function stop() {
  teardownBed();
}

export function suspend() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

const CUE_PITCH = { inhale: 587.33, hold: 783.99, exhale: 440, holdOut: 349.23, done: 523.25 };

/** Short bell on phase change. */
export function cue(kind) {
  if (!ensureContext() || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const freq = CUE_PITCH[kind] ?? 523.25;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);

  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + 1.7);
}

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.85;
  utterance.pitch = 0.95;
  utterance.volume = Math.min(1, volume + 0.2);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function cancelSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
