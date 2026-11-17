# Pitch Trainer

A pitch-training Progressive Web App for iPhone (and desktop): singing pitch with live mic feedback, plus silent ear-training drills. No backend, no accounts, no analytics. Audio is never uploaded or kept.

**Status: Milestone 2.** On top of the M0 audio foundation it has the voice range finder, Drone mode (free singing, holds, scale degrees, slides), Pitch Match with adaptive difficulty, Octave Jump, Scale Ladder, and the shared feedback UI (live trace, cents needle, result card). The daily session, streaks and progress screens come in M4 (see [Roadmap](#roadmap)).

Live app: **https://zantexee.github.io/pitch-trainer/** (once GitHub Pages is enabled; see [Deploy](#deploy)).

---

## Open it on your iPhone

1. Open the live URL in **Safari**. It has to be Safari, because only Safari can add a web app to the iOS home screen with mic access.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open **Pitch** from the home screen. It runs full-screen and works offline after the first load.
4. The first time you start the mic, iOS asks for microphone permission. If you said no by mistake, go to Settings → Safari → Microphone (for a Safari tab), or delete and re-add the home-screen app.

Updates install themselves. If you don't see a new version, close the app fully and reopen it.

## Testing on the phone during development

The mic only works over **HTTPS** (or on `localhost`). There are three options:

**A. Use the deployed site (simplest).** Push to `main`. GitHub Actions runs the tests, builds and deploys in about a minute. Reload on the phone.

**B. HTTPS on your local network.**
```bash
npm install
npm run dev:https        # Vite with a self-signed certificate, listening on your LAN
```
Vite prints a `https://192.168.x.x:5173` address. Open it in Safari on the iPhone (same Wi-Fi). Safari warns about the certificate: tap **Show Details**, then **visit this website**. The mic works after that. Hot reload works too.

**C. A tunnel (works from anywhere, real certificate).**
```bash
npm run dev
npx cloudflared tunnel --url http://localhost:5173   # no account needed, prints a https://*.trycloudflare.com URL
```
`vite.config.ts` already allows `*.trycloudflare.com` and ngrok hosts.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: maths, scoring, smoothing and the synthetic-signal detector test
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally
```

Requires Node 22+.

## Deploy

GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`). Every push to `main` runs the tests, builds with `BASE_PATH=/<repo-name>/` and deploys. A failing test blocks the deploy.

One-time setup:
1. GitHub Pages on a free plan needs the repo to be **public**: Settings → General → Danger Zone → Change visibility.
2. Settings → **Pages** → Build and deployment → Source: **GitHub Actions**.
3. Re-run the latest workflow (Actions tab → *Test and deploy* → Re-run), or push again.

Any static host works. On Netlify or Cloudflare Pages, use build command `npm run build`, output `dist`, and leave `BASE_PATH` unset. The app uses hash routing, so it needs no rewrite rules.

---

## How it works

### Architecture

```
src/
  lib/notes.ts        MIDI ↔ Hz ↔ names, cents, octave folding (pure, tested)
  pitch/
    mpm.ts            McLeod Pitch Method on pitchy's FFT autocorrelator, with bounded lag range
    detector.ts       window size, detection range, noise gate, clarity gate, gate calibration
    tracker.ts        median-of-5 smoothing, octave-jump guard, dropout bridging
    scoring.ts        per-attempt accuracy / stability / settle / octave / verdict
    live.ts           ~60 Hz loop: mic → detector → tracker → subscribers
  audio/
    engine.ts         the AudioContext, limiter, audioSession, iOS lifecycle recovery
    synth.ts          timbres (Pad, Pure, Bright, Organ, Choir), envelopes, chime
    drone.ts          sustained drone (root / +5th / +octave), volume, duck-and-check
    mic.ts            getUserMedia with processing off, analyser, device list
  db/db.ts            Dexie (IndexedDB): settings now, attempt history from M1
  ui/                 AudioGate (tap-to-start + resume overlay), PitchTrace canvas
  screens/            Home, Diagnostics
tests/                Vitest suites + synthetic signal generator
```

All logic that needs testing is plain TypeScript without React or Web Audio, so it runs in Node.

### Training modules (M1)

- **Voice range** (`screens/RangeFinder.tsx`, `lib/range.ts`) runs three guided glides: normal voice, falsetto, and lowest "bassy" voice. The low step is labelled experimental. A note counts when it's held within ±50¢ for 300 ms, and the lowest and highest such notes become the register's span. Results show on a keyboard, each end can be adjusted by a semitone, and every save is stored so the range-over-time chart grows. Spans narrower than 2 semitones are treated as "not detected". *Stretch* allows ±2 semitones beyond the range.
- **Drone** (`screens/DroneMode.tsx`): pick a note on the keyboard (limited to your range) or roll a random one. Choose the timbre, voicing (root, +5th, +octave) and volume.
  - *Free*: with headphones, a continuous needle plus a chime on lock. Without headphones it uses **duck-and-check**: every 3 s the drone fades out for 0.6 s, the mic measures you in the gap (`engine.openListenWindow`), and a ✓/↑/↓ chip shows the result.
  - *Hold* (1 s → 3 s → 5 s, levels up on success), *Degrees* ("sing the 5th above the drone"), and *Slide* (alternates from above and from below; the attempt must start clearly on the right side). With headphones the drone keeps playing. Without them it plays for 2.5 s, fades out, and then you sing (call and response).
- **Pitch Match** (`screens/PitchMatch.tsx`): note (1.2 s) → memory gap → sing and hold → score → result card → auto-next after 1.5 s unless you tap. Pause and Skip are always available. An interruption pauses the session.
  - Difficulty levers (`engine/adaptive.ts`): tolerance 50/35/25/15¢, hold 0.5/1/1.5/2 s, gap 0.3/1/2/3 s, note spread 3/5/7/12 semitones, and timbre set (Bright → +Pure → all). Over the last 12 attempts (minimum 8), success above 90% raises one lever (round-robin) and below 70% lowers the most recently raised one.
  - **Ears-only trials:** once a note has succeeded 3 times in a row, 35% of its trials hide the trace and needle until the result.
  - **Doubling:** with headphones on, the first 3 times a note appears it keeps playing quietly while you sing, at 35% → 18% → 8% volume. Without headphones the mic would pick it up, so doubling is off.
- **Feedback UI** (`ui/`): the scrolling trace is green inside tolerance, amber within 2× tolerance and grey otherwise. The needle shows a dot position plus an arrow word (↑ higher / ↓ lower / ✓ locked / "Right note, one octave low"), so direction never depends on colour alone. A hold-progress bar fills toward the lock, which plays a soft chime and a small pop. The result card shows your trace over the target, accuracy (mean |¢|), stability (SD), settle time, ▶ Target, 🎧 My attempt and Next.
- **"Hear my attempt"** uses `MediaRecorder` in memory only. The recording is discarded when the next attempt starts or the screen closes.
- Every attempt is stored in IndexedDB (`attempts` table: timestamp, module, target, result, cents error, octave error, settle time, stability, difficulty) for the M4 progress screens.

### Octave Jump and Scale Ladder (M2)

- **Octave Jump** (`screens/OctaveJump.tsx`, `engine/octave.ts`): you hear a reference in register A, then sing the target in register B *without hearing it first*. The pitch class and the octave are scored separately ("Note ✓ · Octave ✗ (one octave low)"), and then the real target plays so your own ears confirm the result.
  - Progression stages: one octave within a register → across registers (chest ↔ falsetto, low ↔ chest) → two octaves → notes other than C (naturals) → any note → octave plus an interval (hear C3, sing G4). Stages 0–2 use C only.
  - Only pairs that fit your measured registers are generated. If your range can't support a stage, it falls back to an easier one and says so.
  - Newly introduced pair types come up about 60% of the time. Register pairs with lower success are weighted up.
  - Difficulty levers: stage, then tolerance (50/35/25¢). Success per register pair is shown on the screen and stored.
- **Scale Ladder** (`screens/ScaleLadder.tsx`, `engine/ladder.ts`): an I–IV–V–I cadence (or i–iv–V–i) or a tonic drone sets the key, then you sing the steps.
  - **Relaxed** mode: each step must lock (±35¢ for 0.4 s) before the next appears. Breathing between steps is fine, Skip step is available, and a step gives up after 8 s.
  - **Timed** mode: one step per 1.3 s beat, scored on the back 70% of each beat.
  - Kodály order: sol–mi → +la → +do → +re (pentatonic) → major up and down → natural minor → other modes (dorian, mixolydian, lydian, phrygian) → degree jumps (hear the tonic, sing 5, 3, 6…) → register transfer (major scale in chest voice, then the same scale an octave up in falsetto).
  - The tonic is chosen so every step fits your range, dropping a stage if nothing fits. The stage advances when at least 80% of steps succeed on most recent ladders.
  - Labels are note names by default, with toggles for degree numbers or solfège. With headphones the tonic drone keeps sounding under you. Without them the key is set and then the app goes silent, and ♪ Tonic replays it.
  - Every step is stored as an attempt (degree + note) for the scale-degree accuracy grid in M4.

### Pitch detection

- **Window:** 4096 samples when the target (or the current stable pitch) is below 110 Hz, otherwise 2048. With no target and no pitch yet it uses 4096, which is safe for low notes.
- **Range:** 50–1100 Hz (a little below A1 up to just above C6).
- **Bounded MPM:** pitchy's `PitchDetector` searches lags right up to the end of the window. There, the overlap is a few samples and the normalised difference function climbs back towards 1. On a synthetic C2 voice that produced 11–13 Hz readings with clarity 1.0. `mpm.ts` reuses pitchy's autocorrelator but only picks peaks between the lags for 1100 Hz and 50 Hz, and never past half the window.
- **Octave-up guard:** if the NSDF peak at twice the chosen period is more periodic by at least 0.01, the chosen peak was the 2nd harmonic, so the detector takes the longer period. Without this, voices with weak 1st and 3rd harmonics (some vowels, or a phone mic rolling off the low end) read G5 for a sung G4. This was found on a real iPhone. The 0.01 margin is tuned on synthetic voices: 0.005 starts reading genuine high notes an octave low, and 0.015 misses the hardest weak-fundamental case. `tests/detector.test.ts` covers both directions.
- **Gates:** RMS must be above the noise gate. The gate is calibrated from 2 s of silence the first time the mic starts, and can be re-run from Diagnostics. Clarity must be ≥ 0.9, or ≥ 0.8 for notes below 110 Hz.
- **Smoothing:** median of the last 5 accepted frames. A jump of about an octave from the stable estimate is accepted only after **3** consecutive agreeing frames. Other jumps over 250¢ (real note changes) need 2. Dropouts shorter than 250 ms are bridged.
- **Scoring:** cents = 1200·log2(f/target), plus the octave-folded error (pitch class in [−600, +600) and a whole-octave offset). This lets feedback say "right note, one octave low" instead of "wrong note". The first 150 ms after onset are excluded from accuracy and reported as settle time.
- **Unreadable sound:** if the sound is loud enough but stays too irregular for more than 0.5 s (fry, strohbass), the UI says "Can't read this sound. Try a steadier tone."

### Detector test (`tests/detector.test.ts`)

Sine, band-limited sawtooth, and a voice-like signal (saw → three "ah" formant band-passes, 5.5 Hz vibrato at ±30¢, white noise 30 dB down) at A1, C2, E2, A2, C3, C4, A4, C5 and C6, at 44.1 and 48 kHz. That's 54 cases. Each case runs about 55 analyses a second over 1.2 s and requires:

- more than 90% of frames accepted,
- **zero octave errors**, raw or smoothed,
- median |raw error| < 10¢ against the true pitch in that window,
- smoothed output: median error vs the target note < 10¢, and for the steady signals median |error| < 10¢ against the true pitch. The median filter lags vibrato by about 2 frames, so for the voice signal we compare against the sung note, not the instantaneous wobble.

Silence tests: digital silence, quiet room noise after calibration, and loud white noise must all return no pitch.

### Sound

- Every envelope uses linear ramps or `setTargetAtTime` (no clicks). A `DynamicsCompressor` limiter sits on the master output.
- **Pad:** 3 saws detuned ±5¢, a low-pass that tracks about 5× the fundamental, 0.6 s attack, 1.2 s release.
- **Pure:** sine. **Bright:** triangle + saw. **Organ:** additive drawbar wave. **Choir:** detuned saws through "ah" formant filters with gentle vibrato.
- Below E3, *Pure* switches automatically to *Bright*, because a phone speaker can't reproduce the fundamental. A one-time tip suggests headphones.
- **Call-and-response mic gating:** while the app is sounding, plus a 200 ms room tail, the mic is ignored. With "I'm using headphones" on, the mic keeps listening during the drone.

### iOS handling

- The AudioContext is created and resumed only inside a tap (the **Tap to start** gate), with a silent one-sample unlock blip.
- `navigator.audioSession` is feature-detected. It's set to `play-and-record` before `getUserMedia`, and to `playback` otherwise.
- On `visibilitychange` / `pageshow`, the app resumes the context and **checks that `currentTime` is advancing**. If it isn't (WebKit bug 291892 in home-screen PWAs), it closes and recreates the context and re-attaches the mic. As a last resort it shows **Tap to resume audio**. Interruptions (`interrupted` state) show the same overlay.
- Mic tracks stop when you leave the Diagnostics screen, which clears the orange indicator.
- Screen Wake Lock is held while the mic is running, where supported.
- `navigator.storage.persist()` is requested on first start.

---

## Manual device checklist

Run these on the phone and note the results in the table. The **Diagnostics** screen shows everything you need: Hz, note, cents, clarity, RMS, sample rate, audioSession type, input device, and the mic constraints asked for vs. applied.

| # | Check | Safari tab | Home-screen app | Notes |
|---|-------|-----------|-----------------|-------|
| 1 | Tap to start → *Play 1.2 s* is audible, no clicks, for all 5 timbres | | | |
| 2 | Drone root / +5th / +octave sustains; volume slider is smooth | | | |
| 3 | **Silent switch ON**: is audio still audible? (shows whether `audioSession=playback` overrides the switch) | | | |
| 4 | Silent switch OFF: normal | | | |
| 5 | Start mic: orange indicator appears; **is playback volume still normal afterwards?** | | | |
| 6 | Sing C3, C4, A4 steadily: note and cents are stable, no octave flicker | | | |
| 7 | Sing your lowest note (C2 area) and falsetto (C5 area): readable? | | | |
| 8 | Mic constraints table: which values did iOS actually apply? | | | |
| 9 | **Wired headphones**: playback and mic both fine | | | |
| 10 | **AirPods**: does the mic drop playback into low-quality call audio? Which input is listed? | | | |
| 11 | Background the app for 30 s and return: sound still works (watch *Context recreated*) | | | |
| 12 | Lock the screen mid-drone, unlock: overlay or sound resumes without a crash | | | |
| 13 | Phone-call interruption (call yourself from another phone) | | | |
| 14 | **Airplane mode**: app opens and works offline from the home screen | | | |
| 15 | Leaving any singing screen clears the orange mic indicator | | | |
| 16 | Range finder: glides detect sensible chest / falsetto ends; low "bassy" step readable? | | | |
| 17 | Drone without headphones: duck-and-check gaps are short and the checks match what you sang | | | |
| 18 | Pitch Match: lock chime plays; "Hear my attempt" plays back your voice | | | |
| 19 | Octave Jump: chest ↔ falsetto pairs score the octave correctly (no false "octave low/high") | | | |
| 20 | Scale Ladder: cadence is audible on the speaker; relaxed steps advance on lock; timed mode keeps up | | | |

Already checked in desktop Chromium (headless, fake mic fed a C3 tone): the audio gate, all timbres and the drone run without errors, and the mic reads C3 at 130.81 Hz with clarity 1.00. For M2, Octave Jump (a C3 voice against a C4 target reads "Note ✓ · Octave ✗ (one octave low)", then the target plays) and Scale Ladder (cadence, then timed steps, then summary) run with no console errors. For M1, the range finder, Pitch Match (a C3 voice against a C4 target correctly reads "Right note, one octave low"), Drone free mode and the Hold / Slide challenges all run end to end with no console errors.

## Roadmap

- **M0 (done):** audio foundation, Diagnostics, tests, PWA + deploy.
- **M1 (done):** voice range finder, Drone mode, Pitch Match, shared feedback UI.
- **M2 (done):** Octave Jump, Scale Ladder.
- **M3:** ear-only drills.
- **M4:** one-tap Start / Daily Mix, adaptive difficulty, weak-spot targeting, streaks, progress screens, surprises.
- **M5:** polish, onboarding, vocal-health prompts, settings, export/import, accessibility.

## Privacy

Everything stays on the device in IndexedDB. The mic signal is analysed in memory and thrown away. Nothing is sent anywhere.
