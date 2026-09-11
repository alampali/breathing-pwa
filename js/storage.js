// All session data lives in this browser's localStorage. Nothing leaves the
// device unless you explicitly export it.

const SESSIONS_KEY = 'cb.sessions.v2';
const PREFS_KEY = 'cb.prefs.v1';
const CUSTOM_KEY = 'cb.customPattern.v1';
const LEGACY_KEY = 'breathingSessionLogs';

export const SOURCE_NAME = 'Calm Breathing PWA';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- sessions */

export function getSessions() {
  migrateLegacy();
  const sessions = read(SESSIONS_KEY, []);
  return Array.isArray(sessions) ? sessions : [];
}

export function addSession(session) {
  const sessions = getSessions();
  sessions.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: SOURCE_NAME,
    syncedToHealth: false,
    ...session,
  });
  write(SESSIONS_KEY, sessions);
  return sessions;
}

export function clearSessions() {
  write(SESSIONS_KEY, []);
}

export function setSynced(ids, value = true) {
  const set = new Set(ids);
  const sessions = getSessions().map((session) =>
    set.has(session.id) ? { ...session, syncedToHealth: value } : session
  );
  write(SESSIONS_KEY, sessions);
  return sessions;
}

/** One-time import of logs written by the original single-file version. */
function migrateLegacy() {
  const legacy = read(LEGACY_KEY, null);
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  const existing = read(SESSIONS_KEY, []);
  const known = new Set(existing.map((session) => session.start));
  const imported = legacy
    .filter((entry) => entry?.start && !known.has(entry.start))
    .map((entry) => ({
      id: `legacy-${entry.start}`,
      start: entry.start,
      end: entry.end,
      seconds: entry.seconds ?? Math.round((entry.minutes || 0) * 60),
      minutes: entry.minutes ?? 0,
      patternId: '478',
      patternName: '4-7-8 Relaxing Breath',
      timing: entry.pattern || '4-7-8',
      cycles: entry.cycles ?? null,
      completed: true,
      source: entry.source || 'Calm 4-7-8 HTML',
      syncedToHealth: false,
    }));
  write(SESSIONS_KEY, [...imported, ...existing].sort((a, b) => a.start.localeCompare(b.start)));
  localStorage.removeItem(LEGACY_KEY);
}

/* ------------------------------------------------------------------- stats */

function dayKey(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getStats(sessions = getSessions()) {
  const totalMinutes = sessions.reduce((sum, session) => sum + (session.minutes || 0), 0);
  const days = new Set(sessions.map((session) => dayKey(session.start)));
  const today = dayKey(new Date().toISOString());
  const todayMinutes = sessions
    .filter((session) => dayKey(session.start) === today)
    .reduce((sum, session) => sum + (session.minutes || 0), 0);

  // Walk back a day at a time. A streak stays alive if you practised today, or
  // if you practised yesterday and today is not over yet.
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor.toISOString()))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.toISOString()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    count: sessions.length,
    totalMinutes: Math.round(totalMinutes),
    todayMinutes: Math.round(todayMinutes * 10) / 10,
    streak,
    daysPractised: days.size,
  };
}

/* ------------------------------------------------------------------- prefs */

export const DEFAULT_PREFS = {
  patternId: '478',
  mode: 'time',        // 'time' | 'cycles'
  durationSec: 300,
  cycleTarget: 10,
  soundscape: 'ocean',
  volume: 0.5,
  chime: true,
  voice: false,
  voiceURI: null,     // which speech voice, when there is a choice
  haptics: true,
  keepAwake: true,
  night: 'auto',       // 'off' | 'on' | 'auto' (auto dims after 8pm)
  textSize: 'normal',  // 'normal' | 'large' | 'larger'
  contrast: false,
};

export function getPrefs() {
  return { ...DEFAULT_PREFS, ...read(PREFS_KEY, {}) };
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  write(PREFS_KEY, next);
  return next;
}

export function getCustomPattern(fallback) {
  const stored = read(CUSTOM_KEY, null);
  if (!stored?.steps) return fallback;
  return { ...fallback, ...stored, custom: true };
}

