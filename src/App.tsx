import { useEffect, type ReactNode } from 'react';
import { useLanguage } from './i18n';
import { useRoute } from './lib/router';
import { Home } from './screens/Home';
import { Diagnostics } from './screens/Diagnostics';
import { RangeFinder } from './screens/RangeFinder';
import { DroneMode } from './screens/DroneMode';
import { PitchMatch } from './screens/PitchMatch';
import { OctaveJump } from './screens/OctaveJump';
import { ScaleLadder } from './screens/ScaleLadder';
import { EarHub } from './screens/ear/EarHub';
import { HigherLower } from './screens/ear/HigherLower';
import { ScaleDegrees } from './screens/ear/ScaleDegrees';
import { Intervals } from './screens/ear/Intervals';
import { WhichOctave } from './screens/ear/WhichOctave';
import { NoteOfDay } from './screens/ear/NoteOfDay';
import { Session } from './screens/Session';
import { Scales } from './screens/Scales';
import { Progress } from './screens/Progress';
import { AudioGate } from './ui/AudioGate';
import { usePracticeClock } from './lib/practice';
import { Settings } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import { VoiceBreak } from './ui/VoiceBreak';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { isSettingsLoaded, useSettings } from './lib/settings';
import { mic, live, drone } from './audio';
import { keepAwake } from './lib/wakeLock';
import { discardRecording } from './audio/recorder';

const SCREENS: Record<string, () => ReactNode> = {
  '/diagnostics': () => <Diagnostics />,
  '/range': () => <RangeFinder />,
  '/drone': () => <DroneMode />,
  '/match': () => <PitchMatch />,
  '/octave': () => <OctaveJump />,
  '/ladder': () => <ScaleLadder />,
  '/ear/higher-lower': () => <HigherLower />,
  '/ear/degrees': () => <ScaleDegrees />,
  '/ear/intervals': () => <Intervals />,
  '/ear/octave': () => <WhichOctave />,
  '/ear/note-of-day': () => <NoteOfDay />,
  '/session': () => <Session />,
  '/scales': () => <Scales />,
};

export function App() {
  const route = useRoute();
  useLanguage();
  const s = useSettings();
  const screen = SCREENS[route];
  // practice time counts on every training screen (not the sound lab)
  usePracticeClock(!!screen && route !== '/diagnostics');

  // Back on Home: make sure mic tracks (orange indicator), drone and wake lock are off.
  useEffect(() => {
    if (!screen) {
      live.stop();
      mic.stop();
      drone.stop();
      discardRecording();
      void keepAwake(false);
    }
    window.scrollTo(0, 0);
  }, [screen]);

  const firstRun = isSettingsLoaded() && !s.onboarded && !s.range && route === '/';
  const top = (): ReactNode => {
    if (route === '/welcome' || firstRun) return <Onboarding />;
    if (!isSettingsLoaded() && route === '/') return null;
    if (route === '/ear') return <EarHub />;
    if (route === '/progress') return <Progress />;
    if (route === '/settings') return <Settings />;
    return <Home />;
  };
  // Voice break only where you sing (not on ear drills, which are silent).
  const singing = !!screen && !route.startsWith('/ear/') && route !== '/diagnostics';

  return (
    <div className="app">
      <ErrorBoundary resetKey={route}>
        {screen ? <AudioGate key={route}>{screen()}</AudioGate> : top()}
      </ErrorBoundary>
      {singing && <VoiceBreak />}
    </div>
  );
}
