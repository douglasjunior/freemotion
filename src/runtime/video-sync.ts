export type PlanVideoSyncOptions = {
  readonly playing: boolean;
  readonly current: number;
  readonly target: number;
  readonly fps: number;
  readonly pendingSeek?: boolean;
  readonly paused?: boolean;
};

export type VideoSyncPlan = {
  readonly play: boolean;
  readonly pause: boolean;
  readonly seek: boolean;
  readonly queueSeek: boolean;
};

/**
 * Plans the next synchronization actions for an HTML video element in preview mode.
 * - When playback is running:
 *   - If the element is paused, schedules a play.
 *   - If drift exceeds 1 frame, schedules a seek (unless a seek is already pending).
 * - When stopped/scrubbing:
 *   - If the element is still playing, schedules a pause.
 *   - If drift exceeds half a frame, schedules a seek (or queues it if a seek is already pending).
 */
export function planVideoSync({
  playing,
  current,
  target,
  fps,
  pendingSeek = false,
  paused,
}: PlanVideoSyncOptions): VideoSyncPlan {
  const frameDuration = 1 / fps;
  const drift = Math.abs(current - target);

  let play = false;
  let pause = false;
  let seek = false;
  let queueSeek = false;

  if (playing) {
    if (paused === true) {
      play = true;
    }
    if (drift > frameDuration && !pendingSeek) {
      seek = true;
    }
  } else {
    if (paused === false) {
      pause = true;
    }
    const halfFrame = 0.5 * frameDuration;
    if (drift >= halfFrame) {
      if (pendingSeek) {
        queueSeek = true;
      } else {
        seek = true;
      }
    }
  }

  return { play, pause, seek, queueSeek };
}
