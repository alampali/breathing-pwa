// Apple Health bridge.
//
// A web page cannot write to HealthKit directly — there is no browser API for
// it, and Apple has not shipped one. The two routes that actually work today:
//
//   1. Apple Shortcuts. A Shortcut can log a Mindful Session, and iOS lets a
//      web page hand data to one via the `shortcuts://run-shortcut` URL scheme.
//      That is what `sendToShortcut` below does.
//   2. A native wrapper (WKWebView + HealthKit) later on. Every session record
//      carries a stable `id` and a `syncedToHealth` flag so a wrapper can read
//      the same localStorage payload and write only what is new.
//
// Either way the data stays on the device and the user grants permission in
// iOS itself, not here.

import { getSessions, markSynced } from './storage.js';

export const SHORTCUT_NAME = 'Log Mindful Minutes';

export function pendingSessions() {
  return getSessions().filter((session) => !session.syncedToHealth);
}

/**
 * Compact payload — one object per session, only what HealthKit needs.
 *
 * The end time is derived from the practised seconds rather than taken from the
 * record's wall-clock `end`. Pausing makes those two differ, and a Mindful
 * Session is logged as the span between start and end — so using wall-clock end
 * would credit a five-minute pause as five minutes of mindfulness.
 */
export function healthPayload(sessions = pendingSessions()) {
  return sessions.map((session) => ({
    id: session.id,
    start: session.start,
    end: new Date(new Date(session.start).getTime() + session.seconds * 1000).toISOString(),
    minutes: session.minutes,
  }));
}

export function isAppleDevice() {
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}

/**
 * Hands the unsynced sessions to the Shortcut. Returns the ids that were sent —
 * iOS gives no completion callback, so the caller decides whether to mark them
 * as synced.
 */
export function sendToShortcut(shortcutName = SHORTCUT_NAME) {
  const sessions = pendingSessions();
  if (sessions.length === 0) return { sent: 0, ids: [] };

  const text = encodeURIComponent(JSON.stringify(healthPayload(sessions)));
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${text}`;
  window.location.href = url;

  return { sent: sessions.length, ids: sessions.map((session) => session.id) };
}

export function confirmSynced(ids) {
  return markSynced(ids);
}

export async function copyPayload() {
  const text = JSON.stringify(healthPayload(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
