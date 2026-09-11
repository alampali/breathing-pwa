import {
  PATTERNS, CUSTOM_ID, DEFAULT_CUSTOM,
  cycleSeconds, timingLabel, breathsPerMinute, findPattern, resolveSteps,
} from './patterns.js';
import * as store from './storage.js';
import * as audio from './audio.js';
import * as health from './health.js';
import * as insights from './insights.js';
import { paceChart, heatmapGrid } from './charts.js';
import { celebrate } from './celebrate.js';
import { createEngine } from './engine.js';
import { INTENTS, prefsFor } from './intents.js';
import { applyDisplay, watchNight } from './display.js';
import { summarise, shareCard } from './sharecard.js';

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
  voiceStatus: $('voiceStatus'), soundStatus: $('soundStatus'),
  logArea: $('logArea'), healthList: $('healthList'), healthIntro: $('healthIntro'),
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

function setVoiceStatus(message) {
  el.voiceStatus.textContent = message;
}

function setSoundStatus(message) {
  el.soundStatus.textContent = message;
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

function renderIntents() {
  const grid = $('intentGrid');
  grid.innerHTML = '';
  INTENTS.forEach((intent) => {
    const button = document.createElement('button');
    button.className = 'intent';
    button.type = 'button';
    button.innerHTML = '<span class="intent-icon" aria-hidden="true"></span><span class="intent-label"></span>';
    button.querySelector('.intent-icon').textContent = intent.icon;
    button.querySelector('.intent-label').textContent = intent.label;
    button.onclick = () => {
      prefs = store.setPrefs(prefsFor(intent));
      pattern = findPattern(prefs.patternId, customPattern);
      el.customCard.hidden = pattern.id !== CUSTOM_ID;
      hydrateControls();
      renderPatterns();
      describePattern();
      resetView();
      // Naming the pattern it chose is what turns this into a way of learning
      // them, rather than a black box that picks for you.
      $('intentChosen').textContent = `${intent.because} (${pattern.name})`;
    };
    grid.appendChild(button);
  });
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

function renderVoices() {
  const select = $('voiceSelect');
  const hint = $('voiceHint');
  const voices = audio.listVoices();

  select.innerHTML = '';
  if (voices.length === 0) {
    const option = document.createElement('option');
    option.textContent = 'No voices available';
    select.appendChild(option);
    select.disabled = true;
    hint.textContent = 'This browser offers no speech voices.';
    return;
  }

  select.disabled = false;
  voices.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = `${voice.name}${voice.localService ? '' : ' (online)'}`;
    select.appendChild(option);
  });

  const active = audio.currentVoice();
  if (active) select.value = active.voiceURI;

  // The compact voices iOS installs by default are the flat, robotic ones. The
  // warmer Enhanced/Premium variants have to be downloaded first, and that is
  // the single biggest improvement available to how the guidance sounds.
  hint.textContent = health.isAppleDevice()
    ? 'For a warmer voice, install an Enhanced or Premium one in iOS Settings → Accessibility → Spoken Content → Voices, then reopen this app.'
    : 'Voices come from your device, so the list differs between browsers.';
}

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
      if (engine.state === 'running' || engine.state === 'paused') {
        audio.setSoundscape(sound.id);
      } else {
        // Outside a session, audition it. This tap is also a user gesture, so it
        // doubles as the unlock that lets audio play at all on iOS.
        audio.preview(sound.id);
      }
      renderSoundscapes();
      setSoundStatus(sound.id === 'none'
        ? 'Sessions will run in silence.'
        : `Playing a few seconds of ${sound.label.toLowerCase()}…`);
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

  renderInsights(sessions);

  renderHealthList(sessions);

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

}

/* ---------------------------------------------------------------- insights */

function renderInsights(sessions) {
  const breaths = insights.lifetimeBreaths(sessions);
  $('statBreaths').textContent = breaths.toLocaleString();
  $('breathNote').textContent = breaths === 0
    ? 'Your breaths will be counted here from your first session.'
    : 'Every guided breath since you started.';

  const series = insights.paceSeries(sessions);
  const chart = $('paceChart');
  chart.innerHTML = '';
  const summary = $('paceSummary');

  if (series.length < 2) {
    chart.innerHTML = '<div class="empty">A few more days of practice and your pace will show up here.</div>';
    summary.textContent = '';
  } else {
    chart.appendChild(paceChart(series));
    const trend = insights.paceTrend(series);
    const latest = insights.formatBpm(series.at(-1).bpm);
    if (!trend) {
      summary.textContent = `Most recent day: ${latest} breaths per minute.`;
    } else if (Math.abs(trend.delta) < 0.05) {
      summary.textContent = `Holding steady around ${insights.formatBpm(trend.to)} breaths per minute.`;
    } else if (trend.slower) {
      summary.textContent = `You have slowed from ${insights.formatBpm(trend.from)} to `
        + `${insights.formatBpm(trend.to)} breaths per minute — about ${trend.percent.toFixed(0)}% slower.`;
    } else {
      summary.textContent = `Currently ${insights.formatBpm(trend.to)} breaths per minute, `
        + `up from ${insights.formatBpm(trend.from)}. Longer patterns will bring it back down.`;
    }
  }

  const grid = $('heatmap');
  grid.innerHTML = '';
  grid.appendChild(heatmapGrid(insights.heatmap(sessions)));
}

