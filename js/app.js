import {
  PATTERNS, CUSTOM_ID, DEFAULT_CUSTOM,
  cycleSeconds, timingLabel, breathsPerMinute, findPattern, resolveSteps,
} from './patterns.js';
import * as store from './storage.js';
import * as audio from './audio.js';
import * as health from './health.js';
import { createEngine } from './engine.js';

const $ = (id) => document.getElementById(id);

const el = {
  patternSubtitle: $('patternSubtitle'),
  timer: $('timer'), timerLabel: $('timerLabel'),
  stepTimer: $('stepTimer'), cycleCount: $('cycleCount'),
  circle: $('circle'), icon: $('icon'), progressBar: $('progressBar'),
  phase: $('phase'), phaseSub: $('phaseSub'),
  mode: $('mode'), duration: $('duration'), cycleTarget: $('cycleTarget'),
  startBtn: $('startBtn'), pauseBtn: $('pauseBtn'), resetBtn: $('resetBtn'),
  patternList: $('patternList'), patternNote: $('patternNote'), patternMath: $('patternMath'),
  customCard: $('customCard'),
  soundRow: $('soundRow'), volume: $('volume'),
  logArea: $('logArea'), pendingBadge: $('pendingBadge'),
  toast: $('toast'),
};

const RING_CIRCUMFERENCE = 295.31;
const MIN_SCALE = 0.62;
const MAX_SCALE = 1.42;
const MIN_LOGGABLE_SECONDS = 20;

let prefs = store.getPrefs();
let customPattern = store.getCustomPattern(DEFAULT_CUSTOM);
let pattern = findPattern(prefs.patternId, customPattern);
let wakeLock = null;

/* ------------------------------------------------------------------ utils */

function mmss(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

function setScale(fullness) {
  el.circle.style.transform = `scale(${MIN_SCALE + (MAX_SCALE - MIN_SCALE) * fullness})`;
}

function setProgress(fraction) {
  el.progressBar.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - Math.min(Math.max(fraction, 0), 1)));
}

/* ----------------------------------------------------------- wake lock */

