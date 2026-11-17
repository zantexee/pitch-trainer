import { useEffect } from 'react';
import { useRoute } from './lib/router';
import { Home } from './screens/Home';
import { Diagnostics } from './screens/Diagnostics';
import { AudioGate } from './ui/AudioGate';
import { mic, live, drone } from './audio';
import { keepAwake } from './lib/wakeLock';

export function App() {
  const route = useRoute();

  // Leaving a singing screen: stop mic tracks (clears the orange indicator), drone and wake lock.
  useEffect(() => {
    if (route !== '/diagnostics') {
      live.stop();
      mic.stop();
      drone.stop();
      void keepAwake(false);
    }
  }, [route]);

  return (
    <div className="app">
      {route === '/diagnostics' ? (
        <AudioGate>
          <Diagnostics />
        </AudioGate>
      ) : (
        <Home />
      )}
    </div>
  );
}
