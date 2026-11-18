export type VideoSyncAction = 'play' | 'seek' | 'pause' | 'none';

export type PlanVideoSyncOptions = {
  readonly playing: boolean;
  readonly current: number;
  readonly target: number;
  readonly fps: number;
  readonly pendingSeek?: boolean;
  readonly paused?: boolean;
};

/**
 * Plans the next synchronization action for an HTML video element in preview mode.
 * - When a seek is in flight, does not start another ('none').
 * - When playing, checks drift (|current - target|). If drift > 1 frame, seeks.
 *   If paused and drift <= 1 frame, returns 'play'.
 * - When paused, seeks if drift >= 0.5 frame (half-frame threshold). If not paused, returns 'pause'.
 */
export function planVideoSync({
  playing,
  current,
  target,
  fps,
  pendingSeek = false,
  paused,
}: PlanVideoSyncOptions): VideoSyncAction {
  if (pendingSeek) {
    return 'none';
  }

  const frameDuration = 1 / fps;
  const drift = Math.abs(current - target);

  if (playing) {
    if (drift > frameDuration) {
      return 'seek';
    }
    if (paused === true) {
      return 'play';
    }
    return 'none';
  }

  // When paused / scrubbing
  const halfFrame = 0.5 * frameDuration;
  if (drift >= halfFrame) {
    return 'seek';
  }
  if (paused === false) {
    return 'pause';
  }
  return 'none';
}
