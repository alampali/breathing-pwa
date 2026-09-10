# Audio tracks

`flute.m4a` is committed and deploys with the app — it has to, or nobody but the
person who downloaded it would ever hear it.

Source files (`.mp3`, `.wav`) stay local. `.gitignore` in this folder keeps them
out and re-includes `flute.m4a` specifically.

## Re-encoding

The Pixabay original is a 256kbps MP3, which is far more than ambient flute
needs — 11MB against 5.8MB for a 128kbps AAC of the same music. AAC is a
generationally better codec than MP3, so 128k AAC carries roughly what 256k MP3
does.

macOS has an AAC encoder built in, so no tools are needed:

```bash
afconvert -f m4af -d aac -b 128000 -q 127 source.mp3 audio/flute.m4a
```

Measured against the original, aligned and differenced over a 20-second window:

| Encoding | Size | vs original | SNR |
| --- | --- | --- | --- |
| MP3 256k (source) | 11 MB | — | — |
| AAC 160k | 7.6 MB | −35% | 37.3 dB |
| **AAC 128k (shipped)** | **5.8 MB** | **−48%** | **33.8 dB** |
| AAC 112k | 4.9 MB | −58% | 32.0 dB |
| AAC 96k | 4.6 MB | −61% | 30.1 dB |

At 33.8 dB the difference is under 2% of the music's amplitude, on a track that
plays at half gain, ducked under the guidance, usually through a phone speaker.

## Replacing the track

1. Find something on [Pixabay](https://pixabay.com/music/search/flute%20meditation/)
   that loops without an obvious start and finish — a steady bed works; a distinct
   opening phrase will be noticeable every few minutes.
2. Re-encode with the command above.
3. Update [CREDITS.md](../CREDITS.md).

Three to ten minutes is the useful range. Shorter loops become obvious; longer
ones cost download size for nothing. The current track is 6:06.

**Check the loop seam.** The shipped track begins and ends in silence, so
`loop = true` is seamless. One that ends mid-phrase will click every time it
wraps. Trimming a beat off each end usually fixes it.

## Levels

`SOUNDSCAPES` in `js/audio.js` carries a `gain` per track — `0.5` for the flute,
which puts it at the same level as the generated beds. If a new track sounds
loud or quiet against the chime, change that number rather than the volume
slider, which moves everything together.

## Caching

The service worker treats audio as cache-first and never precaches it, so the
track is fetched on first use and kept from then on. A large file therefore
costs a one-off download rather than slowing every launch. A changed track means
a changed filename.
