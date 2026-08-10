// Session engine.
//
// Timing is derived from performance.now() on every animation frame rather than
// counted with setTimeout, so the clock cannot drift and the circle can be
// animated in proportion to the actual phase length (an 8s exhale takes 8s).

import { resolveSteps } from './patterns.js';

const PREPARE_SECONDS = 3;

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function createEngine({ onTick, onPhaseChange, onComplete }) {
  let steps = [];
  let cycleLength = 0;
  let mode = 'time';
  let target = 300;         // seconds, or cycles when mode === 'cycles'
  let pattern = null;

  let state = 'idle';       // idle | preparing | running | paused | finished
  let rafId = null;
  let lastFrame = 0;
  let elapsed = 0;          // seconds of breathing, excluding the lead-in
  let prepareLeft = 0;
  let startedAt = null;
  let lastStepKey = null;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const delta = Math.min((now - lastFrame) / 1000, 0.25); // clamp tab-switch gaps
    lastFrame = now;

    if (state === 'preparing') {
      prepareLeft -= delta;
      if (prepareLeft <= 0) {
        state = 'running';
        emit();
        return;
      }
      onTick?.({
        state,
        prepareLeft,
        countdown: Math.ceil(prepareLeft),
        fullness: 0,
        elapsed: 0,
        remaining: mode === 'time' ? target : null,
        cycleIndex: 0,
      });
      return;
    }

    if (state !== 'running') return;

    elapsed += delta;
    emit();

    const done = mode === 'time'
      ? elapsed >= target
      : Math.floor(elapsed / cycleLength) >= target;
    if (done) finish(true);
  }

  function positionAt(seconds) {
    const cycleIndex = Math.floor(seconds / cycleLength);
    let within = seconds % cycleLength;
    let index = 0;
    while (index < steps.length - 1 && within >= steps[index].seconds) {
      within -= steps[index].seconds;
      index += 1;
    }
    const step = steps[index];
    const progress = Math.min(within / step.seconds, 1);
    return {
      step,
      stepIndex: index,
      cycleIndex,
      stepElapsed: within,
      stepRemaining: Math.max(step.seconds - within, 0),
      fullness: step.from + (step.to - step.from) * easeInOutSine(progress),
      stepProgress: progress,
    };
  }

  function emit() {
    const position = positionAt(elapsed);
    const stepKey = `${position.cycleIndex}:${position.stepIndex}`;
    if (stepKey !== lastStepKey) {
      lastStepKey = stepKey;
      onPhaseChange?.(position);
    }
    onTick?.({
      state,
      ...position,
      elapsed,
      remaining: mode === 'time' ? Math.max(target - elapsed, 0) : null,
      cyclesRemaining: mode === 'cycles' ? Math.max(target - position.cycleIndex, 0) : null,
      sessionProgress: mode === 'time'
        ? Math.min(elapsed / target, 1)
        : Math.min(elapsed / (target * cycleLength), 1),
    });
  }

  function loop() {
    cancelAnimationFrame(rafId);
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function finish(completed) {
    if (state === 'idle' || state === 'finished') return;
    cancelAnimationFrame(rafId);
    rafId = null;
    const wasPreparing = state === 'preparing';
    state = 'finished';
    const seconds = Math.round(elapsed);
    onComplete?.({
      completed,
      seconds,
      cycles: cycleLength > 0 ? Math.floor(elapsed / cycleLength) : 0,
      startedAt,
      endedAt: new Date(),
      pattern,
      // Nothing was actually practised if we never left the lead-in.
      aborted: wasPreparing,
    });
  }

  return {
    get state() { return state; },
    get pattern() { return pattern; },

    start(config) {
      cancelAnimationFrame(rafId);
      pattern = config.pattern;
      steps = resolveSteps(pattern);
      cycleLength = steps.reduce((total, step) => total + step.seconds, 0);
      mode = config.mode;
      target = config.mode === 'time' ? config.durationSec : config.cycleTarget;
      elapsed = 0;
      lastStepKey = null;
      startedAt = new Date();
      prepareLeft = config.prepare === false ? 0 : PREPARE_SECONDS;
      state = prepareLeft > 0 ? 'preparing' : 'running';
      loop();
    },

    pause() {
      if (state !== 'running' && state !== 'preparing') return;
      cancelAnimationFrame(rafId);
      rafId = null;
      state = 'paused';
      onTick?.({ state, ...positionAt(elapsed), elapsed, remaining: mode === 'time' ? Math.max(target - elapsed, 0) : null });
    },

    resume() {
      if (state !== 'paused') return;
      state = 'running';
      loop();
    },

    /** Ends early and still reports what was practised, so it can be logged. */
    stop() {
      finish(false);
    },

    reset() {
      cancelAnimationFrame(rafId);
      rafId = null;
      state = 'idle';
      elapsed = 0;
      lastStepKey = null;
      startedAt = null;
    },
  };
}
