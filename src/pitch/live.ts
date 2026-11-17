import type { AudioEngine } from '../audio/engine';
import type { Mic } from '../audio/mic';
import { Detector, type Frame } from './detector';
import { PitchTracker, type TrackerOutput } from './tracker';

// Runs detector + tracker on the live mic about 60 times a second
// (requestAnimationFrame, so it pauses automatically when the app is hidden).

export interface LiveFrame {
  /** performance.now() ms */
  t: number;
  frame: Frame | null;
  out: TrackerOutput;
  /** true when the app itself was sounding and the mic was ignored */
  ignored: boolean;
  /** sound is loud enough but too irregular to read (fry, strohbass, noise) for > 0.5 s */
  unreadable: boolean;
}

type Listener = (f: LiveFrame) => void;

const MIN_INTERVAL_MS = 15;
const UNREADABLE_MS = 500;

export class LivePitch {
  readonly detector: Detector;
  readonly tracker = new PitchTracker();
  /** Target frequency (Hz) – chooses the analysis window. */
  target: number | null = null;
  windowOverride: 2048 | 4096 | null = null;
  ignoreWhileSounding = true;
  private engine: AudioEngine;
  private mic: Mic;
  private raf = 0;
  private lastT = 0;
  private unclearSince: number | null = null;
  private listeners = new Set<Listener>();
  last: LiveFrame | null = null;

  constructor(engine: AudioEngine, mic: Mic, detector = new Detector()) {
    this.engine = engine;
    this.mic = mic;
    this.detector = detector;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  start(): void {
    if (this.raf) return;
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (now - this.lastT < MIN_INTERVAL_MS) return;
      this.lastT = now;
      this.step(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.tracker.reset();
    this.unclearSince = null;
  }

  private step(now: number): void {
    const buf = this.mic.read();
    const sr = this.engine.sampleRate;
    let frame: Frame | null = null;
    let ignored = false;
    if (buf && sr) {
      if (this.ignoreWhileSounding && this.engine.isSounding()) {
        ignored = true;
      } else {
        const hint = this.target ?? this.tracker.current;
        frame = this.detector.analyze(buf, sr, hint, this.windowOverride ?? undefined);
      }
    }
    const out = this.tracker.push(now, frame?.freq ?? null);
    if (frame && frame.reject === 'unclear') {
      this.unclearSince ??= now;
    } else if (frame?.freq != null || frame?.reject === 'quiet' || ignored) {
      this.unclearSince = null;
    }
    const lf: LiveFrame = {
      t: now,
      frame,
      out,
      ignored,
      unreadable: this.unclearSince != null && now - this.unclearSince > UNREADABLE_MS && out.freq == null,
    };
    this.last = lf;
    this.listeners.forEach((l) => l(lf));
  }
}
