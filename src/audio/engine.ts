// The single AudioContext for the app, plus all the iOS Safari / home-screen
// PWA lifecycle handling:
//  * the context is created and resumed only inside a user tap,
//  * navigator.audioSession type is set when supported,
//  * on returning to the foreground we resume, verify the clock is actually
//    moving, recreate the context if it isn't (WebKit bug 291892), and as a
//    last resort ask for a tap,
//  * interruptions (calls, Siri, lock screen) surface as status changes.

export type EngineStatus = 'idle' | 'running' | 'suspended' | 'interrupted' | 'needs-tap';

type Listener = () => void;

const CLOCK_CHECK_MS = 300;

export class AudioEngine {
  ctx: AudioContext | null = null;
  /** Everything audible connects here. */
  input: GainNode | null = null;
  master: GainNode | null = null;
  limiter: DynamicsCompressorNode | null = null;
  private listeners = new Set<Listener>();
  private contextListeners = new Set<Listener>();
  private _status: EngineStatus = 'idle';
  private soundingUntil = 0;
  private sustained = new Set<symbol>();
  private _sessionType: AudioSessionType | 'unsupported' = navigator.audioSession ? navigator.audioSession.type : 'unsupported';
  /** Number of times the context had to be recreated (Diagnostics). */
  recreations = 0;
  lastError: string | null = null;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.recover();
    });
    window.addEventListener('pageshow', () => void this.recover());
  }

  get status(): EngineStatus {
    return this._status;
  }

  get sessionType(): string {
    return this._sessionType;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called when the AudioContext is replaced: anything holding nodes must rebuild. */
  onContextChange(fn: Listener): () => void {
    this.contextListeners.add(fn);
    return () => this.contextListeners.delete(fn);
  }

  private setStatus(s: EngineStatus) {
    if (s === this._status) return;
    this._status = s;
    this.listeners.forEach((l) => l());
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  setSessionType(type: AudioSessionType): void {
    if (!navigator.audioSession) return;
    try {
      navigator.audioSession.type = type;
      this._sessionType = navigator.audioSession.type;
    } catch (e) {
      this.lastError = `audioSession: ${String(e)}`;
    }
    this.emit();
  }

  private build(): void {
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const input = ctx.createGain();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    // Master limiter: catches peaks when several voices stack up.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    input.connect(master).connect(limiter).connect(ctx.destination);
    ctx.onstatechange = () => this.syncStatus();
    this.ctx = ctx;
    this.input = input;
    this.master = master;
    this.limiter = limiter;
  }

  private syncStatus() {
    const st = this.ctx?.state as AudioContextState | 'interrupted' | undefined;
    if (!st) return this.setStatus('idle');
    if (st === 'running') this.setStatus('running');
    else if (st === 'interrupted') this.setStatus('interrupted');
    else if (st === 'suspended') this.setStatus(this._status === 'needs-tap' ? 'needs-tap' : 'suspended');
    else this.setStatus('idle');
  }

  /** Must be called from a tap/click handler. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this._sessionType !== 'unsupported' && this._sessionType !== 'play-and-record') this.setSessionType('playback');
    if (!this.ctx || this.ctx.state === 'closed') this.build();
    // iOS: unlock by playing a one-sample silent buffer inside the gesture.
    this.unlockBlip();
    try {
      await this.ctx!.resume();
    } catch (e) {
      this.lastError = String(e);
    }
    if (!(await this.clockMoving())) {
      await this.recreate();
    }
    this.syncStatus();
    if (this.ctx?.state !== 'running') this.setStatus('needs-tap');
  }

  private unlockBlip() {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }

  private clockMoving(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(false);
    const t0 = ctx.currentTime;
    return new Promise((res) => setTimeout(() => res(ctx.state === 'running' && ctx.currentTime > t0), CLOCK_CHECK_MS));
  }

  /** Close and rebuild the context. Listeners must reattach their nodes. */
  async recreate(): Promise<void> {
    const old = this.ctx;
    this.ctx = null;
    this.sustained.clear();
    this.soundingUntil = 0;
    try {
      await old?.close();
    } catch {
      /* already closed */
    }
    this.build();
    this.recreations++;
    try {
      await this.ctx!.resume();
    } catch (e) {
      this.lastError = String(e);
    }
    this.contextListeners.forEach((l) => l());
    this.syncStatus();
  }

  /** Back in the foreground (or after an interruption): get sound working again. */
  async recover(): Promise<void> {
    if (!this.ctx || this._status === 'idle') return;
    try {
      await this.ctx.resume();
    } catch {
      /* will be handled below */
    }
    if (await this.clockMoving()) return this.syncStatus();
    await this.recreate();
    if (await this.clockMoving()) return this.syncStatus();
    this.setStatus('needs-tap');
  }

  /** From the "Tap to resume audio" overlay. */
  async tapResume(): Promise<void> {
    this._status = 'suspended';
    await this.start();
  }

  // ---- "is the app making sound?" (the mic ignores itself while it is) ----

  markSounding(untilCtxTime: number): void {
    this.soundingUntil = Math.max(this.soundingUntil, untilCtxTime);
  }

  holdSounding(): symbol {
    const id = Symbol('sustain');
    this.sustained.add(id);
    return id;
  }

  releaseSounding(id: symbol, untilCtxTime: number): void {
    this.sustained.delete(id);
    this.markSounding(untilCtxTime);
  }

  private openFrom = 0;
  private openTo = 0;

  /** Let the mic listen in [from, to] (context time) even though a sustained sound is held — used by duck-and-check. */
  openListenWindow(from: number, to: number): void {
    this.openFrom = from;
    this.openTo = to;
  }

  /** True while the app is audible, plus `tailS` for room echo. */
  isSounding(tailS = 0.2): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (now >= this.openFrom && now <= this.openTo) return false;
    return this.sustained.size > 0 || now < this.soundingUntil + tailS;
  }
}

export const engine = new AudioEngine();