async function requestWakeLock() {
  if (!prefs.keepAwake || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null; // denied or unsupported — not worth surfacing
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/* ------------------------------------------------------------ pattern UI */

function allPatterns() {
  return [...PATTERNS, customPattern];
}

function renderPatterns() {
  el.patternList.innerHTML = '';
  allPatterns().forEach((item) => {
    const button = document.createElement('button');
    button.className = 'pattern';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(item.id === pattern.id));
    button.innerHTML = `
      <span class="pattern-name"></span>
      <span class="pattern-timing"></span>
      <span class="pattern-tag"></span>`;
    button.querySelector('.pattern-name').textContent = item.name;
    button.querySelector('.pattern-tag').textContent = item.tagline;
    button.querySelector('.pattern-timing').textContent = timingLabel(item) || '—';
    button.onclick = () => selectPattern(item.id);
    el.patternList.appendChild(button);
  });
}

function describePattern() {
  const length = cycleSeconds(pattern);
  const bpm = breathsPerMinute(pattern);
  el.patternSubtitle.textContent = `${pattern.name} · ${timingLabel(pattern) || 'not set'}`;
  el.patternNote.textContent = pattern.note || '';
  el.patternMath.textContent = length > 0
    ? `One full breath takes ${length % 1 === 0 ? length : length.toFixed(1)} seconds — about ${bpm.toFixed(1)} breaths per minute.`
    : 'Set at least one step above zero.';
}

function selectPattern(id) {
  pattern = findPattern(id, customPattern);
  prefs = store.setPrefs({ patternId: id });
  el.customCard.hidden = id !== CUSTOM_ID;
  renderPatterns();
  describePattern();
  if (engine.state === 'idle' || engine.state === 'finished') resetView();
}

/* -------------------------------------------------------------- sound UI */

function renderSoundscapes() {
  el.soundRow.innerHTML = '';
  audio.SOUNDSCAPES.forEach((sound) => {
    const button = document.createElement('button');
    button.className = 'pill';
    button.type = 'button';
    button.textContent = sound.label;
    button.setAttribute('aria-pressed', String(sound.id === prefs.soundscape));
    button.onclick = () => {
      prefs = store.setPrefs({ soundscape: sound.id });
      audio.setSoundscape(sound.id);
      renderSoundscapes();
    };
    el.soundRow.appendChild(button);
  });
}

/* ------------------------------------------------------------ history UI */

function renderHistory() {
  const sessions = store.getSessions();
  const stats = store.getStats(sessions);

  $('statStreak').textContent = `${stats.streak} ${stats.streak === 1 ? 'day' : 'days'}`;
  $('statToday').textContent = `${stats.todayMinutes} min`;
  $('statCount').textContent = String(stats.count);
  $('statMinutes').textContent = String(stats.totalMinutes);

  if (sessions.length === 0) {
    el.logArea.innerHTML = '<div class="empty">No sessions yet. Your first one will show up here.</div>';
  } else {
    const rows = sessions.slice(-8).reverse().map((session) => {
      const when = new Date(session.start).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      return `<tr>
        <td>${when}</td>
        <td class="num">${session.minutes}</td>
        <td>${session.patternName}</td>
      </tr>`;
    }).join('');
    el.logArea.innerHTML = `<table>
      <thead><tr><th>When</th><th>Min</th><th>Pattern</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  const pending = health.pendingSessions().length;
  el.pendingBadge.textContent = pending === 1 ? '1 session waiting' : `${pending} sessions waiting`;
}

/* ---------------------------------------------------------------- engine */

const engine = createEngine({
  onTick(tick) {
    if (tick.state === 'preparing') {
      // The circle is pale, so the digit needs dark text — emoji don't.
      el.icon.classList.add('countdown');
      el.icon.textContent = String(tick.countdown);
      el.phase.textContent = 'Get ready';
      el.phaseSub.textContent = 'Settle in, let your shoulders drop.';
      el.stepTimer.textContent = `${tick.countdown}s`;
      setScale(0);
      setProgress(0);
      return;
    }

    setScale(tick.fullness ?? 0);
    setProgress(tick.sessionProgress ?? 0);
    el.cycleCount.textContent = String((tick.cycleIndex ?? 0) + 1);
    el.stepTimer.textContent = `${Math.ceil(tick.stepRemaining ?? 0)}s`;

    if (prefs.mode === 'time') {
      el.timer.textContent = mmss(tick.remaining ?? 0);
    } else {
      el.timer.textContent = String(tick.cyclesRemaining ?? 0);
    }
  },

  onPhaseChange(position) {
    const { step } = position;
    el.icon.classList.remove('countdown');
    el.phase.textContent = step.label;
    el.phaseSub.textContent = step.sub;
    el.icon.textContent = step.icon;

    if (prefs.chime) audio.cue(step.kind);
    if (prefs.voice) audio.speak(step.label);
    if (prefs.haptics && navigator.vibrate) {
      navigator.vibrate(step.kind === 'inhale' ? [50, 40, 50] : 45);
    }
  },

  onComplete(result) {
    el.icon.classList.remove('countdown');
    audio.stop();
    audio.cancelSpeech();
    releaseWakeLock();

    // While running the tile shows the breath you are on; once finished it
    // should agree with the whole cycles actually logged.
    el.cycleCount.textContent = String(result.cycles);

    if (!result.aborted && result.seconds >= MIN_LOGGABLE_SECONDS) {
      store.addSession({
        start: result.startedAt.toISOString(),
        end: result.endedAt.toISOString(),
        seconds: result.seconds,
        minutes: Math.round((result.seconds / 60) * 100) / 100,
        patternId: result.pattern.id,
        patternName: result.pattern.name,
        timing: timingLabel(result.pattern),
        cycles: result.cycles,
        completed: result.completed,
      });
      renderHistory();
    }

    if (result.completed) {
      if (prefs.chime) audio.cue('done');
      el.phase.textContent = 'Session complete';
      el.phaseSub.textContent = 'Nice work. Saved to this device.';
      el.stepTimer.textContent = 'Done';
      el.icon.textContent = '🙏';
      setProgress(1);
    } else {
      el.phase.textContent = result.seconds >= MIN_LOGGABLE_SECONDS ? 'Session ended' : 'Stopped';
      el.phaseSub.textContent = result.seconds >= MIN_LOGGABLE_SECONDS
        ? 'Saved what you practised.'
        : 'Too short to log — start again whenever you like.';
      el.stepTimer.textContent = 'Ready';
      el.icon.textContent = '☁️';
      setProgress(0);
    }

    setScale(0);
    setIdleControls();
  },
});

function setRunningControls() {
  el.startBtn.disabled = true;
  el.pauseBtn.disabled = false;
  el.pauseBtn.textContent = 'Pause';
  el.mode.disabled = true;
  el.duration.disabled = true;
  el.cycleTarget.disabled = true;
}

function setIdleControls() {
  el.startBtn.disabled = false;
  el.pauseBtn.disabled = true;
  el.pauseBtn.textContent = 'Pause';
  el.mode.disabled = false;
  el.duration.disabled = false;
  el.cycleTarget.disabled = false;
}

function resetView() {
  el.timer.textContent = prefs.mode === 'time' ? mmss(prefs.durationSec) : String(prefs.cycleTarget);
  el.stepTimer.textContent = 'Ready';
  el.cycleCount.textContent = '0';
  el.phase.textContent = 'Ready when you are';
  el.phaseSub.textContent = 'Pick a pattern and a length, then start. Sound only begins once you press Start.';
  el.icon.classList.remove('countdown');
  el.icon.textContent = '☁️';
  setScale(0);
  setProgress(0);
  setIdleControls();
}

function startSession() {
  if (resolveSteps(pattern).length === 0) {
    toast('That pattern has no steps — set a duration above zero.');
    return;
  }
  audio.start(prefs.soundscape);
  audio.setVolume(prefs.volume);
  requestWakeLock();
  engine.start({
    pattern,
    mode: prefs.mode,
    durationSec: prefs.durationSec,
    cycleTarget: prefs.cycleTarget,
  });
  setRunningControls();
}

/* ------------------------------------------------------------- listeners */

el.startBtn.onclick = startSession;

el.pauseBtn.onclick = () => {
  if (engine.state === 'paused') {
    engine.resume();
    audio.resume();
    el.pauseBtn.textContent = 'Pause';
    requestWakeLock();
  } else {
    engine.pause();
    audio.suspend();
    audio.cancelSpeech();
    el.pauseBtn.textContent = 'Resume';
    el.phase.textContent = 'Paused';
    el.phaseSub.textContent = 'Take your time. Resume when you are ready.';
    releaseWakeLock();
  }
};

el.resetBtn.onclick = () => {
  // Stopping mid-session still logs what was practised, if it was long enough.
  engine.stop();
  engine.reset();
  audio.stop();
  audio.cancelSpeech();
  releaseWakeLock();
  resetView();
};

el.mode.onchange = () => {
  prefs = store.setPrefs({ mode: el.mode.value });
  el.duration.hidden = prefs.mode !== 'time';
  el.cycleTarget.hidden = prefs.mode !== 'cycles';
  el.timerLabel.textContent = prefs.mode === 'time' ? 'Time left' : 'Breaths left';
  resetView();
};

el.duration.onchange = () => {
  prefs = store.setPrefs({ durationSec: Number(el.duration.value) });
  resetView();
};

el.cycleTarget.onchange = () => {
  prefs = store.setPrefs({ cycleTarget: Number(el.cycleTarget.value) });
  resetView();
};

el.volume.oninput = () => {
  const value = Number(el.volume.value);
  prefs = store.setPrefs({ volume: value });
  audio.setVolume(value);
};

[['chimeToggle', 'chime'], ['voiceToggle', 'voice'], ['hapticsToggle', 'haptics'], ['wakeToggle', 'keepAwake']]
  .forEach(([id, key]) => {
    $(id).onchange = (event) => {
      prefs = store.setPrefs({ [key]: event.target.checked });
      if (key === 'keepAwake') {
        if (event.target.checked && engine.state === 'running') requestWakeLock();
        else releaseWakeLock();
      }
    };
  });

// Custom pattern editor
const CUSTOM_FIELDS = [['customInhale', 'inhale'], ['customHold', 'hold'], ['customExhale', 'exhale'], ['customHoldOut', 'holdOut']];
CUSTOM_FIELDS.forEach(([id, kind]) => {
  $(id).oninput = () => {
    const seconds = Math.max(0, Math.min(30, Number($(id).value) || 0));
    const steps = customPattern.steps.map((step) => (step.kind === kind ? { ...step, seconds } : step));
    customPattern = { ...customPattern, steps };
    store.setCustomPattern(customPattern);
    if (pattern.id === CUSTOM_ID) {
      pattern = customPattern;
      describePattern();
    }
    renderPatterns();
  };
});

// Tabs
document.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('[role="tab"]').forEach((other) => {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      $(other.getAttribute('aria-controls')).classList.toggle('active', selected);
    });
  };
});

// Exports
$('exportCsvBtn').onclick = () => {
  if (store.getSessions().length === 0) return toast('Nothing to export yet.');
  store.download('breathing-sessions.csv', store.toCsv(), 'text/csv');
};

$('exportJsonBtn').onclick = () => {
  if (store.getSessions().length === 0) return toast('Nothing to export yet.');
  store.download('breathing-sessions.json', store.toJson(), 'application/json');
};

$('clearLogBtn').onclick = () => {
  if (!confirm('Delete all logged sessions on this device? This cannot be undone.')) return;
  store.clearSessions();
  renderHistory();
  toast('History cleared.');
};

// Apple Health
$('sendHealthBtn').onclick = () => {
  const { sent, ids } = health.sendToShortcut();
  if (sent === 0) return toast('Nothing new to send.');
  // iOS never tells the page what happened, so ask once we are back.
  setTimeout(() => {
    if (confirm(`Did the Shortcut log ${sent} session${sent === 1 ? '' : 's'} to Health?`)) {
      health.confirmSynced(ids);
      renderHistory();
      toast('Marked as logged to Health.');
    }
  }, 1500);
};

$('copyHealthBtn').onclick = async () => {
  if (health.pendingSessions().length === 0) return toast('Nothing new to copy.');
  toast(await health.copyPayload() ? 'Copied to clipboard.' : 'Clipboard blocked — use Export JSON instead.');
};

// Leaving the page mid-session would desync the visuals from the audio, and a
// backgrounded tab stops getting animation frames anyway — so pause instead.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.state === 'running') {
    el.pauseBtn.click();
  } else if (!document.hidden && engine.state === 'running' && prefs.keepAwake && !wakeLock) {
    requestWakeLock();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (engine.state === 'running' || engine.state === 'paused') {
    event.preventDefault();
    event.returnValue = '';
  }
});

/* ----------------------------------------------------------------- boot */

function hydrateControls() {
  el.mode.value = prefs.mode;
  el.duration.value = String(prefs.durationSec);
  el.cycleTarget.value = String(prefs.cycleTarget);
  el.duration.hidden = prefs.mode !== 'time';
  el.cycleTarget.hidden = prefs.mode !== 'cycles';
  el.timerLabel.textContent = prefs.mode === 'time' ? 'Time left' : 'Breaths left';
  el.volume.value = String(prefs.volume);
  $('chimeToggle').checked = prefs.chime;
  $('voiceToggle').checked = prefs.voice;
  $('hapticsToggle').checked = prefs.haptics;
  $('wakeToggle').checked = prefs.keepAwake;
  el.customCard.hidden = pattern.id !== CUSTOM_ID;

  CUSTOM_FIELDS.forEach(([id, kind]) => {
    $(id).value = String(customPattern.steps.find((step) => step.kind === kind)?.seconds ?? 0);
  });
}

hydrateControls();
renderPatterns();
describePattern();
renderSoundscapes();
renderHistory();
audio.setSoundscape(prefs.soundscape);
resetView();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
