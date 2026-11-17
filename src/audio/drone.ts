import type { AudioEngine } from './engine';
import { playNote, type Timbre, type Voice } from './synth';

// Sustained pad / drone. Root only, root + fifth, or root + octave.
// Has its own gain stage for volume and for duck-and-check (drop out briefly
// so the mic can hear the singer when there are no headphones).

export type DroneMode = 'root' | 'fifth' | 'octave';

export interface DroneOptions {
  timbre: Timbre;
  mode: DroneMode;
  /** 0..1 */
  volume: number;
  a4: number;
  /** With headphones the mic keeps listening while the drone plays. */
  headphones: boolean;
}

export class Drone {
  private voices: Voice[] = [];
  private bus: GainNode | null = null;
  private engine: AudioEngine;
  midi: number | null = null;
  swapped = false;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  get playing(): boolean {
    return this.voices.length > 0;
  }

  start(midi: number, o: DroneOptions): void {
    this.stop();
    const ctx = this.engine.ctx;
    if (!ctx || !this.engine.input) return;
    const bus = ctx.createGain();
    bus.gain.value = o.volume;
    bus.connect(this.engine.input);
    this.bus = bus;
    this.midi = midi;
    const notes = [midi];
    if (o.mode === 'fifth') notes.push(midi + 7);
    if (o.mode === 'octave') notes.push(midi + 12);
    const each = notes.length === 1 ? 0.8 : 0.6;
    this.voices = notes.map((m) => {
      const v = playNote(this.engine, m, o.a4, { timbre: o.timbre, velocity: each, destination: bus, blocksMic: !o.headphones });
      if (m === midi) this.swapped = v.swapped;
      return v;
    });
  }

  setVolume(v: number): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.bus) return;
    this.bus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  /**
   * Duck-and-check: fade out over 50 ms, stay silent for `gapS`, fade back.
   * Returns the context-time window in which the mic can listen cleanly
   * (after the fade and the room tail).
   */
  duck(gapS = 0.6, volume = 0.6): { listenFrom: number; listenTo: number } | null {
    const ctx = this.engine.ctx;
    if (!ctx || !this.bus) return null;
    const t = ctx.currentTime;
    const g = this.bus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.05);
    g.setValueAtTime(0, t + 0.05 + gapS);
    g.linearRampToValueAtTime(volume, t + 0.1 + gapS);
    return { listenFrom: t + 0.05 + 0.2, listenTo: t + 0.05 + gapS };
  }

  stop(): void {
    this.voices.forEach((v) => v.stop());
    const bus = this.bus;
    if (bus) setTimeout(() => bus.disconnect(), 2000);
    this.voices = [];
    this.bus = null;
    this.midi = null;
  }
}
