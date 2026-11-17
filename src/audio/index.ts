import { engine } from './engine';
import { Mic } from './mic';
import { Drone } from './drone';
import { LivePitch } from '../pitch/live';

// App-wide audio singletons.
export { engine };
export const mic = new Mic(engine);
export const drone = new Drone(engine);
export const live = new LivePitch(engine, mic);

// If iOS forces us to rebuild the AudioContext, move the mic onto the new one.
engine.onContextChange(() => {
  mic.attach();
});
