import assert from 'node:assert';

const insights = await import('../js/insights.js');

const at = (daysAgo, hour, { cycles = 10, seconds = 300, minutes = seconds / 60 } = {}) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return { start: d.toISOString(), seconds, minutes, cycles };
};

/* 1. Lifetime breaths ----------------------------------------------------- */
{
  assert.equal(insights.lifetimeBreaths([]), 0, 'no sessions, no breaths');
  assert.equal(insights.lifetimeBreaths([at(0, 9, { cycles: 12 }), at(1, 9, { cycles: 30 })]), 42);

  // Legacy records from the single-file version carry no cycle count. They must
  // contribute zero, never NaN — one bad record would poison the whole total.
  const withLegacy = [at(0, 9, { cycles: 12 }), { start: at(2, 9).start, seconds: 300, minutes: 5, cycles: null }];
  assert.equal(insights.lifetimeBreaths(withLegacy), 12);
  assert.ok(Number.isFinite(insights.lifetimeBreaths(withLegacy)));
  console.log('✓ lifetime breaths ignores legacy records without a cycle count');
}

/* 2. Pace is aggregated per day and weighted by session length ------------ */
{
  // Two sessions the same day: 10 breaths in 5 min, then 30 breaths in 15 min.
  // Weighted pace is 40 / 20 = 2.0, not the unweighted mean of 2 and 2.
  const series = insights.paceSeries([
    at(3, 7, { cycles: 10, seconds: 300 }),
    at(3, 20, { cycles: 30, seconds: 900 }),
  ]);
  assert.equal(series.length, 1, 'both sessions collapse into one day');
  assert.equal(series[0].bpm, 2, `expected 2.0 bpm, got ${series[0].bpm}`);
  assert.equal(series[0].minutes, 20);

  // A long slow session must outweigh a short fast one on the same day.
  const mixed = insights.paceSeries([
    at(2, 7, { cycles: 12, seconds: 120 }),   // 6.0 bpm for 2 minutes
    at(2, 21, { cycles: 30, seconds: 1080 }), // 1.67 bpm for 18 minutes
  ]);
  const unweightedMean = (6 + 30 / 18) / 2;
  assert.ok(mixed[0].bpm < unweightedMean,
    `weighted ${mixed[0].bpm} should sit below the unweighted mean ${unweightedMean}`);
  assert.equal(Math.round(mixed[0].bpm * 100) / 100, 2.1);
  console.log('✓ daily pace is weighted by session length, not a flat average');
}

/* 3. Unusable records never reach the chart ------------------------------- */
{
  const series = insights.paceSeries([
    { start: at(1, 9).start, seconds: 300, minutes: 5, cycles: null },   // legacy
    { start: at(2, 9).start, seconds: 0, minutes: 0, cycles: 4 },        // zero length
    { start: at(3, 9).start, seconds: 300, minutes: 5, cycles: 0 },      // no cycles
    at(4, 9, { cycles: 15, seconds: 300 }),                              // good
  ]);
  assert.equal(series.length, 1, 'only the usable record is plotted');
  assert.equal(series[0].bpm, 3);
  series.forEach((p) => assert.ok(Number.isFinite(p.bpm), 'no NaN or Infinity in the series'));
  console.log('✓ zero-length and cycle-less records are dropped, not divided by');
}

/* 4. Series is chronological and capped ----------------------------------- */
{
  const many = Array.from({ length: 50 }, (_, i) => at(49 - i, 9, { cycles: 10 + i }));
  const series = insights.paceSeries(many, 30);
  assert.equal(series.length, 30, 'capped to the requested window');
  for (let i = 1; i < series.length; i += 1) {
    assert.ok(series[i].date >= series[i - 1].date, 'ascending by date');
  }
  // The cap keeps the most recent days, not the oldest.
  assert.equal(series.at(-1).key, insights.dayKey(new Date()));
  console.log('✓ pace series is chronological and keeps the most recent 30 days');
}

/* 5. Trend compares thirds, not single days ------------------------------- */
{
  const slowing = insights.paceSeries([
    at(9, 9, { cycles: 60, seconds: 600 }), at(8, 9, { cycles: 58, seconds: 600 }),
    at(7, 9, { cycles: 55, seconds: 600 }), at(6, 9, { cycles: 50, seconds: 600 }),
    at(5, 9, { cycles: 44, seconds: 600 }), at(4, 9, { cycles: 40, seconds: 600 }),
  ]);
  const trend = insights.paceTrend(slowing);
  assert.ok(trend.slower, 'a falling line reads as slower');
  assert.ok(trend.to < trend.from);
  assert.ok(trend.percent > 20 && trend.percent < 40, `got ${trend.percent}%`);

  assert.equal(insights.paceTrend([]), null, 'no trend without data');
  assert.equal(insights.paceTrend(slowing.slice(0, 3)), null, 'too few days to call a trend');
  console.log('✓ trend needs four days and compares first third against last');
}

