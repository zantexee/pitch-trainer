import { useEffect, useState } from 'react';
import { useSettings } from '../lib/settings';
import { useSingingMic } from '../modules/useSingingMic';
import { MicGate } from '../ui/MicGate';
import { PitchTrace } from '../ui/PitchTrace';

// 60-second warm-up: gentle semi-occluded sirens. No scoring, just the trace.

const CUES = [
  { title: 'Lip trills', text: 'Lips loose, "brrr", glide slowly up and back down.' },
  { title: '"Oo" siren', text: 'Through a straw or tight "oo" lips, slide gently from low to high and back.' },
  { title: 'Easy hum', text: 'Hum "mm" on a comfortable note, then little slides around it.' },
];

export function WarmUp() {
  const s = useSettings();
  const mic = useSingingMic();
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % CUES.length), 20_000);
    return () => clearInterval(id);
  }, []);
  const cue = CUES[i];
  return (
    <main className="screen">
      <MicGate status={mic.status} error={mic.error}>
        <section className="card">
          <h3>{cue.title}</h3>
          <p className="instruction" aria-live="polite">
            {cue.text}
          </p>
          <PitchTrace a4={s.a4} seconds={6} height={220} />
          <p className="muted small">Keep it light and quiet. No scoring here.</p>
        </section>
      </MicGate>
    </main>
  );
}
