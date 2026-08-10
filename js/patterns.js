// Breathing pattern library.
//
// A pattern is a list of steps. Each step has a `kind` (used for wording, icon
// and cue sound) and a duration in seconds. Durations may be fractional.
//
// `from` / `to` describe lung "fullness" on a 0..1 scale over the step. They are
// derived from `kind` unless a pattern needs something unusual (the
// physiological sigh stacks two inhales, so the second starts part-way up).

export const PHASE_META = {
  inhale:  { label: 'Breathe In',  sub: 'Inhale gently through your nose',   icon: '🌊', from: 0, to: 1 },
  hold:    { label: 'Hold',        sub: 'Stay relaxed, no strain',           icon: '✨', from: 1, to: 1 },
  exhale:  { label: 'Breathe Out', sub: 'Exhale slowly and completely',      icon: '🍃', from: 1, to: 0 },
  holdOut: { label: 'Hold Empty',  sub: 'Rest at the bottom of the breath',  icon: '🌙', from: 0, to: 0 },
};

export const PATTERNS = [
  {
    id: '478',
    name: '4-7-8 Relaxing Breath',
    tagline: 'Long exhale to wind down',
    note: 'The extended out-breath is the active ingredient. Best before sleep.',
    steps: [
      { kind: 'inhale', seconds: 4 },
      { kind: 'hold',   seconds: 7 },
      { kind: 'exhale', seconds: 8 },
    ],
  },
  {
    id: 'box',
    name: 'Box Breathing',
    tagline: 'Four equal sides, 4-4-4-4',
    note: 'Even and square. Good for steadying yourself before something demanding.',
    steps: [
      { kind: 'inhale',  seconds: 4 },
      { kind: 'hold',    seconds: 4 },
      { kind: 'exhale',  seconds: 4 },
      { kind: 'holdOut', seconds: 4 },
    ],
  },
  {
    id: 'coherent',
    name: 'Coherent Breathing',
    tagline: 'Resonant pace, about 5.5 breaths a minute',
    note: 'No holds — a smooth, continuous wave. Comfortable to sustain for a long session.',
    steps: [
      { kind: 'inhale', seconds: 5.5 },
      { kind: 'exhale', seconds: 5.5 },
    ],
  },
  {
    id: 'calm46',
    name: 'Extended Exhale',
    tagline: 'In for 4, out for 6',
    note: 'The gentlest option here. Nothing to hold, just a longer out-breath than in-breath.',
    steps: [
      { kind: 'inhale', seconds: 4 },
      { kind: 'exhale', seconds: 6 },
    ],
  },
  {
    id: 'triangle',
    name: 'Triangle Breathing',
    tagline: 'Three equal sides, 4-4-4',
    note: 'Box breathing without the empty hold. A softer way into holds.',
    steps: [
      { kind: 'inhale', seconds: 4 },
      { kind: 'hold',   seconds: 4 },
      { kind: 'exhale', seconds: 4 },
    ],
  },
  {
    id: 'sigh',
    name: 'Physiological Sigh',
    tagline: 'Double inhale, long release',
    note: 'A short top-up breath on top of a full one, then a long sigh out. Fast reset — a couple of rounds is often enough.',
    steps: [
      { kind: 'inhale', seconds: 2,   to: 0.68 },
      { kind: 'inhale', seconds: 1,   from: 0.68, to: 1 },
      { kind: 'exhale', seconds: 6 },
      { kind: 'holdOut', seconds: 1 },
    ],
  },
];

export const CUSTOM_ID = 'custom';

export const DEFAULT_CUSTOM = {
  id: CUSTOM_ID,
  name: 'Custom',
  tagline: 'Your own timing',
  note: 'Set any timing you like. Leave a step at 0 to skip it.',
  custom: true,
  steps: [
    { kind: 'inhale',  seconds: 4 },
    { kind: 'hold',    seconds: 2 },
    { kind: 'exhale',  seconds: 6 },
    { kind: 'holdOut', seconds: 0 },
  ],
};

/** Steps with zero duration removed and from/to fullness resolved. */
export function resolveSteps(pattern) {
  return pattern.steps
    .filter((step) => step.seconds > 0)
    .map((step) => {
      const meta = PHASE_META[step.kind];
      return {
        ...meta,
        ...step,
        from: step.from ?? meta.from,
        to: step.to ?? meta.to,
      };
    });
}

export function cycleSeconds(pattern) {
  return resolveSteps(pattern).reduce((total, step) => total + step.seconds, 0);
}

/** Compact timing label, e.g. "4-7-8". */
export function timingLabel(pattern) {
  return resolveSteps(pattern)
    .map((step) => (Number.isInteger(step.seconds) ? step.seconds : step.seconds.toFixed(1)))
    .join('-');
}

export function breathsPerMinute(pattern) {
  const len = cycleSeconds(pattern);
  return len > 0 ? 60 / len : 0;
}

export function findPattern(id, customPattern) {
  if (id === CUSTOM_ID) return customPattern;
  return PATTERNS.find((pattern) => pattern.id === id) || PATTERNS[0];
}
