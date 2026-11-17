// Safari 16.4+ Audio Session API (not yet in lib.dom).
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';

interface AudioSession extends EventTarget {
  type: AudioSessionType;
  readonly state?: 'inactive' | 'active' | 'interrupted';
}

interface Navigator {
  readonly audioSession?: AudioSession;
}