/* 6. Heatmap grid shape and bucketing ------------------------------------- */
{
  const grid = insights.heatmap([at(0, 9, { minutes: 25 }), at(8, 9, { minutes: 7 })], 13);
  assert.equal(grid.length, 13, 'thirteen weekly columns');
  grid.forEach((column) => assert.equal(column.length, 7, 'seven days per column'));

  const flat = grid.flat();
  const today = flat.find((day) => day.key === insights.dayKey(new Date()));
  assert.ok(today, 'today is inside the grid, never clipped off the edge');
  assert.equal(today.level, 4, '25 minutes is the top band');
  assert.equal(today.future, false);

  const eightDaysAgo = flat.find((d) => d.key === insights.dayKey(new Date(Date.now() - 8 * 864e5)));
  assert.equal(eightDaysAgo.level, 2, '7 minutes lands in the 5-10 band');

  const untouched = flat.filter((d) => d.minutes === 0 && !d.future);
  assert.ok(untouched.every((d) => d.level === 0), 'days without practice are level 0');
  // Days after today are marked so they can be left unpainted.
  assert.ok(flat.filter((d) => d.future).every((d) => d.minutes === 0));
  console.log('✓ heatmap is 13x7, includes today, and buckets minutes into five levels');
}

/* 7. Days are local, not UTC ---------------------------------------------- */
{
  // A late-evening session belongs to that evening, not to tomorrow in UTC.
  const late = new Date();
  late.setHours(23, 30, 0, 0);
  assert.equal(insights.dayKey(late), insights.dayKey(new Date()),
    '11:30pm is still today');
  const series = insights.paceSeries([
    { start: late.toISOString(), seconds: 300, minutes: 5, cycles: 15 },
  ]);
  assert.equal(series[0].key, insights.dayKey(new Date()));
  console.log('✓ an 11:30pm session counts as that evening, not the next UTC day');
}

/* 8. Rolling average tames the day-to-day zigzag -------------------------- */
{
  // Alternating patterns: ~6 bpm one day, ~3 bpm the next. Raw daily pace
  // swings hard; the rolling figure should sit between and move gently.
  const alternating = [];
  for (let d = 19; d >= 0; d -= 1) {
    alternating.push(at(d, 9, d % 2 === 0
      ? { cycles: 60, seconds: 600 }    // 6.0 bpm
      : { cycles: 30, seconds: 600 })); // 3.0 bpm
  }
  const series = insights.paceSeries(alternating);
  series.forEach((p) => assert.ok(Number.isFinite(p.rolling), 'every day carries a rolling value'));

  const swing = (pick) => {
    const tail = series.slice(insights.SMOOTHING_DAYS);
    let biggest = 0;
    for (let i = 1; i < tail.length; i += 1) biggest = Math.max(biggest, Math.abs(pick(tail[i]) - pick(tail[i - 1])));
    return biggest;
  };
  assert.ok(swing((p) => p.bpm) > 2.5, 'raw pace really does swing by 3 bpm');
  assert.ok(swing((p) => p.rolling) < 0.6,
    `rolling pace should barely move, swung by ${swing((p) => p.rolling).toFixed(2)}`);

  const settled = series.at(-1).rolling;
  assert.ok(settled > 4 && settled < 5, `rolling should sit between the two paces, got ${settled}`);
  console.log('\u2713 rolling average smooths a 3 bpm daily swing to under 0.6');
}

/* 9. Smoothing does not invent or hide a real trend ------------------------ */
{
  const steady = [];
  for (let d = 19; d >= 0; d -= 1) {
    // A genuine slowing: 6.0 bpm down to about 3.0 across twenty days.
    const bpm = 6 - (19 - d) * (3 / 19);
    steady.push(at(d, 9, { cycles: Math.round(bpm * 10), seconds: 600 }));
  }
  const series = insights.paceSeries(steady);
  assert.ok(series.at(-1).rolling < series[0].rolling, 'a real downward trend survives smoothing');
  const trend = insights.paceTrend(series);
  assert.ok(trend.slower && trend.percent > 15, `trend still reads as slower, got ${trend.percent.toFixed(0)}%`);

  const flat = insights.paceSeries(
    Array.from({ length: 12 }, (_, i) => at(11 - i, 9, { cycles: 40, seconds: 600 }))
  );
  assert.ok(Math.abs(insights.paceTrend(flat).delta) < 0.01, 'flat practice shows no invented trend');
  console.log('\u2713 smoothing preserves a real trend and invents none on flat data');
}

console.log('\nAll insights tests passed.');
