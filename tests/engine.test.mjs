// Drives the real engine with a fake clock and a fake rAF.
import assert from 'node:assert';

let now = 0;
let queued = [];
globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = (fn) => { queued.push(fn); return queued.length; };
globalThis.cancelAnimationFrame = () => { queued = []; };

// Advance the clock in ~16ms steps, flushing frames as a browser would.
function advance(seconds) {
  const end = now + seconds * 1000;
  while (now < end) {
    now = Math.min(now + 16, end);
    const batch = queued;
    queued = [];
    batch.forEach((fn) => fn(now));
  }
}

const { createEngine } = await import('../js/engine.js');
const { PATTERNS, findPattern, cycleSeconds } = await import('../js/patterns.js');

function run({ pattern, mode, durationSec, cycleTarget, advanceBy }) {
  const phases = [];
  const ticks = [];
  let done = null;
  const t0 = now; // the clock is shared across blocks; measure relative to here
  const engine = createEngine({
    onTick: (t) => ticks.push(t),
    onPhaseChange: (p) => phases.push({ label: p.step.label, cycle: p.cycleIndex, at: (now - t0) / 1000 }),
    onComplete: (r) => { done = r; },
  });
  engine.start({ pattern, mode, durationSec, cycleTarget });
  advance(advanceBy);
  return { engine, phases, ticks, done };
}

/* 1. Lead-in countdown runs before any breathing ------------------------- */
{
  const p478 = findPattern('478');
  const { phases, ticks } = run({ pattern: p478, mode: 'time', durationSec: 300, advanceBy: 2 });
  assert.equal(phases.length, 0, 'no breath phase during the 3s lead-in');
  assert.ok(ticks.every((t) => t.state === 'preparing'));
  assert.deepEqual([...new Set(ticks.map((t) => t.countdown))].sort(), [1, 2, 3]);
  console.log('✓ lead-in countdown 3→1 before breathing starts');
}

/* 2. 4-7-8 phase sequence and timing ------------------------------------- */
{
  const p478 = findPattern('478');
  const { phases } = run({ pattern: p478, mode: 'time', durationSec: 300, advanceBy: 3 + 19 * 2 + 0.5 });
  const labels = phases.map((p) => p.label);
  assert.deepEqual(labels.slice(0, 6),
    ['Breathe In', 'Hold', 'Breathe Out', 'Breathe In', 'Hold', 'Breathe Out']);
  // Offsets measured from the end of the 3s lead-in.
  const offsets = phases.map((p) => Math.round((p.at - 3) * 10) / 10);
  assert.deepEqual(offsets.slice(0, 6), [0, 4, 11, 19, 23, 30], `got ${offsets}`);
  assert.deepEqual(phases.map((p) => p.cycle).slice(0, 6), [0, 0, 0, 1, 1, 1]);
  console.log('✓ 4-7-8 steps fire at 0/4/11s and the cycle counter advances');
}

/* 3. Circle fullness tracks the breath ----------------------------------- */
{
  const p478 = findPattern('478');
  const { ticks } = run({ pattern: p478, mode: 'time', durationSec: 300, advanceBy: 3 + 19 });
  const breath = ticks.filter((t) => t.state === 'running');
  const at = (s) => breath.find((t) => t.elapsed >= s);
  assert.ok(at(0.1).fullness < 0.1, 'starts empty');
  assert.ok(Math.abs(at(2).fullness - 0.5) < 0.05, 'half full mid-inhale');
  assert.ok(at(3.9).fullness > 0.98, 'full at the top of the inhale');
  assert.ok(at(8).fullness > 0.99, 'stays full through the hold');
  assert.ok(Math.abs(at(15).fullness - 0.5) < 0.08, 'half empty mid-exhale');
  assert.ok(at(18.9).fullness < 0.02, 'empty at the end of the exhale');
  console.log('✓ fullness rises over 4s, holds 7s, falls over 8s');
}

