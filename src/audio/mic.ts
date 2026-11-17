import type { AudioEngine } from './engine';

// Microphone input. Echo cancellation, noise suppression and auto gain are
// requested OFF because they mangle sustained tones. iOS may ignore some of
// these, so we report what the track actually applied.

export const REQUESTED_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const;

export interface MicInfo {
  label: string;
  deviceId: string;
  settings: MediaTrackSettings;
  requested: MediaTrackConstraints;
}

export const BUFFER_SIZE = 4096;

export class Mic {
  private engine: AudioEngine;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sink: GainNode | null = null;
  readonly buffer = new Float32Array(BUFFER_SIZE);
  info: MicInfo | null = null;
  private deviceId: string | undefined;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  get active(): boolean {
    return !!this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live');
  }

  async start(deviceId?: string): Promise<MicInfo> {
    this.stop(false);
    this.deviceId = deviceId;
    // iOS: must be play-and-record *before* getUserMedia, or output volume can drop.
    this.engine.setSessionType('play-and-record');
    // Try the full request first, then progressively looser ones. Safari can
    // throw OverconstrainedError for a stale saved deviceId (ids change
    // between sessions) or for constraints the device can't satisfy.
    const attempts: MediaTrackConstraints[] = [];
    const base: MediaTrackConstraints = { ...REQUESTED_CONSTRAINTS };
    if (deviceId) attempts.push({ ...base, deviceId: { ideal: deviceId } });
    attempts.push({ ...base });
    attempts.push({ echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false } });
    attempts.push({});
    let stream: MediaStream | null = null;
    let requested: MediaTrackConstraints = {};
    let lastErr: unknown;
    for (const c of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: Object.keys(c).length ? c : true });
        requested = c;
        break;
      } catch (e) {
        lastErr = e;
        // Permission denied or no mic: looser constraints won't help.
        if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'SecurityError')) throw e;
      }
    }
    if (!stream) throw lastErr;
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    this.attach();
    this.info = { label: track.label || 'Microphone', deviceId: track.getSettings().deviceId ?? '', settings: track.getSettings(), requested };
    return this.info;
  }

  /** (Re)connect the stream to the current AudioContext, e.g. after the context was recreated. */
  attach(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.stream) return;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.sink?.disconnect();
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = BUFFER_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    // Some browsers only pull audio through nodes that reach the destination.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.analyser).connect(this.sink).connect(ctx.destination);
  }

  /** Latest BUFFER_SIZE samples (shared buffer, overwritten on each call). */
  read(): Float32Array | null {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.buffer);
    return this.buffer;
  }

  /** Stop the tracks (clears the orange mic indicator). */
  stop(restoreSession = true): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.sink?.disconnect();
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.sink = null;
    if (restoreSession) this.engine.setSessionType('playback');
  }

  async restart(): Promise<MicInfo> {
    return this.start(this.deviceId);
  }

  static async listInputs(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }
}
