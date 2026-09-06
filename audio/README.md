# Audio tracks

This folder holds the looping background tracks. **No audio is committed to the
repository** — the app falls back to its generated soundscapes when a file is
missing, and the Settings tab says so.

## Adding the flute track

1. Find a track on [Pixabay](https://pixabay.com/music/search/flute%20meditation/).
   Look for something that loops without an obvious start and finish — a steady
   drone or a slow melodic bed works; anything with a distinct opening phrase
   will be noticeable every few minutes.
2. Download the MP3.
3. Rename it to `flute.mp3` and put it in this folder.
4. Add the credit to `CREDITS.md` in the repository root.

That is all. `js/audio.js` already points at `./audio/flute.mp3`.

## Choosing a file

**Length.** Three to ten minutes. Shorter loops become obvious; longer ones cost
download size for no benefit.

**Size.** Aim for under 8MB. The track is deliberately *not* precached by the
service worker — it is fetched on first use and cached from then on — so a large
file does not slow the app's first load, but it will still be a one-off download
on a phone.

**Encoding.** MP3 at 96–128kbps mono is plenty for ambient music and roughly
halves the size against 192kbps stereo. To convert:

```bash
ffmpeg -i original.mp3 -ac 1 -b:a 112k audio/flute.mp3
```

**Looping.** The track is played with `loop = true`. A file that starts and ends
on silence loops cleanly; one that ends mid-phrase will click. If a track you
like does not loop well, trimming a beat off each end usually fixes it.

## Levels

Recorded music is far louder than the generated beds, so `SOUNDSCAPES` in
`js/audio.js` carries a `gain` for each track — `0.5` for the flute. If a track
sounds loud or quiet against the chime, change that number rather than the
volume slider, which moves everything together.

## Licensing

The Pixabay Content License allows use in an app like this, including
commercially, and does not require attribution — though crediting the artist in
`CREDITS.md` is decent practice.

It does **not** allow redistributing the audio as a standalone file. Committing
an MP3 to a public repository is arguably exactly that, which is why this folder
ships empty and the file is added locally. If you would rather commit it anyway,
that is a judgement call worth making deliberately rather than by accident.
