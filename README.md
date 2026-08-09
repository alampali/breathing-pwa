# Calm Breathing

A guided breathing PWA. No accounts, no analytics, no network calls — every session
you log stays in your own browser's local storage until you choose to export it.

## Patterns

| Pattern | Timing | What it's for |
| --- | --- | --- |
| 4-7-8 Relaxing Breath | 4-7-8 | Long exhale to wind down; good before sleep |
| Box Breathing | 4-4-4-4 | Even and square; steadying under pressure |
| Coherent Breathing | 5.5-5.5 | Resonant pace, ~5.5 breaths/min, no holds |
| Extended Exhale | 4-6 | The gentlest option; nothing to hold |
| Triangle Breathing | 4-4-4 | Box breathing without the empty hold |
| Physiological Sigh | 2-1-6-1 | Double inhale then a long sigh; fast reset |
| Custom | yours | Any inhale / hold / exhale / hold-empty timing |

Sessions run either **by time** (1–20 minutes) or **by breaths** (a fixed number of
cycles). A 3-second lead-in gives you time to settle before the first inhale.

## Running it locally

The app uses native ES modules and a service worker, so it needs to be served over
HTTP — opening `index.html` from the file system will not work.

```bash
python3 -m http.server 8899
```

Then open <http://localhost:8899>.

## Deploying

`.github/workflows/` deploys to Azure Static Web Apps on push to `main`. There is no
build step: the repository root is uploaded as-is. Adding a file means adding it to
`FILES_TO_CACHE` in `service-worker.js` and bumping `CACHE_NAME`, otherwise offline
launches will miss it.

The service worker is **network-first**: it asks the network first (revalidating rather
than trusting the browser's HTTP cache) and falls back to the cache only when the
network fails or takes longer than 2.5 seconds. A deploy is therefore live on the very
next launch. The cache is the offline safety net, not the default source — with the
server unreachable the app still loads and runs entirely from it.

## How it fits together

```
index.html            markup only
css/styles.css        all styling
js/patterns.js        the pattern library; steps, timings, phase metadata
js/engine.js          session clock and breath position — no DOM, no audio
js/audio.js           generated soundscapes and cues (Web Audio, no files)
js/storage.js         localStorage: sessions, stats, prefs, CSV/JSON export
js/health.js          Apple Health bridge
js/app.js             wires the above to the DOM
```

`engine.js` is deliberately free of DOM and audio references, which is what makes it
testable in isolation.

### Timing

The engine derives everything from `performance.now()` on each animation frame rather
than counting `setTimeout` ticks, so the session clock cannot drift, and the circle
animates over the real length of each phase — an 8-second exhale takes 8 seconds.

Backgrounding the page auto-pauses the session. Animation frames stop firing in a
hidden tab anyway, and letting the audio run on while the visuals froze would put the
two out of sync.

### Storage

One key, `cb.sessions.v2`, holds an array of session records:

```json
{
  "id": "1754697600000-a3f9c1",
  "start": "2026-08-09T07:00:00.000Z",
  "end": "2026-08-09T07:05:00.000Z",
  "seconds": 300,
  "minutes": 5,
  "patternId": "box",
  "patternName": "Box Breathing",
  "timing": "4-4-4-4",
  "cycles": 18,
  "completed": true,
  "source": "Calm Breathing PWA",
  "syncedToHealth": false
}
```

Logs written by the earlier single-file version (`breathingSessionLogs`) are imported
once on first load and the old key is removed.

Sessions shorter than 20 seconds are not logged. Stopping partway through *is* logged,
flagged `completed: false` — partial practice still counts.

## Apple Health

A web page cannot write to HealthKit. There is no browser API for it, and Apple has
not shipped one, so any PWA needs a bridge. Two work:

**1. Apple Shortcuts (available now).** In the Shortcuts app, create a Shortcut named
exactly `Log Mindful Minutes`:

1. Enable *Receive text input from Share Sheet and other apps*
2. `Get Dictionary from Input`
3. `Repeat with Each Item`
4. Inside the repeat — `Get Dictionary Value` for `start`, then for `end`
5. Inside the repeat — `Log Health Sample` → *Mindful Session*, using those dates

Then use **Send to Shortcut** on the Health tab. The app hands over only unsynced
sessions as `[{id, start, end, minutes}]`. iOS gives the browser no completion
callback, so the app asks you whether it worked before setting `syncedToHealth`.

The `end` in that payload is `start` plus the seconds actually practised, not the
record's wall-clock `end`. Health logs a Mindful Session as the span between the two
timestamps, so sending the wall-clock end would credit a long pause as mindfulness.

**2. A native wrapper (later).** A thin WKWebView + HealthKit app can read the same
`cb.sessions.v2` records and write the ones where `syncedToHealth` is false directly
to HealthKit. The schema is already shaped for it — that's what the stable `id` and
the flag are for.

Exported CSV carries a `Mindfulness` activity column and ISO-8601 timestamps, so it
also imports into third-party Health importers.

## Tests

`tests/` holds two dependency-free Node scripts. They stub the browser bits the modules
need — a fake clock plus `requestAnimationFrame` for the engine, a fake `localStorage`
for the store — and then exercise the real code.

```bash
node tests/engine.test.mjs && node tests/storage.test.mjs
```

The engine tests check phase order and timing for every pattern, that the circle's
fullness tracks the breath, that pausing does not advance the clock, and that stopping
early reports the partial session. The storage tests cover migration from the old
single-file logs, streak arithmetic, CSV escaping, Health sync flags, and recovery from
corrupt storage.

## Not medical advice

This is a relaxation aid. Breath-holding patterns are worth skipping if you are
pregnant, have a heart or respiratory condition, or feel lightheaded. Never practise
while driving or in water.
