// Generated ambience and cues. No audio files, no network requests — everything
// here is synthesised with the Web Audio API.
//
// One AudioContext is created lazily on the first user gesture and then reused,
// so switching soundscape mid-session does not restart or lose the pause state.
//
// Two iOS behaviours shape most of what follows:
//
//   1. The ringer switch mutes Web Audio. Speech synthesis is *not* muted by it,
//      which is why guidance can be audible while the chime and soundscape are
//      silent. Declaring an audio session of type "playback" opts out of that.
//   2. The context can land in "suspended" or WebKit's "interrupted" state after
//      a call, an alarm, or a locked screen, and does not recover on its own.

let ctx = null;
let master = null;
let bed = null;          // nodes belonging to the current soundscape
let current = 'none';
let volume = 0.5;

export const SOUNDSCAPES = [
  { id: 'ocean', label: 'Ocean' },
  { id: 'rain',  label: 'Rain' },
  { id: 'bowl',  label: 'Singing Bowl' },
  { id: 'none',  label: 'Silent' },
];

/**
 * Ask iOS to treat this as media playback so the ringer switch stops muting it.
 * Safari 16.4+; a no-op everywhere else.
 */
function claimPlaybackSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    // Not supported — the ringer switch will still mute us, nothing to be done.
  }
}

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  claimPlaybackSession();
  ctx = new AudioCtx();

  // A safety limiter on the way out. The closing bowl stacks five partials, a
  // strike and a shimmer, and at full volume that peaked around 1.37 — hard
  // clipping, which on a phone speaker is an audible crackle at precisely the
  // calmest moment. It also covers a cue landing on top of a soundscape.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);

  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(limiter);

  // "interrupted" is WebKit-only and does not clear itself. Without this a phone
  // call or a locked screen leaves the rest of the session silent.
  ctx.addEventListener?.('statechange', () => {
    if (ctx && ctx.state !== 'running') ctx.resume?.().catch(() => {});
  });
  return ctx;
}

/**
 * Nudges the context back to running and reports whether audio can be heard.
 * Scheduling still works while suspended — the sound simply arrives on resume —
 * so callers should go ahead rather than bail.
 */
function wake() {
  if (!ensureContext()) return false;
  if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
  return true;
}

const noiseBuffers = {};

/**
 * Brown noise falls off steeply with frequency, so it suits the ocean's low
 * wash but has almost nothing left to give a band-pass up at 2kHz — filtering
 * it there rendered the rain about five times quieter than every other bed.
 * Rain is built from white noise instead, which is what actual rain sounds like.
 */
function getNoiseBuffer(colour = 'brown') {
  if (noiseBuffers[colour]) return noiseBuffers[colour];
  const length = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (colour === 'white') {
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  } else {
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }

  noiseBuffers[colour] = buffer;
  return buffer;
}

function teardownBed() {
  if (!bed) return;
  bed.forEach((node) => {
    try { node.stop?.(); } catch { /* already stopped */ }
    try { node.disconnect?.(); } catch { /* already detached */ }
  });
  bed = null;
}

