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

### Spoken cues and iOS

Speech is the fiddliest part of the app, and iOS is the reason. Three behaviours
conspire to drop utterances, and `audio.js` handles each explicitly:

- **Speech may only begin from a user gesture.** Every phase cue is fired from a timer,
  so unless the engine has been unlocked by an earlier tap, iOS discards them silently —
  no error, no event. `primeSpeech()` speaks one silent utterance from the Start tap and
  from the voice toggle to unlock it.
- **`cancel()` settles asynchronously.** Calling `speak()` in the same tick, as the
  obvious implementation does, loses the new utterance. Interrupting cues wait ~90ms.
- **The queue parks itself** after a cancel or a trip to the background, and stays parked
  until `resume()` is called.

If a cue is requested and no `onstart` fires within 700ms, the Sound tab says so instead
of failing silently. **Test voice** there both unlocks the engine and confirms it works.

One thing none of this can fix: the iPhone's hardware silent switch mutes both speech
and the generated ambience. If a session is silent with everything enabled, check that
switch first.

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
exactly `Log Mindful Session` with two actions:

1. **Split Text** — Text: *Shortcut Input*, Separator: *Custom* → `|`
2. **Log Health Sample** — Type: *Mindful Session*, Start: *Split Text → Item 1*,
   End: *Split Text → Item 2*

Then tap **Send** next to a session on the Health tab.

The payload is deliberately **one session per run**, sent as a single line of text:

```
2026-08-15T07:00:00.000Z|2026-08-15T07:15:00.000Z
```

An earlier version batched sessions as JSON, which meant the Shortcut needed
`Get Dictionary from Input`, a `Repeat with Each Item`, and two `Get Dictionary Value`
actions with the repeat item wired into each — five fiddly actions where it is very
easy to end up with something that silently logs nothing. Two actions and a split on
`|` is worth the extra taps for a backlog.

The `end` in that line is `start` plus the seconds actually practised, not the record's
wall-clock `end`. Health logs a Mindful Session as the span between the two timestamps,
so sending the wall-clock end would credit a long pause as mindfulness.

iOS gives the browser no callback, so a sent session is marked logged optimistically
and the list offers an **Undo** rather than interrupting with a modal. Nothing is ever
deleted — `syncedToHealth` just flips back and the session returns to the queue.

Use **Copy a sample line** in the setup panel to test the Shortcut on its own before
relying on it.

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
