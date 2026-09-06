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
let bedBus = null;       // its gain node, so speech can duck under it
let current = 'none';
let volume = 0.5;

/**
 * A soundscape is either synthesised here, or a looping audio file.
 *
 * File-backed entries carry `src` and a `gain` — recorded music is far hotter
 * than the generated beds, so it needs pulling down to sit at the same level.
 * `fallback` names the generated bed to use if the file is missing, which is
 * what happens in a fresh clone: no audio is committed to the repository.
 */
export const SOUNDSCAPES = [
  { id: 'flute', label: 'Flute', src: './audio/flute.mp3', gain: 0.5, fallback: 'bowl' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'rain',  label: 'Rain' },
  { id: 'bowl',  label: 'Singing Bowl' },
  { id: 'none',  label: 'Silent' },
];

export function findSoundscape(id) {
  return SOUNDSCAPES.find((sound) => sound.id === id) || null;
}

/** Track elements are cached: a MediaElementSource may only be made once each. */
const trackNodes = new Map();
let onTrackMissing = null;

export function setTrackMissingHandler(handler) {
  onTrackMissing = handler;
}

function getTrack(src) {
  if (trackNodes.has(src)) return trackNodes.get(src);

  const element = new Audio();
  element.src = src;
  element.loop = true;
  element.preload = 'auto';
  element.crossOrigin = 'anonymous';
  element.playsInline = true;
  // Routed through the graph rather than played directly, so the volume slider
  // and the output limiter apply to it exactly as they do to everything else.
  const source = ctx.createMediaElementSource(element);
  const entry = { element, source };
  trackNodes.set(src, entry);
  return entry;
}

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
    // A track's element is paused rather than stopped, and its source node is
    // left connected — it belongs to the cache and gets reused.
    if (node instanceof HTMLAudioElement) {
      try { node.pause(); node.currentTime = 0; } catch { /* not ready yet */ }
      return;
    }
    if (node instanceof MediaElementAudioSourceNode) {
      // Disconnect but keep it: it can be reconnected, never recreated.
      try { node.disconnect(); } catch { /* already detached */ }
      return;
    }
    try { node.stop?.(); } catch { /* already stopped */ }
    try { node.disconnect?.(); } catch { /* already detached */ }
  });
  bed = null;
  bedBus = null;
}

// Levels and cutoffs are pitched for a phone speaker, which rolls off steeply
// below roughly 500Hz. An earlier version filtered the ocean down to 420Hz and
// was close to inaudible on an iPhone while sounding fine on headphones.
const BED_LEVEL = { ocean: 0.34, rain: 0.3, bowl: 0.28 };

// Which bed is meant to be playing. Distinct from `current`, which is the
// chosen soundscape — previewing builds a bed without changing the choice.
let activeBedId = 'none';

