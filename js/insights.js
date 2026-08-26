// Derived views over the session log. Pure functions, no DOM — everything here
// is computed from records that already exist, so these light up with whatever
// history is already on the device.

/** Local calendar day, not UTC: practice at 11pm belongs to that evening. */
export function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Every guided breath ever taken. Sessions logged by the original single-file
 * version have no cycle count, so they contribute nothing rather than NaN.
 */
export function lifetimeBreaths(sessions) {
  return sessions.reduce((total, session) => total + (Number(session.cycles) || 0), 0);
}

/**
 * Average pace per day, in breaths per minute.
 *
 * Pace is a property of the pattern — 4-7-8 is always ~3.2 bpm — so plotting it
 * per session just draws a sawtooth of which pattern was picked. Aggregating by
 * day and dividing total cycles by total minutes weights each session by its
 * length for free, and the resulting line falls as the practice drifts toward
 * slower patterns and longer sits. That drift is the thing worth seeing.
 */
export function paceSeries(sessions, maxDays = 30) {
  const byDay = new Map();

  sessions.forEach((session) => {
    const cycles = Number(session.cycles) || 0;
    const seconds = Number(session.seconds) || 0;
    if (cycles <= 0 || seconds <= 0) return;      // legacy or unusable record
    const key = dayKey(session.start);
    const day = byDay.get(key) || { key, cycles: 0, seconds: 0, date: startOfDay(new Date(session.start)) };
    day.cycles += cycles;
    day.seconds += seconds;
    byDay.set(key, day);
  });

  const days = [...byDay.values()]
    .sort((a, b) => a.date - b.date)
    .slice(-maxDays)
    .map((day) => ({
      key: day.key,
      date: day.date,
      minutes: day.seconds / 60,
      bpm: day.cycles / (day.seconds / 60),
    }));

  return withRollingPace(days);
}

export const SMOOTHING_DAYS = 7;

/**
 * Adds a trailing rolling average to each day.
 *
 * Daily pace on its own is far too noisy to read: alternating between, say, box
 * breathing and extended exhale swings it by 2 bpm from one day to the next, and
 * the slow drift underneath disappears into the zigzag. The rolling figure is
 * weighted the same way as a single day — total breaths over total minutes
 * across the window — so it stays the same quantity, just steadier.
 */
function withRollingPace(days, window = SMOOTHING_DAYS) {
  return days.map((day, index) => {
    const slice = days.slice(Math.max(0, index - window + 1), index + 1);
    const minutes = slice.reduce((sum, d) => sum + d.minutes, 0);
    const breaths = slice.reduce((sum, d) => sum + d.bpm * d.minutes, 0);
    return { ...day, rolling: minutes > 0 ? breaths / minutes : day.bpm };
  });
}

/**
 * Compares the first and last thirds of the series so the summary reflects a
 * direction of travel rather than one unusual day at each end.
 */
export function paceTrend(series) {
  if (series.length < 4) return null;
  const size = Math.max(1, Math.floor(series.length / 3));
  // Minute-weighted, so a long sit counts for more than a one-minute reset.
  const mean = (points) => {
    const minutes = points.reduce((sum, p) => sum + p.minutes, 0);
    if (minutes <= 0) return points.reduce((sum, p) => sum + p.bpm, 0) / points.length;
    return points.reduce((sum, p) => sum + p.bpm * p.minutes, 0) / minutes;
  };
  const from = mean(series.slice(0, size));
  const to = mean(series.slice(-size));
  return {
    from,
    to,
    delta: to - from,
    slower: to < from,
    percent: from > 0 ? Math.abs((to - from) / from) * 100 : 0,
  };
}

export const HEATMAP_WEEKS = 13;

/** Minutes per day for a fixed-width grid ending on today. */
export function heatmap(sessions, weeks = HEATMAP_WEEKS) {
  const minutesByDay = new Map();
  sessions.forEach((session) => {
    const key = dayKey(session.start);
    minutesByDay.set(key, (minutesByDay.get(key) || 0) + (Number(session.minutes) || 0));
  });

  // Grid columns are weeks running Sunday-first, so the last column is the week
  // containing today and today is never clipped off the edge.
  const today = startOfDay(new Date());
  const lastSunday = new Date(today);
  lastSunday.setDate(lastSunday.getDate() - lastSunday.getDay());
  const firstDay = new Date(lastSunday);
  firstDay.setDate(firstDay.getDate() - (weeks - 1) * 7);

  const columns = [];
  for (let week = 0; week < weeks; week += 1) {
    const column = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(firstDay);
      date.setDate(date.getDate() + week * 7 + weekday);
      const key = dayKey(date);
      const minutes = minutesByDay.get(key) || 0;
      column.push({
        key,
        date,
        minutes: Math.round(minutes * 10) / 10,
        level: level(minutes),
        future: date > today,
      });
    }
    columns.push(column);
  }
  return columns;
}

/** Fixed thresholds rather than quartiles, so a quiet month still reads quiet. */
function level(minutes) {
  if (minutes <= 0) return 0;
  if (minutes < 5) return 1;
  if (minutes < 10) return 2;
  if (minutes < 20) return 3;
  return 4;
}

export function formatBpm(bpm) {
  return bpm.toFixed(1);
}
