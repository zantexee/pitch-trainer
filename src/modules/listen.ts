import { engine, live, mic } from '../audio';
import { playChime } from '../audio/synth';
import { startRecording } from '../audio/recorder';
import { LiveAttempt, type AttemptLive, type AttemptOptions } from '../pitch/attempt';
import type { AttemptScore } from '../pitch/scoring';

// One listening window: feed live pitch into a LiveAttempt until the singer
// locks (plus a short tail), stops singing, or time runs out.

export interface ListenOptions extends AttemptOptions {
  /** Give up after this long without a lock (ms). */
  maxMs: number;
  /** After the voice has been heard, this much silence ends the attempt (ms). */
  silenceEndMs?: number;
  /** Keep listening this long after the lock (ms) so the trace looks complete. */
  afterLockMs?: number;
  /** End once the voice has been heard for this long, locked or not (ms). */
  maxVoicedMs?: number;
  /** Stop as soon as locked (default true). */
  stopOnLock?: boolean;
  chime?: boolean;
  record?: boolean;
  signal?: AbortSignal;
  onUpdate?: (s: AttemptLive, attempt: LiveAttempt) => void;
}

export interface ListenResult {
  attempt: LiveAttempt;
  score: AttemptScore;
  recordingUrl: string | null;
  aborted: boolean;
}

export function listen(targetHz: number, o: ListenOptions): Promise<ListenResult> {
  const attempt = new LiveAttempt(targetHz, o);
  const silenceEnd = o.silenceEndMs ?? 700;
  const afterLock = o.afterLockMs ?? 350;
  const stopOnLock = o.stopOnLock ?? true;
  const rec = o.record ? startRecording(mic.mediaStream) : null;
  live.target = targetHz;
  const t0 = performance.now();
  let heardAt: number | null = null;
  let lastVoiced = 0;

  return new Promise((resolve) => {
    let done = false;
    const finish = async (aborted: boolean) => {
      if (done) return;
      done = true;
      unsub();
      clearInterval(timer);
      o.signal?.removeEventListener('abort', onAbort);
      live.target = null;
      const recordingUrl = rec ? await rec.stop() : null;
      resolve({ attempt, score: attempt.finish(), recordingUrl, aborted });
    };
    const onAbort = () => void finish(true);
    o.signal?.addEventListener('abort', onAbort);

    const unsub = live.subscribe((f) => {
      if (f.ignored) return;
      const s = attempt.push(f.t, f.out.freq);
      if (s.voiced) {
        heardAt ??= f.t;
        lastVoiced = f.t;
      }
      if (s.justLocked && (o.chime ?? true)) playChime(engine);
      o.onUpdate?.(s, attempt);
    });
    const timer = setInterval(() => {
      const now = performance.now();
      if (attempt.locked && stopOnLock && attempt.lockedAt != null && now - t0 > attempt.lockedAt + afterLock) return void finish(false);
      if (heardAt != null && now - lastVoiced > silenceEnd) return void finish(false);
      if (o.maxVoicedMs != null && heardAt != null && now - heardAt > o.maxVoicedMs) return void finish(false);
      if (now - t0 > o.maxMs) return void finish(false);
    }, 30);
  });
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const id = setTimeout(res, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      rej(new DOMException('aborted', 'AbortError'));
    });
  });