/* ------------------------------------------------------------- health tab */

function renderHealthList(sessions = store.getSessions()) {
  const pending = health.pendingSessions();

  el.healthIntro.textContent = sessions.length === 0
    ? 'Once you have practised, your sessions will appear here ready to send.'
    : pending.length === 0
      ? 'Everything is logged. New sessions will appear here as you practise.'
      : 'Set the Shortcut up once, then it is one tap per session.';

  if (pending.length === 0) {
    el.healthList.innerHTML = sessions.length === 0
      ? '<div class="empty">Nothing to send yet.</div>'
      : '<div class="empty">Nothing waiting — all sessions are marked as logged.</div>';
    return;
  }

  el.healthList.innerHTML = '';
  pending.forEach((session) => {
    const row = document.createElement('div');
    row.className = 'health-row';

    const when = new Date(session.start).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const label = document.createElement('div');
    label.className = 'health-when';
    label.innerHTML = `<strong></strong><span></span>`;
    label.querySelector('strong').textContent = when;
    label.querySelector('span').textContent = `${session.minutes} min · ${session.patternName}`;

    const button = document.createElement('button');
    button.className = 'green small';
    button.textContent = 'Send';
    button.onclick = () => {
      health.sendSession(session);
      // iOS never reports back, so the row switches to a state the user can
      // correct rather than a modal asking whether it worked.
      health.markLogged(session.id);
      renderHistory();
      toast('Marked as logged — undo it below if Health did not get it.');
    };

    row.append(label, button);
    el.healthList.appendChild(row);
  });

  const logged = sessions.filter((session) => session.syncedToHealth);
  if (logged.length > 0) {
    const undo = document.createElement('button');
    undo.className = 'secondary small';
    undo.style.marginTop = '10px';
    undo.textContent = `Undo last (${logged.length} marked as logged)`;
    undo.onclick = () => {
      const last = logged.sort((a, b) => a.start.localeCompare(b.start)).at(-1);
      health.markNotLogged(last.id);
      renderHistory();
      toast('Put back in the queue.');
    };
    el.healthList.appendChild(undo);
  }
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
    if (prefs.haptics) audio.vibrate(step.kind === 'inhale' ? [50, 40, 50] : 45);
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
      // A struck bowl rather than another phase chime — about six seconds of
      // decay under the bloom. Still governed by the chime setting: turning
      // cues off means not being rung at.
      if (prefs.chime) audio.completion();
      celebrate(el.circle);
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
  // Must happen inside this tap: iOS only unlocks speech from a user gesture,
  // and every cue after this comes from a timer.
  if (prefs.voice) audio.primeSpeech();
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
      if (key === 'voice' && event.target.checked) {
        audio.primeSpeech();   // this change event is still a user gesture
        setVoiceStatus('');
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

$('voiceSelect').onchange = (event) => {
  prefs = store.setPrefs({ voiceURI: event.target.value });
  audio.setVoiceURI(event.target.value);
  audio.primeSpeech();                 // this change is still a user gesture
  audio.speak('Breathe in');
  setVoiceStatus('');
};

$('testVoiceBtn').onclick = () => {
  if (!audio.speechSupported()) {
    setVoiceStatus('This browser has no speech engine, so spoken guidance will not work here.');
    return;
  }
  setVoiceStatus('Speaking…');
  audio.primeSpeech();
  audio.speak('Breathe in');
  // speak() reports back through the blocked handler if nothing comes out.
  setTimeout(() => {
    if (el.voiceStatus.textContent === 'Speaking…') {
      // The ringer switch does not affect speech, so it is not the thing to
      // blame if this worked but the chime and soundscape stay silent.
      setVoiceStatus('Voice is working. If the chime and soundscape are silent but this '
        + 'was not, check the side ring/silent switch.');
    }
  }, 1200);
};

// Display and accessibility segmented controls
function renderSegments() {
  document.querySelectorAll('#nightSeg button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.night === prefs.night));
    button.onclick = () => {
      prefs = store.setPrefs({ night: button.dataset.night });
      applyDisplay(prefs);
      renderSegments();
    };
  });
  document.querySelectorAll('#textSizeSeg button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.size === prefs.textSize));
    button.onclick = () => {
      prefs = store.setPrefs({ textSize: button.dataset.size });
      applyDisplay(prefs);
      renderSegments();
    };
  });
}

$('contrastToggle').onchange = (event) => {
  prefs = store.setPrefs({ contrast: event.target.checked });
  applyDisplay(prefs);
};

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

// Import — the counterpart to export, so a backup can actually come back.
$('importBtn').onclick = () => $('importFile').click();

