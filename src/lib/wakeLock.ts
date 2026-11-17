// Screen Wake Lock during sessions, where supported (Safari 16.4+).
// The lock is dropped by the browser when the page is hidden, so we re-request
// on return.

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export const wakeLockSupported = () => 'wakeLock' in navigator;

async function acquire() {
  if (!wanted || !wakeLockSupported() || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => void acquire());

export async function keepAwake(on: boolean): Promise<void> {
  wanted = on;
  if (on) await acquire();
  else {
    await sentinel?.release().catch(() => {});
    sentinel = null;
  }
}

export const wakeLockActive = () => !!sentinel;
