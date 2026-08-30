import assert from 'node:assert';

// display.js reads <html> at import time, so stand up just enough of it.
const attrs = new Map();
globalThis.document = {
  documentElement: {
    toggleAttribute(name, force) {
      const on = force ?? !attrs.has(name);
      if (on) attrs.set(name, ''); else attrs.delete(name);
      return on;
    },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    hasAttribute(name) { return attrs.has(name); },
  },
};

const display = await import('../js/display.js');
const sharecard = await import('../js/sharecard.js');

const at = (hour) => { const d = new Date(); d.setHours(hour, 30, 0, 0); return d; };

/* 1. Night mode scheduling ------------------------------------------------- */
{
  assert.equal(display.nightActive('on', at(9)), true, 'explicit on ignores the clock');
  assert.equal(display.nightActive('off', at(23)), false, 'explicit off ignores the clock');

  assert.equal(display.nightActive('auto', at(9)), false, 'morning is not night');
  assert.equal(display.nightActive('auto', at(19)), false, '7pm is still day');
  assert.equal(display.nightActive('auto', at(20)), true, '8pm starts night');
  assert.equal(display.nightActive('auto', at(23)), true);
  assert.equal(display.nightActive('auto', at(2)), true, 'after midnight is still night');
  assert.equal(display.nightActive('auto', at(5)), true);
  assert.equal(display.nightActive('auto', at(6)), false, '6am ends it');
  console.log('✓ auto night runs 8pm to 6am and wraps past midnight');
}

/* 2. Attributes reach the document ---------------------------------------- */
{
  attrs.clear();
  display.applyDisplay({ night: 'on', textSize: 'larger', contrast: true });
  assert.ok(document.documentElement.hasAttribute('data-night'));
  assert.equal(document.documentElement.getAttribute('data-text-size'), 'larger');
  assert.ok(document.documentElement.hasAttribute('data-contrast'));
  assert.equal(display.isNight(), true);

  display.applyDisplay({ night: 'off', textSize: 'normal', contrast: false });
  assert.ok(!document.documentElement.hasAttribute('data-night'), 'night attribute removed');
  assert.ok(!document.documentElement.hasAttribute('data-contrast'), 'contrast removed');
  assert.equal(document.documentElement.getAttribute('data-text-size'), 'normal');
  assert.equal(display.isNight(), false);

  // Defaults must not throw or leave stale attributes behind.
  display.applyDisplay({});
  assert.equal(document.documentElement.getAttribute('data-text-size'), 'normal');
  assert.ok(!document.documentElement.hasAttribute('data-contrast'));
  console.log('✓ display settings are applied and cleanly removed again');
}

/* 3. Weekly summary -------------------------------------------------------- */
{
  const day = (daysAgo, minutes, cycles, patternName) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(9, 0, 0, 0);
    return {
      start: d.toISOString(), seconds: minutes * 60, minutes, cycles, patternName,
    };
  };

  const sessions = [
    day(0, 10, 32, 'Coherent Breathing'),
    day(1, 5, 16, 'Box Breathing'),
    day(1, 5, 16, 'Box Breathing'),
    day(6, 15, 47, 'Coherent Breathing'),
    day(30, 20, 60, '4-7-8 Relaxing Breath'),   // outside the window
  ];

  const summary = sharecard.summarise(sessions, 7);
  assert.equal(summary.sessions, 4, 'the 30-day-old session is excluded');
  assert.equal(summary.minutes, 35);
  assert.equal(summary.breaths, 111);
  assert.equal(summary.daysPractised, 3, 'two sessions on one day count once');
  assert.deepEqual(summary.topPatterns[0], ['Coherent Breathing', 25], 'ranked by minutes');
  assert.equal(summary.topPatterns.length, 2);
  console.log('✓ weekly summary windows correctly and ranks patterns by time');
}

/* 4. Summary survives an empty or sparse history --------------------------- */
{
  const empty = sharecard.summarise([], 7);
  assert.equal(empty.sessions, 0);
  assert.equal(empty.minutes, 0);
  assert.equal(empty.breaths, 0);
  assert.deepEqual(empty.topPatterns, []);

  // Legacy records without a cycle count must not produce NaN on the card.
  const legacy = sharecard.summarise([
    { start: new Date().toISOString(), seconds: 300, minutes: 5, cycles: null, patternName: 'Old' },
  ], 7);
  assert.equal(legacy.breaths, 0);
  assert.ok(Number.isFinite(legacy.minutes));
  console.log('✓ an empty or legacy-only history still renders sane numbers');
}

console.log('\nAll display tests passed.');
