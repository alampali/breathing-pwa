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
js/insights.js        derived views: breath count, pace series, heatmap
js/charts.js          small SVG charts, built with DOM calls
js/celebrate.js       the completion bloom (canvas)
js/intents.js         "what do you need?" — felt states mapped to patterns
js/display.js         night mode, text size, contrast
js/sharecard.js       the weekly summary image
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

### Sound and iOS

Three separate things made the soundscapes and chime unreliable on an iPhone, and
`audio.js` addresses each:

- **The ringer switch mutes Web Audio.** Speech synthesis is *not* muted by it, which is
  exactly why guidance could be audible while the chime and soundscape were silent —
  it reads as "sound works sometimes". Declaring `navigator.audioSession.type =
  "playback"` (Safari 16.4+) opts out. Where that API is missing the Sound tab says so
  rather than leaving it a mystery.
- **The context stops and does not restart.** It can land in `suspended` or WebKit's
  `interrupted` state after a call, an alarm or a locked screen. A `statechange`
  listener resumes it.
- **`cue()` used to give up.** It returned early unless the context was exactly
  `running`, which on iOS meant no chime for most of a session. It now wakes the context
  and schedules regardless — while suspended the sound simply arrives on resume.

Levels and cutoffs are pitched for a phone speaker, which rolls off steeply below about
500Hz. The ocean was previously filtered down to 420Hz and the bowl's fundamental was
174Hz: fine on headphones, close to inaudible on an iPhone.

Rain is built from **white** noise while the ocean uses brown. Brown noise falls off
steeply with frequency, so band-passing it at 2.4kHz left almost nothing — measured, the
rain bed rendered about five times quieter than every other soundscape.

A `DynamicsCompressorNode` sits between the master gain and the destination as a safety
limiter. The closing bowl stacks five partials, a strike and a shimmer, which peaked at
1.37 at full volume — hard clipping, heard as a crackle at the calmest possible moment.

These levels were checked by rendering each sound through an `OfflineAudioContext` and
measuring peak and RMS, rather than by ear. Roughly, at half volume: beds sit near 0.03
RMS, a phase cue peaks around 0.31, and the closing bowl peaks around 0.57 — under 1.0
even at full volume with a soundscape playing underneath.

Tapping a soundscape outside a session auditions it for a few seconds. That doubles as
the user gesture iOS needs before it will allow any audio at all.

### Background tracks

Soundscapes are either synthesised or a looping audio file. File-backed entries in
`SOUNDSCAPES` carry a `src`, a `gain` and a `fallback`.

**No audio is committed.** `audio/` ships with a README and a `.gitignore`; the flute
track is added locally. The Pixabay licence permits using the music in an app but not
redistributing it as standalone files, and an MP3 in a public repository is arguably
exactly that. It also keeps the repository small and the deploy quick.

That makes a missing file the ordinary first-run state rather than a fault, so
selecting Flute without one falls back to a generated bed and the Settings tab explains
why, instead of a soundscape that silently plays nothing.

Tracks are played through a `MediaElementAudioSourceNode` rather than decoded into an
`AudioBuffer`: a ten-minute track decodes to well over 100MB of PCM, which is not
something to hold on a phone. Routing through the graph also means the volume slider and
the output limiter apply to music exactly as they do to everything else.

Recorded music is much hotter than the generated beds, hence the per-track `gain` — 0.5
for the flute. Adjust that rather than the volume slider, which moves everything at once.

The service worker treats audio as **cache-first and never precaches it**. Precaching
would make the very first load pay for several megabytes of music before the app
appears, and revalidating would re-download it on every launch. A changed track means a
changed filename. Ranged media requests return `206 Partial Content`, which is
explicitly not cached — a partial response served as the whole file is silent corruption.

### Choosing a voice

The Settings tab lists the device's speech voices, best first. `rankVoices` scores them
on language, then on quality tier — Apple's "Enhanced" and "Premium" variants are
markedly warmer than the compact voices installed by default — then on a list of
reliably pleasant names.

macOS also ships joke voices ("Bad News", "Bahh", "Zarvox"). Those were ranking directly
beneath the good one in the picker, so they are pushed to the bottom, though never
removed.

The single biggest improvement available to how the guidance sounds is not in this code:
on iOS, downloading an Enhanced or Premium voice under Settings → Accessibility → Spoken
Content → Voices. The app says so on Apple devices.

Guidance is spoken slower and slightly lower than conversational, and the soundscape
**ducks** underneath it. Without ducking the voice and the music sit at the same level
and both turn to mush.

### Vibration

iOS Safari does not implement the Vibration API — `navigator.vibrate` is simply absent,
so the setting can never do anything on an iPhone. Rather than leaving a switch that
silently does nothing, the app detects this and disables the control with an explanation.

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

Note that the ringer switch does **not** mute speech, only Web Audio. That asymmetry is
the clue worth remembering: guidance you can hear while the chime and soundscape are
silent points at the switch (or the audio session), not at the speech code.

### Practice insights

The History tab shows three views, all derived from records the app has been writing
since day one — no schema change, so they populate from existing history immediately.

**Lifetime breath count.** The sum of every session's cycles. Legacy records from the
single-file version carry no cycle count and contribute zero rather than `NaN`.

**Pace.** Average breaths per minute, aggregated by day.