$('importFile').onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';                 // allow re-picking the same file
  if (!file) return;

  const status = $('importStatus');
  status.textContent = 'Reading…';
  try {
    const result = store.importSessions(await file.text());
    if (result.error) {
      status.textContent = result.error;
      return;
    }
    renderHistory();
    const parts = [`Added ${result.added} session${result.added === 1 ? '' : 's'}`];
    if (result.skipped) parts.push(`${result.skipped} already here`);
    if (result.invalid) parts.push(`${result.invalid} unreadable`);
    status.textContent = `${parts.join(' · ')}.`;
    toast(result.added > 0 ? 'History imported.' : 'Nothing new to import.');
  } catch {
    status.textContent = 'Could not read that file.';
  }
};

// Share — renders a card on the device and hands it to the share sheet.
$('shareBtn').onclick = async () => {
  const sessions = store.getSessions();
  const status = $('shareStatus');
  if (sessions.length === 0) return toast('Practise first — there is nothing to share yet.');

  status.textContent = 'Making your card…';
  const summary = summarise(sessions, 7);
  if (summary.sessions === 0) {
    status.textContent = 'No sessions in the last seven days.';
    return;
  }
  const outcome = await shareCard(summary);
  status.textContent = {
    shared: 'Shared.',
    downloaded: 'Saved as an image.',
    cancelled: '',
    failed: 'Could not make the image on this device.',
  }[outcome] ?? '';
};

$('clearLogBtn').onclick = () => {
  if (!confirm('Delete all logged sessions on this device? This cannot be undone.')) return;
  store.clearSessions();
  renderHistory();
  toast('History cleared.');
};

// Apple Health
$('copyNameBtn').onclick = async () => {
  const ok = await health.copyToClipboard(health.SHORTCUT_NAME);
  toast(ok ? 'Shortcut name copied.' : `Copy failed — the name is "${health.SHORTCUT_NAME}".`);
};

$('copySampleBtn').onclick = async () => {
  // A real-looking line for a five-minute session ending now, so the Shortcut
  // can be tested without waiting to practise first.
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 60000);
  const sample = health.payloadFor({ start: start.toISOString(), seconds: 300 });
  const ok = await health.copyToClipboard(sample);
  toast(ok ? 'Sample line copied.' : 'Copy failed — clipboard is blocked here.');
};

$('markAllLoggedBtn').onclick = () => {
  const pending = health.pendingSessions();
  if (pending.length === 0) return toast('Nothing waiting.');
  if (!confirm(`Mark ${pending.length} session${pending.length === 1 ? '' : 's'} as already logged to Health?`)) return;
  pending.forEach((session) => health.markLogged(session.id));
  renderHistory();
  toast('All marked as logged.');
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
  $('contrastToggle').checked = Boolean(prefs.contrast);
  el.customCard.hidden = pattern.id !== CUSTOM_ID;

  // iOS Safari has no Vibration API at all, so the switch can never do anything
  // there. Say so rather than leaving a control that silently does nothing.
  const hapticsToggle = $('hapticsToggle');
  if (!audio.vibrationSupported()) {
    hapticsToggle.checked = false;
    hapticsToggle.disabled = true;
    const row = hapticsToggle.closest('.toggle');
    row?.classList.add('unavailable');
    const note = row?.querySelector('.toggle-text span');
    if (note) note.textContent = 'Not available in this browser — iOS has no vibration API';
  }

  const silentNote = $('silentSwitchNote');
  if (silentNote) {
    silentNote.textContent = audio.audioState().sessionType
      ? 'Audio is set to play through the ring/silent switch.'
      : 'On iPhone, the side ring/silent switch mutes these sounds. Spoken guidance still plays.';
  }

  CUSTOM_FIELDS.forEach(([id, kind]) => {
    $(id).value = String(customPattern.steps.find((step) => step.kind === kind)?.seconds ?? 0);
  });
}

audio.setVoiceURI(prefs.voiceURI);

// No audio ships with the repository, so a missing track is the ordinary
// first-run state rather than a fault. Say what happened and what to do.
audio.setTrackMissingHandler((sound) => {
  setSoundStatus(`${sound.label} needs an audio file at ${sound.src} — `
    + 'see audio/README.md. Using the generated sound for now.');
});

audio.setSpeechBlockedHandler(() => {
  setVoiceStatus('iOS blocked that cue. Tap "Test voice" once, then start the session — '
    + 'speech has to be unlocked by a tap before timed cues are allowed.');
});

applyDisplay(prefs);
// An evening session should not stay bright past 8pm just because the app was
// opened at seven.
watchNight(() => prefs, () => renderSegments());

hydrateControls();
renderSegments();
renderIntents();
renderPatterns();
describePattern();
renderSoundscapes();
renderVoices();
// The voice list is empty on first read in most browsers and fills in later.
window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
  audio.setVoiceURI(prefs.voiceURI);
  renderVoices();
});
renderHistory();
audio.setSoundscape(prefs.soundscape);
resetView();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
