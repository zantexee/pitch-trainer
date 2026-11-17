import type { AudioEngine } from './engine';
import { noteToFreq } from '../lib/notes';

// Synthesised voices. No samples. Every envelope uses ramps / setTargetAtTime
// so nothing clicks.

export type Timbre = 'pad' | 'pure' | 'bright' | 'organ' | 'choir';

export const TIMBRES: { id: Timbre; label: string }[] = [
  { id: 'pad', label: 'Pad' },
  { id: 'pure', label: 'Pure' },
  { id: 'bright', label: 'Bright' },
  { id: 'organ', label: 'Organ' },
  { id: 'choir', label: 'Choir' },
];

/** Below E3 a phone speaker can barely reproduce the fundamental. */
export const LOW_NOTE_MIDI = 52;

/** For low notes, swap thin timbres for harmonically rich ones (the ear infers pitch from harmonics). */
export function resolveTimbre(timbre: Timbre, midi: number): { timbre: Timbre; swapped: boolean } {
  if (midi < LOW_NOTE_MIDI && timbre === 'pure') return { timbre: 'bright', swapped: true };
  return { timbre, swapped: false };
}

interface TimbreSpec {
  attack: number;
  release: number;
  gain: number;
}

const SPECS: Record<Timbre, TimbreSpec> = {
  pad: { attack: 0.6, release: 1.2, gain: 0.22 },
  pure: { attack: 0.02, release: 0.15, gain: 0.5 },
  bright: { attack: 0.015, release: 0.2, gain: 0.3 },
  organ: { attack: 0.03, release: 0.12, gain: 0.32 },
  choir: { attack: 0.25, release: 0.6, gain: 0.5 },
};

export interface NoteOptions {
  timbre?: Timbre;
  /** 0..1 loudness */
  velocity?: number;
  /** seconds; omit to sustain until stop() */
  duration?: number;
  /** AudioContext time to start; defaults to now */
  when?: number;
  attack?: number;
  release?: number;
  /** Destination node; defaults to the engine's main input. */
  destination?: AudioNode;
  /** Whether the mic should ignore input while this plays (default true). */
  blocksMic?: boolean;
}

export interface Voice {
  freq: number;
  startTime: number;
  /** Context time when the voice will be silent, or null while sustaining. */
  endTime: number | null;
  stop(at?: number): void;
  /** Smoothly change loudness (0..1 velocity scale). */
  setLevel(v: number, rampS?: number): void;
}

let organWave: PeriodicWave | null = null;
let organCtx: BaseAudioContext | null = null;
function getOrganWave(ctx: BaseAudioContext): PeriodicWave {
  if (organWave && organCtx === ctx) return organWave;
  // Drawbar-ish: 8', 4', 2 2/3', 2', 1 3/5' (harmonics 1,2,3,4,5) plus a little 6 and 8.
  const amps = [0, 1, 0.75, 0.5, 0.4, 0.2, 0.15, 0, 0.1];
  const real = new Float32Array(amps.length);
  const imag = new Float32Array(amps);
  organWave = ctx.createPeriodicWave(real, imag);
  organCtx = ctx;
  return organWave;
}

/** Build the oscillator graph for a timbre. Returns sources to start/stop and the output node. */
function buildTimbre(ctx: AudioContext, timbre: Timbre, freq: number): { sources: AudioScheduledSourceNode[]; out: AudioNode } {
  const nyq = ctx.sampleRate / 2 - 100;
  switch (timbre) {
    case 'pure': {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      return { sources: [o], out: o };
    }
    case 'bright': {
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.value = freq;
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = freq;
      const sawGain = ctx.createGain();
      sawGain.gain.value = 0.35;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(nyq, Math.max(1200, freq * 8));
      lp.Q.value = 0.5;
      tri.connect(lp);
      saw.connect(sawGain).connect(lp);
      return { sources: [tri, saw], out: lp };
    }
    case 'organ': {
      const o = ctx.createOscillator();
      o.setPeriodicWave(getOrganWave(ctx));
      o.frequency.value = freq;
      return { sources: [o], out: o };
    }
    case 'pad': {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      // Filter tracks the note: ~5x the fundamental, with a floor so low notes keep some harmonics.
      lp.frequency.value = Math.min(nyq, Math.max(600, freq * 5));
      lp.Q.value = 0.6;
      const sources: OscillatorNode[] = [];
      for (const detune of [-5, 0, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(lp);
        sources.push(o);
      }
      return { sources, out: lp };
    }
    case 'choir': {
      // Two detuned saws through "ah" formant band-passes, with gentle vibrato.
      const mix = ctx.createGain();
      const pre = ctx.createGain();
      const sources: AudioScheduledSourceNode[] = [];
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 8; // cents
      lfo.connect(lfoDepth);
      sources.push(lfo);
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = detune;
        lfoDepth.connect(o.detune);
        o.connect(pre);
        sources.push(o);
      }
      const formants: [number, number, number][] = [
        [800, 8, 1],
        [1150, 9, 0.5],
        [2900, 10, 0.25],
      ];
      for (const [f, q, g] of formants) {
        if (f >= nyq) continue;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const gn = ctx.createGain();
        gn.gain.value = g;
        pre.connect(bp).connect(gn).connect(mix);
      }
      // a little dry low end so the fundamental is present
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(nyq, freq * 2);
      const lpg = ctx.createGain();
      lpg.gain.value = 0.25;
      pre.connect(lp).connect(lpg).connect(mix);
      return { sources, out: mix };
    }
  }
}

