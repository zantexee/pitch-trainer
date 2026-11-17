# Pitch Trainer

A pitch-training Progressive Web App for iPhone (and desktop): singing pitch with live mic feedback, plus silent ear-training drills. No backend, no accounts, no analytics. Audio is never uploaded or kept.

**Status: Milestone 0, the audio foundation.** It has the tap-to-start audio gate, five synthesised timbres plus a drone, mic input with pitch detection and smoothing, and a Diagnostics screen. Training modes come in M1 to M5 (see [Roadmap](#roadmap)).

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
| 15 | Leaving Diagnostics clears the orange mic indicator | | | |

Already checked in desktop Chromium (headless, fake mic fed a C3 tone): the audio gate, all timbres and the drone run without errors, the mic reads C3 at 130.81 Hz with clarity 1.00, and the constraints table fills in.

## Roadmap

- **M0 (this):** audio foundation, Diagnostics, tests, PWA + deploy.
- **M1:** voice range finder, Drone mode, Pitch Match, shared feedback UI.
- **M2:** Octave Jump, Scale Ladder.
- **M3:** ear-only drills.
- **M4:** one-tap Start / Daily Mix, adaptive difficulty, weak-spot targeting, streaks, progress screens, surprises.
- **M5:** polish, onboarding, vocal-health prompts, settings, export/import, accessibility.

## Privacy

Everything stays on the device in IndexedDB. The mic signal is analysed in memory and thrown away. Nothing is sent anywhere.
