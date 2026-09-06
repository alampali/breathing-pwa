import assert from 'node:assert';

// audio.js touches window/navigator at import time; stand up just enough.
globalThis.window = { matchMedia: () => ({ matches: false }) };
// Node exposes navigator as a read-only getter, so replace the property.
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'en-US', userAgent: 'node' }, configurable: true,
});
globalThis.document = { documentElement: { hasAttribute: () => false } };

const audio = await import('../js/audio.js');

const voice = (name, lang, { localService = true, def = false } = {}) => ({
  name, lang, localService, default: def, voiceURI: `${name}-${lang}`,
});

/* 1. Language comes first ------------------------------------------------- */
{
  const ranked = audio.rankVoices([
    voice('Thomas', 'fr-FR'),
    voice('Google Deutsch', 'de-DE'),
    voice('Daniel', 'en-GB'),
    voice('Samantha', 'en-US'),
  ], 'en-US');

  assert.equal(ranked[0].name, 'Samantha', 'exact language match wins');
  assert.equal(ranked[1].name, 'Daniel', 'same base language comes next');
  assert.ok(['Thomas', 'Google Deutsch'].includes(ranked[2].name), 'other languages sink');
  console.log('✓ voices in the wrong language rank below every English one');
}

/* 2. Quality tiers beat the compact defaults ------------------------------ */
{
  const ranked = audio.rankVoices([
    voice('Alex', 'en-US', { def: true }),
    voice('Samantha (Enhanced)', 'en-US'),
  ], 'en-US');
  assert.match(ranked[0].name, /Enhanced/, 'enhanced beats a plain default');

  const premium = audio.rankVoices([
    voice('Nicky', 'en-US'),
    voice('Ava (Premium)', 'en-US'),
  ], 'en-US');
  assert.match(premium[0].name, /Premium/);
  console.log('✓ Enhanced and Premium voices outrank the compact ones');
}

/* 3. Known-warm names break the tie --------------------------------------- */
{
  const ranked = audio.rankVoices([
    voice('Albert', 'en-US'),
    voice('Bad News', 'en-US'),
    voice('Samantha', 'en-US'),
  ], 'en-US');
  assert.equal(ranked[0].name, 'Samantha', 'a known-good name is preferred');

  // Ava is listed ahead of Karen, so it should win a straight fight.
  const pair = audio.rankVoices([voice('Karen', 'en-AU'), voice('Ava', 'en-US')], 'en-US');
  assert.equal(pair[0].name, 'Ava');
  console.log('✓ the preferred-name list breaks ties between similar voices');
}

/* 4. Ranking is total and never drops or duplicates a voice ---------------- */
{
  const input = [
    voice('Alex', 'en-US'), voice('Daniel', 'en-GB'),
    voice('Thomas', 'fr-FR'), voice('Ava (Premium)', 'en-US'),
  ];
  const ranked = audio.rankVoices(input, 'en-US');
  assert.equal(ranked.length, input.length, 'nothing is lost');
  assert.equal(new Set(ranked.map((v) => v.voiceURI)).size, input.length, 'nothing duplicated');

  assert.deepEqual(audio.rankVoices([], 'en-US'), [], 'an empty list is fine');

  // Missing fields must not throw — some engines report sparse voice objects.
  const sparse = audio.rankVoices([{ name: undefined, lang: undefined, voiceURI: 'x' }], 'en-US');
  assert.equal(sparse.length, 1);
  console.log('✓ ranking is total, stable and survives sparse voice objects');
}

/* 5. Soundscape definitions ------------------------------------------------ */
{
  const flute = audio.findSoundscape('flute');
  assert.ok(flute, 'the flute soundscape exists');
  assert.equal(flute.src, './audio/flute.mp3');
  assert.ok(flute.fallback, 'it names a generated fallback for when the file is absent');
  assert.ok(audio.findSoundscape(flute.fallback), 'and that fallback is a real soundscape');
  assert.ok(flute.gain > 0 && flute.gain <= 1, 'with a sane gain');

  // Every generated soundscape must stay file-free, or offline breaks.
  ['ocean', 'rain', 'bowl'].forEach((id) => {
    assert.ok(!audio.findSoundscape(id).src, `${id} stays synthesised`);
  });
  assert.equal(audio.findSoundscape('nope'), null);
  console.log('✓ the flute is file-backed with a generated fallback; the rest stay synthesised');
}

/* 6. Novelty voices sink to the bottom ------------------------------------ */
{
  // macOS ships these joke voices; they were ranking directly under the good
  // one in the picker, which is not what you want in a meditation app.
  const ranked = audio.rankVoices([
    voice('Bad News', 'en-US'),
    voice('Bahh', 'en-US'),
    voice('Zarvox', 'en-US'),
    voice('Samantha', 'en-US'),
    voice('Nicky', 'en-US'),
  ], 'en-US');

  assert.equal(ranked[0].name, 'Samantha');
  assert.equal(ranked[1].name, 'Nicky', 'an ordinary voice outranks every novelty one');
  assert.deepEqual(ranked.slice(2).map((v) => v.name).sort(),
    ['Bad News', 'Bahh', 'Zarvox'], 'the joke voices land last');

  // Still offered, never removed: someone may genuinely want one.
  assert.equal(ranked.length, 5);

  // A quality suffix must not smuggle a novelty voice back up the list.
  const suffixed = audio.rankVoices([
    voice('Albert (Enhanced)', 'en-US'), voice('Karen', 'en-US'),
  ], 'en-US');
  assert.equal(suffixed[0].name, 'Karen', 'the base name still counts as novelty');
  console.log('\u2713 novelty voices sink below ordinary ones but stay selectable');
}

console.log('\nAll voice and soundscape tests passed.');
