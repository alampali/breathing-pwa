# Audio tracks

`flute.m4a` and `rain.m4a` are committed and deploy with the app — they have to,
or nobody but the person who downloaded them would ever hear them.

Source files (`.mp3`, `.wav`) stay local. `.gitignore` in this folder keeps them
out and re-includes the encoded tracks specifically.

## Re-encoding

Both Pixabay originals are 256kbps MP3s, far more than this material needs —
11MB against 5.5MB for the flute, 5.5MB against 2.9MB for the rain. AAC is a
generationally better codec than MP3, so 128k AAC carries roughly what 256k MP3
does.

macOS has an AAC encoder built in, so no tools are needed:

```bash
afconvert -f m4af -d aac -b 128000 -q 127 source.mp3 audio/flute.m4a
```

### Flute — measured by waveform difference

Aligned against the original and differenced over a 20-second window:

| Encoding | Size | vs original | SNR |
| --- | --- | --- | --- |
| MP3 256k (source) | 11 MB | — | — |
| AAC 160k | 7.6 MB | −35% | 37.3 dB |
| **AAC 128k (shipped)** | **5.5 MB** | **−48%** | **33.8 dB** |
| AAC 112k | 4.9 MB | −58% | 32.0 dB |
| AAC 96k | 4.6 MB | −61% | 30.1 dB |

At 33.8 dB the difference is under 2% of the music's amplitude, on a track that
plays at half gain, ducked under the guidance, usually through a phone speaker.

### Rain — measured by spectrum, not waveform

**SNR is the wrong measure for rain.** It is broadband noise, and AAC deliberately
substitutes perceptually equivalent noise rather than reproducing the waveform, so
the difference signal is huge while the sound is unchanged. Rain scores 7.2 dB at
128k against the flute's 33.8 dB, and sounds just as good.

What matters for noise is the long-term spectrum. Per-band energy against the
original, via band-pass filters at 125Hz to 16kHz:

| Encoding | Size | vs original | Worst band deviation |
| --- | --- | --- | --- |
| MP3 256k (source) | 5.5 MB | — | — |
| **AAC 128k (shipped)** | **2.9 MB** | **−48%** | **0.36 dB** |
| AAC 96k | 2.5 MB | −57% | 1.02 dB |

0.36 dB is comfortably below what anyone can hear. 96k begins thinning the top
end — it loses 1 dB at 16kHz — for another 0.4 MB.

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
`0.45` for the rain, which puts them at the same level as the generated beds.
If a new track sounds loud or quiet against the chime, change that number rather
than the volume slider, which moves everything together.

## Caching

The service worker treats audio as cache-first and never precaches it, so the
track is fetched on first use and kept from then on. A large file therefore
costs a one-off download rather than slowing every launch. A changed track means
a changed filename.

## Falling back

Every file-backed soundscape names a `fallback`, which must be one of the beds
`buildGenerated` can synthesise — `ocean`, `rain` or `bowl`. Rain falls back to
the *synthesised* rain of the same name, which is why the fallback is built
directly rather than by re-entering `buildBed`: going back through the front door
would retry the missing file and recurse. `tests/voice.test.mjs` holds that line.
