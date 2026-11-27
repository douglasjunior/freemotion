/** `45s`, `12m 05s` or `2h 14m`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  }
  return `${rest}s`;
}

export type Rate = {
  /** Frames per second over the recent past. */
  readonly perSecond: number;
  /** Seconds left at that rate. */
  readonly etaSeconds: number;
};

/**
 * Estimates the speed of a render from its last `windowMs` of progress. A window, and not the average
 * since the start, because the speed changes along a video: a heavy stretch should not drag the
 * estimate of the light stretch after it for the rest of the render.
 */
export function createRateTracker({ windowMs = 30_000, minSpanMs = 1000 }: { readonly windowMs?: number; readonly minSpanMs?: number } = {}) {
  const samples: { time: number; done: number }[] = [];
  return {
    /** Records progress and returns the estimate, or null while there is too little to go on. */
    update(time: number, done: number, total: number): Rate | null {
      samples.push({ time, done });
      while (samples.length > 2 && time - samples[1]!.time >= windowMs) {
        samples.shift();
      }
      const first = samples[0]!;
      const span = time - first.time;
      const frames = done - first.done;
      if (span < minSpanMs || frames <= 0 || done >= total) {
        return null;
      }
      const perSecond = frames / (span / 1000);
      return { perSecond, etaSeconds: (total - done) / perSecond };
    },
  };
}

/** The speed and time left, as shown after the frame count: `4.2 fps · ETA 2h 14m`. */
export function describeRate({ perSecond, etaSeconds }: Rate): string {
  const fps = perSecond >= 10 ? perSecond.toFixed(0) : perSecond.toFixed(1);
  return `${fps} fps · ETA ${formatDuration(etaSeconds)}`;
}