export function setCustomPattern(pattern) {
  write(CUSTOM_KEY, { steps: pattern.steps });
}

/* ----------------------------------------------------------------- exports */

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function toCsv(sessions = getSessions()) {
  const header = [
    'startDate', 'endDate', 'durationMinutes', 'durationSeconds',
    'activity', 'pattern', 'timing', 'cycles', 'completed', 'sourceName',
  ];
  const rows = sessions.map((session) =>
    [
      session.start,
      session.end,
      session.minutes,
      session.seconds,
      'Mindfulness',
      session.patternName,
      session.timing,
      session.cycles ?? '',
      session.completed ? 'yes' : 'no',
      session.source,
    ].map(csvEscape).join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

export function toJson(sessions = getSessions()) {
  return JSON.stringify(sessions, null, 2);
}

/**
 * Merges an exported JSON backup back into this device's history.
 *
 * The counterpart to `toJson`. Without it an export is a one-way trip: a new
 * phone, or moving from Safari to the installed app, starts from zero with no
 * way back in.
 *
 * Merging is additive and never destructive — existing sessions are left alone
 * and anything already present is skipped, so importing the same file twice is
 * harmless. Records are matched on `id`, falling back to `start` for backups
 * old enough to predate ids.
 *
 * @returns {{added:number, skipped:number, invalid:number, error?:string}}
 */
export function importSessions(text) {
  let incoming;
  try {
    incoming = JSON.parse(text);
  } catch {
    return { added: 0, skipped: 0, invalid: 0, error: 'That file is not valid JSON.' };
  }
  if (!Array.isArray(incoming)) {
    return { added: 0, skipped: 0, invalid: 0, error: 'That file does not contain a list of sessions.' };
  }

  const existing = getSessions();
  const seenIds = new Set(existing.map((s) => s.id).filter(Boolean));
  const seenStarts = new Set(existing.map((s) => s.start));

  let added = 0;
  let skipped = 0;
  let invalid = 0;
  const merged = [...existing];

  incoming.forEach((raw) => {
    const record = normaliseImported(raw);
    if (!record) { invalid += 1; return; }
    if ((record.id && seenIds.has(record.id)) || seenStarts.has(record.start)) { skipped += 1; return; }
    seenIds.add(record.id);
    seenStarts.add(record.start);
    merged.push(record);
    added += 1;
  });

  if (added > 0) {
    merged.sort((a, b) => a.start.localeCompare(b.start));
    if (!write(SESSIONS_KEY, merged)) {
      return { added: 0, skipped, invalid, error: 'Could not save — this browser may be out of storage.' };
    }
  }
  return { added, skipped, invalid };
}

/** Rejects anything without a usable timestamp; repairs what it safely can. */
function normaliseImported(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.start !== 'string' || Number.isNaN(Date.parse(raw.start))) return null;

  const seconds = Number(raw.seconds) || Math.round((Number(raw.minutes) || 0) * 60);
  if (!(seconds > 0)) return null;

  const start = new Date(raw.start).toISOString();
  const end = typeof raw.end === 'string' && !Number.isNaN(Date.parse(raw.end))
    ? new Date(raw.end).toISOString()
    : new Date(new Date(start).getTime() + seconds * 1000).toISOString();

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `imported-${start}`,
    start,
    end,
    seconds,
    minutes: Number(raw.minutes) || Math.round((seconds / 60) * 100) / 100,
    patternId: typeof raw.patternId === 'string' ? raw.patternId : 'unknown',
    patternName: typeof raw.patternName === 'string' ? raw.patternName : 'Imported session',
    timing: typeof raw.timing === 'string' ? raw.timing : '',
    cycles: Number.isFinite(Number(raw.cycles)) ? Number(raw.cycles) : null,
    completed: raw.completed !== false,
    source: typeof raw.source === 'string' ? raw.source : SOURCE_NAME,
    syncedToHealth: raw.syncedToHealth === true,
  };
}

export function download(filename, text, type = 'text/plain') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 0);
}