function buildBed(id) {
  teardownBed();
  activeBedId = id;
  if (id === 'none' || !ctx) return;

  const nodes = [];
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(master);
  nodes.push(bus);
  bedBus = bus;

  const sound = findSoundscape(id);

  if (sound?.src) {
    const { element, source } = getTrack(sound.src);
    source.connect(bus);
    nodes.push(element, source);

    element.onerror = () => {
      // No audio ships with the repository, so a missing file is the normal
      // first-run state rather than an error. Drop to the generated bed and let
      // the UI explain, instead of leaving a soundscape that plays nothing.
      //
      // Compared against the bed actually being built, not the chosen
      // soundscape: previewing builds a bed without changing the choice, so
      // testing `current` here skipped the fallback for every preview.
      if (activeBedId !== id) return;
      onTrackMissing?.(sound);
      buildBed(sound.fallback || 'bowl');
    };

    const played = element.play();
    played?.catch(() => {
      // Autoplay refusal: the next user gesture will start it.
    });

    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(sound.gain ?? 0.5, ctx.currentTime + 2.2);
    bed = nodes;
    return;
  }

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

/**
 * Dips the soundscape while something is spoken, then lets it back up.
 *
 * Without this the guidance competes with the music at the same level and both
 * turn to mush; ducking is what makes a spoken cue sound placed rather than
 * layered on top.
 */
function duckBed(depth = 0.35, holdSeconds = 1.6) {
  if (!ctx || !bedBus) return;
  const sound = findSoundscape(current);
  const full = sound?.src ? (sound.gain ?? 0.5) : (BED_LEVEL[current] ?? 0.3);
  const now = ctx.currentTime;
  bedBus.gain.cancelScheduledValues(now);
  bedBus.gain.setValueAtTime(bedBus.gain.value, now);
  bedBus.gain.linearRampToValueAtTime(full * depth, now + 0.25);
  bedBus.gain.setValueAtTime(full * depth, now + holdSeconds);
  bedBus.gain.linearRampToValueAtTime(full, now + holdSeconds + 0.9);
}

/** Whether audio is currently able to make a sound, for the Sound tab's check. */
export function audioState() {
  const sound = findSoundscape(activeBedId);
  const entry = sound?.src ? trackNodes.get(sound.src) : null;
  return {
    supported: Boolean(window.AudioContext || window.webkitAudioContext),
    created: Boolean(ctx),
    state: ctx?.state ?? 'none',
    sessionType: (() => {
      try { return navigator.audioSession?.type ?? null; } catch { return null; }
    })(),
    bed: activeBedId,
    bedGain: bedBus ? Math.round(bedBus.gain.value * 1000) / 1000 : null,
    // Present only while a file-backed soundscape is loaded, so a silent track
    // can be told apart from a silent output.
    track: entry ? {
      src: entry.element.src,
      paused: entry.element.paused,
      currentTime: entry.element.currentTime,
      duration: entry.element.duration,
      readyState: entry.element.readyState,
      error: entry.element.error?.code ?? null,
    } : null,
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

// Apple ships several tiers of voice under similar names. The "Enhanced" and
// "Premium" variants are markedly warmer than the compact ones that come
// installed, and are the single biggest factor in whether guidance sounds human
// — but they only exist once the user has downloaded them in iOS Settings.
const QUALITY_HINTS = [/premium/i, /enhanced/i, /neural/i, /natural/i, /siri/i];

// Reliably warm-sounding English voices, best first, when nothing else decides.
const PREFERRED_NAMES = [
  'ava', 'samantha', 'serena', 'allison', 'susan', 'karen',
  'moira', 'fiona', 'tessa', 'daniel', 'oliver',
];

// macOS ships a set of joke and effect voices — "Bad News", "Bahh", "Zarvox" —
// which are useless for guidance and were landing directly beneath the good one
// in the picker. They are pushed to the bottom rather than hidden, since they
// remain perfectly selectable if someone actually wants them.
const NOVELTY_NAMES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
  'deranged', 'good news', 'hysterical', 'jester', 'junior', 'organ',
  'pipe organ', 'princess', 'ralph', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox', 'fred', 'kathy', 'bruce', 'agnes',
]);

/**
 * Scores voices so the most natural-sounding one wins by default.
 * Exported for testing — ranking is easy to get subtly wrong and hard to hear.
 */
export function rankVoices(voices, lang = 'en-US') {
  const base = (lang || 'en').slice(0, 2).toLowerCase();
  return [...voices]
    .map((voice, index) => {
      const name = (voice.name || '').toLowerCase();
      const voiceLang = (voice.lang || '').toLowerCase();
      let score = 0;
      if (voiceLang === lang.toLowerCase()) score += 40;
      else if (voiceLang.startsWith(base)) score += 25;
      else score -= 60;                       // wrong language is disqualifying

      if (QUALITY_HINTS.some((re) => re.test(name))) score += 30;
      if (NOVELTY_NAMES.has(name.replace(/\s*\(.*$/, '').trim())) score -= 50;
      const preferred = PREFERRED_NAMES.indexOf(name.split(/[\s(]/)[0]);
      if (preferred >= 0) score += 18 - preferred;
      if (voice.localService) score += 4;     // offline, and usually lower latency
      if (voice.default) score += 2;
      return { voice, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.voice);
}

/** Voices worth offering: the UI language first, and never a silent list. */
export function listVoices(lang = navigator.language || 'en-US') {
  if (!speechSupported()) return [];
  const all = synth().getVoices();
  const base = lang.slice(0, 2).toLowerCase();
  const matching = all.filter((v) => (v.lang || '').toLowerCase().startsWith(base));
  return rankVoices(matching.length ? matching : all, lang);
}

export function setVoiceURI(uri) {
  preferredVoiceURI = uri || null;
  chosenVoice = pickVoice();
  return chosenVoice;
}

export function currentVoice() {
  return chosenVoice;
}

let preferredVoiceURI = null;

function pickVoice() {
  if (!speechSupported()) return null;
  const voices = synth().getVoices();
  if (!voices.length) return null;               // not loaded yet
  if (preferredVoiceURI) {
    const saved = voices.find((v) => v.voiceURI === preferredVoiceURI);
    if (saved) return saved;
  }
  return listVoices()[0] || voices[0] || null;
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
  // Slower and slightly lower than conversational. Guidance is meant to be
  // followed, not listened to, and an unhurried delivery is most of what makes
  // a synthetic voice sound soothing rather than brisk.
  utterance.rate = 0.78;
  utterance.pitch = 0.92;
  // The slider governs ambience; guidance needs to stay audible above it,
  // unless the slider is all the way down and silence is clearly the intent.
  utterance.volume = volume <= 0.02 ? 0 : Math.max(0.6, volume);

  duckBed();

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