function holdAt(param: AudioParam, t: number) {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
}

/** Play a frequency. Returns a handle; sustains until stop() when no duration is given. */
export function playFreq(engine: AudioEngine, freq: number, opts: NoteOptions = {}): Voice {
  const ctx = engine.ctx;
  if (!ctx || !engine.input) throw new Error('Audio not started');
  const timbre = opts.timbre ?? 'pure';
  const spec = SPECS[timbre];
  const attack = opts.attack ?? spec.attack;
  const release = opts.release ?? spec.release;
  const velocity = opts.velocity ?? 0.7;
  const t0 = Math.max(ctx.currentTime + 0.005, opts.when ?? 0);
  const blocksMic = opts.blocksMic ?? true;

  const { sources, out } = buildTimbre(ctx, timbre, freq);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  const peak = spec.gain * velocity;
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  out.connect(env).connect(opts.destination ?? engine.input);
  sources.forEach((s) => s.start(t0));

  let stopped = false;
  let sustainId: symbol | null = null;

  const voice: Voice = {
    freq,
    startTime: t0,
    endTime: null,
    stop(at?: number) {
      if (stopped) return;
      stopped = true;
      const t = Math.max(ctx.currentTime, at ?? ctx.currentTime);
      holdAt(env.gain, t);
      env.gain.setTargetAtTime(0, t, release / 5);
      const end = t + release + 0.05;
      sources.forEach((s) => {
        try {
          s.stop(end + 0.05);
        } catch {
          /* already stopped */
        }
      });
      voice.endTime = end;
      if (sustainId) engine.releaseSounding(sustainId, end);
      else if (blocksMic) engine.markSounding(end);
      setTimeout(() => env.disconnect(), (end - ctx.currentTime + 0.2) * 1000);
    },
    setLevel(v: number, rampS = 0.08) {
      if (stopped) return;
      const t = ctx.currentTime;
      holdAt(env.gain, t);
      env.gain.linearRampToValueAtTime(spec.gain * v, t + rampS);
    },
  };

  if (opts.duration != null) {
    const tEnd = t0 + Math.max(opts.duration, attack);
    if (blocksMic) engine.markSounding(tEnd + release);
    // schedule release
    env.gain.setValueAtTime(peak, tEnd);
    env.gain.setTargetAtTime(0, tEnd, release / 5);
    const end = tEnd + release + 0.05;
    sources.forEach((s) => s.stop(end + 0.05));
    voice.endTime = end;
    stopped = true; // fixed-length voices can still be cut short:
    voice.stop = (at?: number) => {
      const t = Math.max(ctx.currentTime, at ?? ctx.currentTime);
      if (t >= end) return;
      holdAt(env.gain, t);
      env.gain.setTargetAtTime(0, t, 0.02);
      sources.forEach((s) => {
        try {
          s.stop(t + 0.15);
        } catch {
          /* ignore */
        }
      });
      voice.endTime = t + 0.15;
    };
    setTimeout(() => env.disconnect(), (end - ctx.currentTime + 0.3) * 1000);
  } else if (blocksMic) {
    sustainId = engine.holdSounding();
  }

  return voice;
}

export function playNote(engine: AudioEngine, midi: number, a4: number, opts: NoteOptions = {}): Voice & { swapped: boolean } {
  const { timbre, swapped } = resolveTimbre(opts.timbre ?? 'pure', midi);
  const v = playFreq(engine, noteToFreq(midi, a4), { ...opts, timbre });
  return Object.assign(v, { swapped });
}

/** Short, soft two-partial bell for "locked". Doesn't block the mic for long. */
export function playChime(engine: AudioEngine): void {
  const ctx = engine.ctx;
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  for (const [f, g] of [
    [1318.5, 0.12],
    [1975.5, 0.06],
  ] as const) {
    playFreq(engine, f, { timbre: 'pure', duration: 0.05, attack: 0.005, release: 0.5, velocity: g / 0.5, when: t });
  }
}