Pace is a property of the *pattern* — 4-7-8 is always about 3.2 bpm — so plotting it per
session just draws a sawtooth of which pattern was picked. Aggregating by day and
dividing total cycles by total minutes weights each session by its length for free.

Even by day it is too noisy to read: alternating between box breathing and extended
exhale swings the line by 2 bpm overnight, burying the slow drift underneath. So the
chart draws two lines — the raw daily figure faint, and a 7-day rolling average in
front. The rolling figure is weighted the same way (total breaths over total minutes
across the window), so it stays the same quantity, just steadier. Tests assert both that
smoothing flattens a 3 bpm daily swing to under 0.6, and that it neither hides a real
trend nor invents one on flat data.

**Heatmap.** Minutes per day over 13 weeks, bucketed into five fixed bands rather than
quartiles, so a quiet month still reads as quiet. Columns run Sunday-first and the last
column contains today, so today is never clipped off the edge. Days are local, not UTC —
an 11:30pm session belongs to that evening.

### Session completion

`celebrate.js` blooms outward from the breath circle: a flash of light at the centre,
five rings expanding and thinning like ripples, and ninety motes drifting up and fading,
over about five seconds — under a struck bowl that rings for six.

Drawing uses additive blending (`globalCompositeOperation = 'lighter'`) so overlapping
light accumulates instead of painting over itself, which is what makes it read as glow
rather than as flat circles.

Deliberately not confetti, which is loud, fast and congratulatory — the opposite of how
the end of a session feels. It asks for no response and shows no score.

It blooms from the middle of the screen if the breath circle is out of view, since
scrolling down to another tab mid-session would otherwise paint the whole animation
off-screen. Under `prefers-reduced-motion` it fades a single halo and drops the motes.
The canvas is inert to input and removes itself, with a timeout fallback because
animation frames stop firing in a hidden tab.

### Starting from a feeling, not a pattern

A newcomer's first question is not "4-7-8 or box breathing?" — it is closer to *I feel
bad, help*. The Pattern tab opens with four intents (can't sleep, wound up, need to
focus, just settle me), each of which picks an existing pattern and length.

Nothing new happens underneath. The point is only the doorway, and it names the pattern
it chose afterwards, so the mapping teaches itself over a few uses.

### Display and accessibility

Night mode, text size and contrast are applied as attributes on `<html>`, so the whole
cascade responds in CSS rather than JavaScript restyling elements.

Night mode matters more than it sounds: 4-7-8 for ten minutes is explicitly a
before-sleep pattern, so the app is routinely open in a dark room at bedtime, where a
bright screen — and especially the completion bloom — works directly against what the
session just did. It dims the palette, and `celebrate.js` reads the same attribute to
drop the bloom to about a third of its brightness with fewer rings and motes. `auto`
runs from 8pm to 6am and is re-checked on a timer, so an evening session does not stay
bright simply because the app was opened at seven.

Text size scales the root font, and every size in the stylesheet is in `rem` so one
change moves the whole app. Contrast trades the glass look for solid panels and
full-strength text. Status messages sit in `aria-live` regions, and a session can be
followed by ear alone with the chime or spoken guidance on.

### Sharing a week

`sharecard.js` draws a summary of the last seven days to a canvas and hands it to the
system share sheet as a PNG, falling back to a download where the sheet cannot take
files. No server, no account, nothing uploaded — the data leaves only if the person
deliberately sends the picture, which is the same promise as the CSV export.

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

**Import** is the counterpart to Export JSON. Without it an export was a one-way trip: a
new phone, or moving from Safari to the installed app, started from zero with no way
back. Merging is additive and never destructive — existing sessions are untouched and
anything already present is skipped, matched on `id` and falling back to `start`, so
importing the same file twice is harmless. Malformed records are counted and skipped
rather than taking the history down with them.

Sessions shorter than 20 seconds are not logged. Stopping partway through *is* logged,
flagged `completed: false` — partial practice still counts.

## Apple Health

A web page cannot write to HealthKit. There is no browser API for it, and Apple has
not shipped one, so any PWA needs a bridge. Two work:

**1. Apple Shortcuts (available now).** In the Shortcuts app, create a Shortcut named
exactly `Log Mindful Session` with four actions:

1. **Split Text** — Separator: *Custom* → `|`. Then tap the *Text* field and pick
   **Shortcut Input** from the bar above the keyboard.
2. **Get First Item from List** — from *Split Text*
3. **Get Item from List** — set to *Item at Index*, index `2`, from *Split Text*
4. **Log Health Sample** — Type: *Mindful Minutes*, Start Date: *First Item*,
   End Date: *Item at Index*

Then tap **Send** next to a session on the Health tab.

The health sample type is called **Mindful Minutes** in the Shortcuts UI, not "Mindful
Session" — that name belongs to the Shortcut itself, which is what the app calls by URL.

> **The first action is where this goes wrong.** Setting the separator is not enough: the
> *Text* field must have the **Shortcut Input** variable placed in it. Left empty it shows
> a pale "Text" with no icon, Split Text receives nothing, both dates come out empty, and
> every run fails with *"Please select an end date that is after the start date"* — an
> error that points at the dates and says nothing about the real cause. Every blue token
> in a finished Shortcut carries a small icon; plain pale text means an empty field.

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
node tests/engine.test.mjs && node tests/storage.test.mjs \
  && node tests/insights.test.mjs && node tests/import.test.mjs \
  && node tests/display.test.mjs && node tests/voice.test.mjs
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
