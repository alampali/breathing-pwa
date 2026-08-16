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

/* ------------------------------------------------------------------ speech */
//
// Spoken cues are the fiddliest thing here, and iOS is the reason. Three
// separate behaviours conspire to drop utterances:
//
//   1. Speech may only *begin* from inside a user gesture. Every phase cue is
//      fired from a timer, so unless the engine has been unlocked by an earlier
//      tap, iOS silently discards them — no error, no event.
//   2. cancel() settles asynchronously. Calling speak() in the same tick, as
//      the obvious implementation does, loses the new utterance.
//   3. The queue parks itself after a cancel or a trip to the background, and
//      stays parked until resume() is called.

let speechPrimed = false;
let chosenVoice = null;
let onSpeechBlocked = null;

const synth = () => window.speechSynthesis;

export const speechSupported = () => 'speechSynthesis' in window;

function pickVoice() {
  if (!speechSupported()) return null;
  const voices = synth().getVoices();
  if (!voices.length) return null;               // not loaded yet
  const lang = navigator.language || 'en-US';
  const base = lang.slice(0, 2);
  return voices.find((v) => v.lang === lang && v.localService)
    || voices.find((v) => v.lang === lang)
    || voices.find((v) => v.lang?.startsWith(base) && v.localService)
    || voices.find((v) => v.lang?.startsWith(base))
    || voices.find((v) => v.default)
    || voices[0]
    || null;
}

if (speechSupported()) {
  chosenVoice = pickVoice();
  // The voice list is usually empty on first read and fills in asynchronously.
  synth().addEventListener?.('voiceschanged', () => { chosenVoice = pickVoice(); });
}

/** Called when a cue was requested but the engine never spoke it. */
export function setSpeechBlockedHandler(handler) {
  onSpeechBlocked = handler;
}

/**
 * Unlocks the speech engine. Must be called from inside a user gesture — a tap
 * on Start or on the voice toggle — or every later cue is dropped on iOS.
 */
export function primeSpeech() {
  if (!speechSupported() || speechPrimed) return;
  try {
    const warmup = new SpeechSynthesisUtterance(' ');
    warmup.volume = 0;
    warmup.onstart = () => { speechPrimed = true; };
    synth().speak(warmup);
  } catch {
    // Nothing to do — speak() will report it as blocked if it stays broken.
  }
}

export function speak(text) {
  if (!speechSupported()) return;
  const engine = synth();
  if (engine.paused) engine.resume();

  const utterance = new SpeechSynthesisUtterance(text);
  if (chosenVoice) utterance.voice = chosenVoice;
  utterance.lang = chosenVoice?.lang || navigator.language || 'en-US';
  utterance.rate = 0.9;
  utterance.pitch = 0.95;
  // The slider governs ambience; guidance needs to stay audible above it,
  // unless the slider is all the way down and silence is clearly the intent.
  utterance.volume = volume <= 0.02 ? 0 : Math.max(0.6, volume);

  let started = false;
  utterance.onstart = () => { started = true; speechPrimed = true; };
  utterance.onerror = () => { if (!started) onSpeechBlocked?.(); };
  setTimeout(() => { if (!started) onSpeechBlocked?.(); }, 700);

  if (engine.speaking || engine.pending) {
    engine.cancel();
    setTimeout(() => engine.speak(utterance), 90);
  } else {
    engine.speak(utterance);
  }
}

export function cancelSpeech() {
  if (speechSupported()) synth().cancel();
}
