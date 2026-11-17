import { useEffect, useState } from 'react';
import { live, mic } from '../audio';
import { calibrateNoiseGate, DEFAULT_DETECTOR_SETTINGS, rms } from '../pitch/detector';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { keepAwake } from '../lib/wakeLock';

export type MicStatus = 'starting' | 'calibrating' | 'ready' | 'error';

async function calibrate(): Promise<number> {
  const levels: number[] = [];
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const id = setInterval(() => {
      const buf = mic.read();
      if (buf) levels.push(rms(buf, buf.length - 2048));
      if (performance.now() - t0 > 2000) {
        clearInterval(id);
        res();
      }
    }, 25);
  });
  return calibrateNoiseGate(levels);
}

// Shared, reference-counted mic: the Daily Mix runner holds it open so it
// doesn't blink off and on between rounds.
let users = 0;
let gen = 0;
let opening: Promise<void> | null = null;

function acquire(onCalibrating: () => void): Promise<void> {
  users++;
  if (!opening) {
    const g = ++gen;
    opening = (async () => {
      await mic.start(getSettings().inputDeviceId ?? undefined);
      if (g !== gen) return;
      if (getSettings().noiseGate == null) {
        onCalibrating();
        const gate = await calibrate();
        if (g !== gen) return;
        updateSettings({ noiseGate: gate });
        live.detector.settings.noiseGate = gate;
      }
      live.start();
      void keepAwake(true);
    })();
    opening.catch(() => {
      if (g === gen) opening = null;
    });
  }
  return opening;
}

function release() {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  gen++;
  opening = null;
  live.stop();
  mic.stop();
  void keepAwake(false);
}

/** Opens the mic for a singing screen and closes it (orange dot off) on leave. */
export function useSingingMic(enabled = true): { status: MicStatus; error: string | null } {
  const s = useSettings();
  const [status, setStatus] = useState<MicStatus>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    live.detector.settings.noiseGate = s.noiseGate ?? DEFAULT_DETECTOR_SETTINGS.noiseGate;
  }, [s.noiseGate]);

  useEffect(() => {
    live.ignoreWhileSounding = !s.headphones;
  }, [s.headphones]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    acquire(() => !cancelled && setStatus('calibrating')).then(
      () => !cancelled && setStatus('ready'),
      (e) => {
        if (cancelled) return;
        setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        setStatus('error');
      },
    );
    return () => {
      cancelled = true;
      release();
    };
  }, [enabled]);

  return { status, error };
}
