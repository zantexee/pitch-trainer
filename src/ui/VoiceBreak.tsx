import { go } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { singingToday, usePractice } from '../lib/practice';
import { dateKey } from '../engine/dates';

// "Voice break?" after N minutes of singing today. Snooze adds 10 minutes.

const SNOOZE_S = 600;

export function VoiceBreak() {
  const s = useSettings();
  const p = usePractice();
  if (!s.voiceBreakMin) return null;
  const today = dateKey();
  const sung = singingToday(p);
  const threshold = s.voiceBreak?.date === today ? s.voiceBreak.snoozeAt : s.voiceBreakMin * 60;
  if (sung < threshold) return null;
  const mins = Math.round(sung / 60);
  return (
    <div className="overlay soft" role="dialog" aria-label="Voice break">
      <div className="card center">
        <h3>Voice break?</h3>
        <p>You've sung about {mins} minutes today. A rest now helps your voice tomorrow.</p>
        <p className="muted small">Stop if it hurts or you get hoarse. Silent ear drills don't use your voice.</p>
        <div className="stack">
          <button className="btn primary big" onClick={() => (updateSettings({ voiceBreak: { date: today, snoozeAt: sung + 24 * 3600 } }), go('/'))}>
            Rest now
          </button>
          <button className="btn" onClick={() => (updateSettings({ silentMode: true, voiceBreak: { date: today, snoozeAt: sung + 24 * 3600 } }), go('/ear'))}>
            Switch to ear drills
          </button>
          <button className="btn ghost" onClick={() => updateSettings({ voiceBreak: { date: today, snoozeAt: sung + SNOOZE_S } })}>
            10 more minutes
          </button>
        </div>
      </div>
    </div>
  );
}
