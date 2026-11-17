// Records the current attempt in memory so you can hear yourself back.
// The recording is discarded (URL revoked) as soon as the next one starts or
// the screen closes. Nothing is stored or uploaded.

let current: string | null = null;

export function discardRecording(): void {
  if (current) URL.revokeObjectURL(current);
  current = null;
}

export interface Recording {
  stop(): Promise<string | null>;
}

export function startRecording(stream: MediaStream | null): Recording {
  discardRecording();
  if (!stream || typeof MediaRecorder === 'undefined') return { stop: async () => null };
  let rec: MediaRecorder;
  try {
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t));
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch {
    return { stop: async () => null };
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise((res) => {
        if (rec.state === 'inactive') return res(null);
        rec.onstop = () => {
          if (!chunks.length) return res(null);
          current = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }));
          res(current);
        };
        rec.stop();
      }),
  };
}

let player: HTMLAudioElement | null = null;
export function playRecording(url: string): void {
  player?.pause();
  player = new Audio(url);
  void player.play().catch(() => {});
}