/* 4. Time-mode session ends on time and reports what was practised ------- */
{
  const p478 = findPattern('478');
  const { done } = run({ pattern: p478, mode: 'time', durationSec: 60, advanceBy: 3 + 61 });
  assert.ok(done, 'completed');
  assert.equal(done.completed, true);
  assert.equal(done.seconds, 60, `got ${done.seconds}`);
  assert.equal(done.cycles, 3, `60s / 19s = 3 whole cycles, got ${done.cycles}`);
  console.log('✓ time mode stops at exactly 60s after a 3s lead-in');
}

/* 5. Breath-count mode stops on the right breath ------------------------- */
{
  const box = findPattern('box');
  assert.equal(cycleSeconds(box), 16);
  const { done } = run({ pattern: box, mode: 'cycles', cycleTarget: 4, advanceBy: 3 + 70 });
  assert.equal(done.completed, true);
  assert.equal(done.cycles, 4);
  assert.equal(done.seconds, 64, `4 × 16s, got ${done.seconds}`);
  console.log('✓ box breathing for 4 breaths stops at 64s');
}

/* 6. Pause freezes the clock --------------------------------------------- */
{
  const p478 = findPattern('478');
  const { engine, ticks } = run({ pattern: p478, mode: 'time', durationSec: 300, advanceBy: 3 + 5 });
  const before = ticks.at(-1).elapsed;
  engine.pause();
  advance(30);
  engine.resume();
  advance(2);
  const after = ticks.at(-1).elapsed;
  assert.ok(Math.abs(after - before - 2) < 0.1, `30s paused must not count; ${before} → ${after}`);
  console.log('✓ 30s of pause adds nothing to the session clock');
}

/* 7. Stopping early still reports the partial session -------------------- */
{
  const p478 = findPattern('478');
  const { engine } = run({ pattern: p478, mode: 'time', durationSec: 300, advanceBy: 3 + 45 });
  let result = null;
  engine.stop();
  // onComplete already captured by run(); re-check via a fresh engine instead.
  const second = createEngine({ onComplete: (r) => { result = r; } });
  second.start({ pattern: p478, mode: 'time', durationSec: 300 });
  advance(3 + 45);
  second.stop();
  assert.equal(result.completed, false);
  assert.equal(result.aborted, false);
  assert.equal(result.seconds, 45);
  console.log('✓ stopping at 45s reports 45s, flagged as not completed');
}

/* 8. Quitting during the lead-in logs nothing ---------------------------- */
{
  const p478 = findPattern('478');
  let result = null;
  const engine = createEngine({ onComplete: (r) => { result = r; } });
  engine.start({ pattern: p478, mode: 'time', durationSec: 300 });
  advance(1.5);
  engine.stop();
  assert.equal(result.aborted, true, 'lead-in only → nothing practised');
  assert.equal(result.seconds, 0);
  console.log('✓ quitting during the lead-in is not logged');
}

/* 9. Physiological sigh: stacked inhales climb, they do not reset -------- */
{
  const sigh = findPattern('sigh');
  const { ticks, phases } = run({ pattern: sigh, mode: 'time', durationSec: 300, advanceBy: 3 + 10 });
  const breath = ticks.filter((t) => t.state === 'running');
  const at = (s) => breath.find((t) => t.elapsed >= s);
  assert.deepEqual(phases.slice(0, 4).map((p) => p.label),
    ['Breathe In', 'Breathe In', 'Breathe Out', 'Hold Empty']);
  assert.ok(Math.abs(at(1.99).fullness - 0.68) < 0.02, 'first inhale tops out at 68%');
  assert.ok(at(2.5).fullness > 0.68, 'second inhale continues upward');
  assert.ok(at(2.99).fullness > 0.98, 'reaches full');
  console.log('✓ physiological sigh stacks two inhales without dropping back');
}

/* 10. Every shipped pattern is coherent ---------------------------------- */
{
  for (const pattern of PATTERNS) {
    const length = cycleSeconds(pattern);
    assert.ok(length > 0 && length < 60, `${pattern.id} cycle length ${length}`);
    const { done } = run({ pattern, mode: 'cycles', cycleTarget: 2, advanceBy: 3 + length * 2 + 1 });
    assert.equal(done.cycles, 2, `${pattern.id} should complete 2 cycles`);
  }
  console.log(`✓ all ${PATTERNS.length} patterns complete 2 full cycles cleanly`);
}

console.log('\nAll engine tests passed.');
