// Night mode, text size and contrast.
//
// Each is applied as an attribute on <html> so the whole cascade can respond in
// CSS, rather than JavaScript reaching in to restyle elements.

const root = document.documentElement;

export const NIGHT_FROM_HOUR = 20;   // 8pm
export const NIGHT_UNTIL_HOUR = 6;   // 6am

/**
 * 4-7-8 for ten minutes is explicitly a before-sleep pattern, so the app is
 * routinely open in a dark room at bedtime — where a bright screen, and
 * especially the completion bloom, works directly against what the session just
 * did. Night mode dims the whole palette and softens the ending.
 */
export function nightActive(setting, now = new Date()) {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  const hour = now.getHours();
  return hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;
}

export function applyDisplay(prefs, now = new Date()) {
  const night = nightActive(prefs.night, now);
  root.toggleAttribute('data-night', night);
  root.setAttribute('data-text-size', prefs.textSize || 'normal');
  root.toggleAttribute('data-contrast', Boolean(prefs.contrast));
  return night;
}

export function isNight() {
  return root.hasAttribute('data-night');
}

/**
 * Re-evaluates on a timer so an evening session does not stay bright after 8pm
 * simply because the app was opened at seven.
 */
export function watchNight(getPrefs, onChange, intervalMs = 60000) {
  let last = isNight();
  return setInterval(() => {
    const next = nightActive(getPrefs().night);
    if (next !== last) {
      last = next;
      applyDisplay(getPrefs());
      onChange?.(next);
    }
  }, intervalMs);
}
