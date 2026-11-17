import { useEffect, type ReactNode } from 'react';
import { useRoute } from './lib/router';
import { Home } from './screens/Home';
import { Diagnostics } from './screens/Diagnostics';
import { RangeFinder } from './screens/RangeFinder';
import { DroneMode } from './screens/DroneMode';
import { PitchMatch } from './screens/PitchMatch';
import { AudioGate } from './ui/AudioGate';
import { mic, live, drone } from './audio';
import { keepAwake } from './lib/wakeLock';
import { discardRecording } from './audio/recorder';

const SCREENS: Record<string, () => ReactNode> = {
  '/diagnostics': () => <Diagnostics />,
  '/range': () => <RangeFinder />,
  '/drone': () => <DroneMode />,
  '/match': () => <PitchMatch />,
};

export function App() {
  const route = useRoute();
  const screen = SCREENS[route];

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

  return <div className="app">{screen ? <AudioGate key={route}>{screen()}</AudioGate> : <Home />}</div>;
}
