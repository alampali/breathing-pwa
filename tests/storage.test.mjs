import assert from 'node:assert';

const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const store = await import('../js/storage.js');
const health = await import('../js/health.js');

const iso = (daysAgo, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/* 1. Legacy logs from the original single-file version are imported ------- */
{
  backing.clear();
  backing.set('breathingSessionLogs', JSON.stringify([
    { start: iso(5), end: iso(5), minutes: 5, seconds: 300, pattern: '4-7-8', source: 'Calm 4-7-8 HTML' },
  ]));
  const sessions = store.getSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].patternName, '4-7-8 Relaxing Breath');
  assert.equal(sessions[0].minutes, 5);
  assert.equal(sessions[0].syncedToHealth, false);
  assert.equal(backing.get('breathingSessionLogs'), undefined, 'legacy key removed after import');
  assert.equal(store.getSessions().length, 1, 'importing twice must not duplicate');
  console.log('✓ old 4-7-8 logs are migrated once, not duplicated');
}

/* 2. Streaks -------------------------------------------------------------- */
{
  backing.clear();
  [0, 1, 2, 5].forEach((d) => store.addSession({
    start: iso(d), end: iso(d), seconds: 300, minutes: 5,
    patternId: 'box', patternName: 'Box Breathing', timing: '4-4-4-4', cycles: 18, completed: true,
  }));
  const stats = store.getStats();
  assert.equal(stats.streak, 3, `today + 2 prior days = 3, got ${stats.streak}`);
  assert.equal(stats.count, 4);
  assert.equal(stats.totalMinutes, 20);
  assert.equal(stats.todayMinutes, 5);
  assert.equal(stats.daysPractised, 4);
  console.log('✓ streak counts back from today and stops at the gap');
}

/* 3. A streak survives "not yet today" ------------------------------------ */
{
  backing.clear();
  [1, 2, 3].forEach((d) => store.addSession({
    start: iso(d), end: iso(d), seconds: 300, minutes: 5,
    patternId: '478', patternName: '4-7-8 Relaxing Breath', timing: '4-7-8', cycles: 15, completed: true,
  }));
  assert.equal(store.getStats().streak, 3, 'yesterday-anchored streak stays alive');
  assert.equal(store.getStats().todayMinutes, 0);
  console.log('✓ streak survives a day you have not practised yet');
}

/* 4. CSV escaping and shape ---------------------------------------------- */
{
  backing.clear();
  store.addSession({
    start: iso(0), end: iso(0), seconds: 300, minutes: 5,
    patternId: 'custom', patternName: 'My "quiet" pattern', timing: '4-2-6', cycles: 25, completed: false,
  });
  const csv = store.toCsv();
  const [header, row] = csv.split('\n');
  assert.equal(header.split(',').length, 10);
  assert.ok(row.includes('"My ""quiet"" pattern"'), 'quotes doubled, not broken');
  assert.equal(row.split('","').length, 10, 'ten quoted fields, no stray commas');
  assert.ok(row.includes('"Mindfulness"'), 'activity column for Health import');
  assert.ok(row.includes('"no"'), 'incomplete session flagged');
  console.log('✓ CSV escapes quotes and keeps ten columns');
}

/* 5. Health sync flags ---------------------------------------------------- */
{
  backing.clear();
  [0, 1].forEach((d) => store.addSession({
    start: iso(d), end: iso(d), seconds: 300, minutes: 5,
    patternId: '478', patternName: '4-7-8 Relaxing Breath', timing: '4-7-8', cycles: 15, completed: true,
  }));
  assert.equal(health.pendingSessions().length, 2);
  const payload = health.healthPayload();
  assert.deepEqual(Object.keys(payload[0]).sort(), ['end', 'id', 'minutes', 'start']);

  // A paused session's wall-clock end runs long; Health must get the practised
  // span, or the pause is credited as mindfulness.
  backing.clear();
  const start = iso(0, 6);
  store.addSession({
    start,
    end: new Date(new Date(start).getTime() + 20 * 60000).toISOString(), // 15 min pause
    seconds: 300, minutes: 5,
    patternId: '478', patternName: '4-7-8 Relaxing Breath', timing: '4-7-8', cycles: 15, completed: true,
  });
  const paused = health.healthPayload()[0];
  const span = (new Date(paused.end) - new Date(paused.start)) / 60000;
  assert.equal(span, 5, `Health span must be the 5 practised minutes, got ${span}`);
  assert.equal(store.getSessions()[0].end, new Date(new Date(start).getTime() + 20 * 60000).toISOString(),
    'the stored record keeps its real wall-clock end');
  console.log('✓ a 15-minute pause is not credited as mindful minutes');

  backing.clear();
  [0, 1].forEach((d) => store.addSession({
    start: iso(d), end: iso(d), seconds: 300, minutes: 5,
    patternId: '478', patternName: '4-7-8 Relaxing Breath', timing: '4-7-8', cycles: 15, completed: true,
  }));
  const ids = health.healthPayload().map((p) => p.id);
  health.confirmSynced([ids[0]]);
  assert.equal(health.pendingSessions().length, 1, 'only the confirmed one is marked');

  store.addSession({
    start: iso(0, 18), end: iso(0, 18), seconds: 120, minutes: 2,
    patternId: 'box', patternName: 'Box Breathing', timing: '4-4-4-4', cycles: 7, completed: true,
  });
  assert.equal(health.pendingSessions().length, 2, 'new sessions queue up again');
  console.log('✓ only confirmed sessions are marked as sent to Health');
}

/* 6. Prefs and custom pattern round-trip ---------------------------------- */
{
  backing.clear();
  assert.equal(store.getPrefs().patternId, '478', 'sane default');
  store.setPrefs({ soundscape: 'rain', volume: 0.3 });
  const prefs = store.getPrefs();
  assert.equal(prefs.soundscape, 'rain');
  assert.equal(prefs.volume, 0.3);
  assert.equal(prefs.chime, true, 'untouched prefs keep their defaults');

  const custom = { steps: [{ kind: 'inhale', seconds: 6 }, { kind: 'exhale', seconds: 6 }] };
  store.setCustomPattern(custom);
  const loaded = store.getCustomPattern({ id: 'custom', name: 'Custom', steps: [] });
  assert.equal(loaded.steps[0].seconds, 6);
  assert.equal(loaded.name, 'Custom', 'falls back for fields it does not store');
  console.log('✓ prefs merge over defaults and the custom pattern round-trips');
}

/* 7. Corrupt storage does not take the app down --------------------------- */
{
  backing.clear();
  backing.set('cb.sessions.v2', '{not json');
  backing.set('cb.prefs.v1', 'garbage');
  assert.deepEqual(store.getSessions(), []);
  assert.equal(store.getPrefs().patternId, '478');
  assert.equal(store.getStats().streak, 0);
  console.log('✓ corrupt localStorage falls back to empty rather than throwing');
}

console.log('\nAll storage tests passed.');
