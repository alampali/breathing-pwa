// Apple Health bridge.
//
// A web page cannot write to HealthKit — there is no browser API for it. The
// only route that works from a PWA today is Apple Shortcuts: a Shortcut can log
// a Mindful Session, and iOS lets a page hand data to one through the
// `shortcuts://run-shortcut` URL scheme.
//
// This deliberately sends ONE session per run, as a single line of plain text.
// A batched JSON payload needs the Shortcut to parse a dictionary and loop over
// it, which is where the setup becomes genuinely hard to get right. One session
// as `start|end` needs only a Split Text and a Log Health Sample action.
//
// Longer term a native wrapper (WKWebView + HealthKit) reads the same records
// and writes them directly. The stable `id` and `syncedToHealth` flag are there
// for exactly that.

import { getSessions, setSynced } from './storage.js';

export const SHORTCUT_NAME = 'Log Mindful Session';
export const SEPARATOR = '|';

export function pendingSessions() {
  return getSessions()
    .filter((session) => !session.syncedToHealth)
    .sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * The end time is derived from the seconds actually practised, not the record's
 * wall-clock end. Pausing makes those differ, and Health logs a Mindful Session
 * as the span between the two timestamps — so the wall-clock end would credit a
 * five-minute pause as five minutes of mindfulness.
 */
export function sessionEnd(session) {
  return new Date(new Date(session.start).getTime() + session.seconds * 1000).toISOString();
}

/** One line, two ISO-8601 timestamps: exactly what the Shortcut splits. */
export function payloadFor(session) {
  return `${session.start}${SEPARATOR}${sessionEnd(session)}`;
}

export function shortcutUrl(session, shortcutName = SHORTCUT_NAME) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}`
    + `&input=text&text=${encodeURIComponent(payloadFor(session))}`;
}

export function sendSession(session, shortcutName = SHORTCUT_NAME) {
  window.location.href = shortcutUrl(session, shortcutName);
}

export function markLogged(id) {
  return setSynced([id], true);
}

export function markNotLogged(id) {
  return setSynced([id], false);
}

export function isAppleDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
