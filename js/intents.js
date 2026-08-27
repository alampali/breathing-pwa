// "What do you need right now?"
//
// A newcomer's first question is not "4-7-8 or box breathing?" — it is closer to
// "I feel bad, help". These map a felt state onto a pattern and a length, so the
// choice can be made in the language someone already has.
//
// Nothing new happens underneath: each intent just picks an existing pattern and
// session length. The name of the pattern is shown afterwards, so the mapping
// teaches itself over a few uses.

export const INTENTS = [
  {
    id: 'sleep',
    label: "Can't sleep",
    icon: '🌙',
    patternId: '478',
    mode: 'time',
    durationSec: 600,
    because: 'A long exhale, ten minutes, to let you drift.',
  },
  {
    id: 'anxious',
    label: 'Wound up',
    icon: '🌊',
    patternId: 'sigh',
    mode: 'cycles',
    cycleTarget: 6,
    because: 'Six double-breaths. The fastest way down from a spike.',
  },
  {
    id: 'focus',
    label: 'Need to focus',
    icon: '🎯',
    patternId: 'box',
    mode: 'time',
    durationSec: 300,
    because: 'Five minutes of even, square breathing to steady you.',
  },
  {
    id: 'settle',
    label: 'Just settle me',
    icon: '🍃',
    patternId: 'coherent',
    mode: 'time',
    durationSec: 600,
    because: 'Ten unhurried minutes, nothing to hold.',
  },
];

export function findIntent(id) {
  return INTENTS.find((intent) => intent.id === id) || null;
}

/** The prefs an intent implies, ready to merge over the stored ones. */
export function prefsFor(intent) {
  return {
    patternId: intent.patternId,
    mode: intent.mode,
    ...(intent.mode === 'time'
      ? { durationSec: intent.durationSec }
      : { cycleTarget: intent.cycleTarget }),
  };
}
