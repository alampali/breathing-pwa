import assert from 'node:assert';

const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const store = await import('../js/storage.js');

const session = (id, daysAgo, extra = {}) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(9, 0, 0, 0);
  return {
    id,
    start: d.toISOString(),
    end: new Date(d.getTime() + 300000).toISOString(),
    seconds: 300,
    minutes: 5,
    patternId: 'box',
    patternName: 'Box Breathing',
    timing: '4-4-4-4',
    cycles: 18,
    completed: true,
    source: 'Calm Breathing PWA',
    syncedToHealth: false,
    ...extra,
  };
};

/* 1. A round trip through export and back ---------------------------------- */
{
  backing.clear();
  store.addSession(session('a', 3));
  store.addSession(session('b', 2));
  const backup = store.toJson();

  backing.clear();                                    // a brand new device
  const result = store.importSessions(backup);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.invalid, 0);
  assert.equal(store.getSessions().length, 2);
  assert.equal(store.getSessions()[0].patternName, 'Box Breathing');
  console.log('✓ an exported backup restores onto an empty device');
}

/* 2. Importing twice is harmless ------------------------------------------- */
{
  backing.clear();
  store.addSession(session('a', 3));
  const backup = store.toJson();
  const first = store.importSessions(backup);
  const second = store.importSessions(backup);
  assert.equal(first.added, 0, 'already present');
  assert.equal(first.skipped, 1);
  assert.equal(second.skipped, 1);
  assert.equal(store.getSessions().length, 1, 'never duplicated');
  console.log('✓ importing the same file twice adds nothing');
}

/* 3. Merging is additive, never destructive -------------------------------- */
{
  backing.clear();
  store.addSession(session('local', 1));
  const other = JSON.stringify([session('remote', 5), session('local2', 4)]);
  const result = store.importSessions(other);
  assert.equal(result.added, 2);
  const ids = store.getSessions().map((s) => s.id);
  assert.ok(ids.includes('local'), 'existing sessions survive an import');
  assert.deepEqual(ids, ['remote', 'local2', 'local'], 'merged result is sorted by start');
  console.log('✓ import merges alongside existing history, sorted by date');
}

/* 4. Same session under a different id is still caught --------------------- */
{
  backing.clear();
  store.addSession(session('original-id', 2));
  const renamed = JSON.stringify([session('different-id', 2)]);   // same timestamp
  const result = store.importSessions(renamed);
  assert.equal(result.added, 0, 'matched on start when the id differs');
  assert.equal(result.skipped, 1);
  console.log('✓ a re-identified duplicate is matched on its timestamp');
}

/* 5. Junk is rejected without taking the history down ---------------------- */
{
  backing.clear();
  store.addSession(session('keep', 1));

  assert.ok(store.importSessions('not json at all').error, 'invalid JSON reports an error');
  assert.ok(store.importSessions('{"not":"an array"}').error, 'an object is not a session list');
  assert.equal(store.getSessions().length, 1, 'history untouched by a bad file');

  const mixed = JSON.stringify([
    session('good', 6),
    { start: 'nonsense', seconds: 300 },        // unparseable date
    { seconds: 300, minutes: 5 },               // no start at all
    { start: new Date().toISOString(), seconds: 0, minutes: 0 },   // zero length
    null,
    'a string',
  ]);
  const result = store.importSessions(mixed);
  assert.equal(result.added, 1, 'only the good record lands');
  assert.equal(result.invalid, 5);
  assert.equal(store.getSessions().length, 2);
  console.log('✓ malformed records are counted and skipped, history intact');
}

/* 6. Sparse records are repaired where it is safe -------------------------- */
{
  backing.clear();
  const start = new Date();
  start.setDate(start.getDate() - 1);
  const sparse = JSON.stringify([{ start: start.toISOString(), minutes: 5 }]);
  const result = store.importSessions(sparse);
  assert.equal(result.added, 1);

  const [record] = store.getSessions();
  assert.equal(record.seconds, 300, 'seconds derived from minutes');
  assert.equal(new Date(record.end) - new Date(record.start), 300000, 'end derived from length');
  assert.equal(record.cycles, null, 'unknown cycle count stays null, not zero');
  assert.equal(record.patternName, 'Imported session');
  assert.equal(record.syncedToHealth, false, 'never assume it reached Health');
  assert.ok(record.id, 'given a stable id');
  console.log('✓ a minimal record is filled in without inventing a cycle count');
}

/* 7. Imported sessions flow into stats and Health ------------------------- */
{
  backing.clear();
  const today = new Date(); today.setHours(9, 0, 0, 0);
  store.importSessions(JSON.stringify([
    { ...session('x', 0), cycles: 20 },
    { ...session('y', 1), cycles: 10 },
  ]));
  const stats = store.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.totalMinutes, 10);
  assert.equal(stats.streak, 2, 'imported days count towards the streak');

  const health = await import('../js/health.js');
  assert.equal(health.pendingSessions().length, 2, 'imported sessions queue for Health');
  console.log('✓ imported history feeds stats, streaks and the Health queue');
}

console.log('\nAll import tests passed.');