// Levels and cutoffs are pitched for a phone speaker, which rolls off steeply
// below roughly 500Hz. An earlier version filtered the ocean down to 420Hz and
// was close to inaudible on an iPhone while sounding fine on headphones.
const BED_LEVEL = { ocean: 0.34, rain: 0.3, bowl: 0.28 };

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
    source.buffer = getNoiseBuffer(id === 'rain' ? 'white' : 'brown');
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = id === 'ocean' ? 'lowpass' : 'bandpass';
    filter.frequency.value = id === 'ocean' ? 900 : 2400;
    filter.Q.value = id === 'ocean' ? 1.2 : 0.7;

    // Slow sweep of the filter gives the sense of waves / shifting rain.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = id === 'ocean' ? 0.07 : 0.13;
    lfoGain.gain.value = id === 'ocean' ? 520 : 900;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    source.connect(filter);
    filter.connect(bus);
    source.start();
    lfo.start();
    nodes.push(source, filter, lfo, lfoGain);
  }

  if (id === 'bowl') {
    // Pitched an octave up from the traditional 174Hz so a phone speaker can
    // actually reproduce the fundamental.
    [[220, 0.5], [330, 0.24], [440, 0.16], [660, 0.08]].forEach(([freq, level], index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = level;

      const drift = ctx.createOscillator();
      const driftGain = ctx.createGain();
      drift.frequency.value = 0.05 + index * 0.017;
      driftGain.gain.value = 0.07 * level;
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
  bus.gain.linearRampToValueAtTime(BED_LEVEL[id] ?? 0.3, ctx.currentTime + 2.2);
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
  wake();
  buildBed(id);
}

/** Must be called from a user gesture the first time. */
export function start(id = current) {
  current = id;
  if (!wake()) return;
  buildBed(current);
}

export function stop() {
  teardownBed();
}

export function suspend() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function resume() {
  if (ctx && ctx.state !== 'running') ctx.resume?.().catch(() => {});
}

/** Whether audio is currently able to make a sound, for the Sound tab's check. */
export function audioState() {
  return {
    supported: Boolean(window.AudioContext || window.webkitAudioContext),
    created: Boolean(ctx),
    state: ctx?.state ?? 'none',
    sessionType: (() => {
      try { return navigator.audioSession?.type ?? null; } catch { return null; }
    })(),
  };
}

const CUE_PITCH = { inhale: 587.33, hold: 783.99, exhale: 440, holdOut: 349.23, done: 523.25 };

/**
 * Short bell on phase change.
 *
 * This used to return early unless the context was exactly "running", which on
 * iOS meant no chime at all for most of a session — the context is routinely
 * suspended or interrupted and only recovers when asked. Waking it and
 * scheduling anyway is both louder and far more reliable.
 */
export function cue(kind) {
  if (!wake()) return;
  const now = ctx.currentTime;
  const freq = CUE_PITCH[kind] ?? 523.25;

  const osc = ctx.createOscillator();
  const partial = ctx.createOscillator();
  const gain = ctx.createGain();
  const partialGain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = freq;
  partial.type = 'sine';
  partial.frequency.value = freq * 2.01;   // slight detune gives it a bell edge

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.5, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);

  partialGain.gain.setValueAtTime(0, now);
  partialGain.gain.linearRampToValueAtTime(0.16, now + 0.01);
  partialGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

  osc.connect(gain);
  partial.connect(partialGain);
  gain.connect(master);
  partialGain.connect(master);
  osc.start(now);
  partial.start(now);
  osc.stop(now + 2);
  partial.stop(now + 1);
}

/**
 * The end of a session: a struck bowl rather than another phase chime.
 *
 * A stack of detuned partials with staggered decays, a soft noise transient for
 * the strike itself, and a shimmer an octave up. Runs about six seconds and is
 * deliberately much louder and longer than `cue` — this is the moment the whole
 * session lands on.
 */
export function completion() {
  if (!wake()) return;
  const now = ctx.currentTime;

  const bus = ctx.createGain();
  bus.gain.value = 0.75;
  bus.connect(master);

  // Struck partials. Lower ones ring longer, as a real bowl does.
  const partials = [
    { freq: 261.63, level: 0.62, decay: 6.0 },
    { freq: 392.00, level: 0.34, decay: 4.6 },
    { freq: 523.25, level: 0.26, decay: 3.4 },
    { freq: 784.00, level: 0.14, decay: 2.4 },
    { freq: 1046.5, level: 0.08, decay: 1.6 },
  ];

  partials.forEach(({ freq, level, decay }, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // A touch of detune per partial stops it sounding like a synth chord.
    osc.frequency.setValueAtTime(freq * (1 + (index % 2 ? 0.0016 : -0.0016)), now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + decay + 0.1);
  });

  // The strike: a very short filtered noise burst under the attack.
  const strike = ctx.createBufferSource();
  strike.buffer = getNoiseBuffer('white');
  const strikeFilter = ctx.createBiquadFilter();
  strikeFilter.type = 'bandpass';
  strikeFilter.frequency.value = 1400;
  strikeFilter.Q.value = 0.8;
  const strikeGain = ctx.createGain();
  strikeGain.gain.setValueAtTime(0.34, now);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  strike.connect(strikeFilter);
  strikeFilter.connect(bus);
  strike.start(now);
  strike.stop(now + 0.4);

  // A slow shimmer that swells after the strike and fades with the tail.
  const shimmer = ctx.createOscillator();
  const shimmerGain = ctx.createGain();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(1568, now);
  shimmerGain.gain.setValueAtTime(0, now);
  shimmerGain.gain.linearRampToValueAtTime(0.05, now + 0.9);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.0);
  shimmer.connect(shimmerGain);
  shimmerGain.connect(bus);
  shimmer.start(now);
  shimmer.stop(now + 5.2);
}

/** Plays the given soundscape briefly so it can be auditioned outside a session. */
export function preview(id, seconds = 3.5) {
  if (id === 'none' || !wake()) return;
  const previous = current;
  buildBed(id);
  const previewing = bed;
  setTimeout(() => {
    // Leave it alone if a real session has since taken over the bed.
    if (bed === previewing) buildBed(previous === id ? id : 'none');
  }, seconds * 1000);
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

/* --------------------------------------------------------------- vibration */

/**
 * iOS Safari does not implement the Vibration API at all — `navigator.vibrate`
 * is simply absent, so the setting can never do anything on an iPhone. Callers
 * use this to say so plainly rather than leaving a switch that does nothing.
 */
export function vibrationSupported() {
  return typeof navigator.vibrate === 'function';
}

export function vibrate(pattern) {
  if (!vibrationSupported()) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}
