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

/** Opens the mic for a singing screen and closes it (orange dot off) on leave. */
export function useSingingMic(): { status: MicStatus; error: string | null } {
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
    let cancelled = false;
    (async () => {
      try {
        await mic.start(getSettings().inputDeviceId ?? undefined);
        if (cancelled) return;
        if (getSettings().noiseGate == null) {
          setStatus('calibrating');
          const gate = await calibrate();
          if (cancelled) return;
          updateSettings({ noiseGate: gate });
          live.detector.settings.noiseGate = gate;
        }
        live.start();
        void keepAwake(true);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      live.stop();
      mic.stop();
      void keepAwake(false);
    };
  }, []);

  return { status, error };
}
