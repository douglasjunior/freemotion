export type AudioTargetTimeOptions = {
  readonly frame: number;
  readonly fps: number;
  readonly trimBefore?: number;
  readonly trimAfter?: number;
  readonly playbackRate?: number;
  readonly loop?: boolean;
  readonly duration?: number;
};

/**
 * Calculates the target playback time in seconds for an audio track.
 * Formula: trimBefore / fps + frame * playbackRate / fps
 * With loop: modulo of available loop duration (trimAfter - trimBefore, or audio duration - trimBefore).
 */
export function audioTargetTime({
  frame,
  fps,
  trimBefore = 0,
  trimAfter,
  playbackRate = 1,
  loop = false,
  duration,
}: AudioTargetTimeOptions): number {
  const trimBeforeSec = trimBefore / fps;
  const elapsedSec = (frame * playbackRate) / fps;

  if (loop) {
    if (trimAfter !== undefined) {
      const loopDuration = Math.max(0, (trimAfter - trimBefore) / fps);
      return loopDuration > 0 ? trimBeforeSec + (elapsedSec % loopDuration) : trimBeforeSec;
    }
    if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
      const available = Math.max(0, duration - trimBeforeSec);
      return available > 0 ? trimBeforeSec + (elapsedSec % available) : trimBeforeSec;
    }
  }

  return trimBeforeSec + elapsedSec;
}

/**
 * Evaluates the volume of an audio track for a specific frame, clamped between 0 and 1.
 * Supports static numbers or dynamic functions: (frame: number) => number.
 */
export function evaluateAudioVolume(
  volume: number | ((frame: number) => number) | undefined,
  frame: number,
): number {
  if (volume === undefined) {
    return 1;
  }
  const raw = typeof volume === 'function' ? volume(frame) : volume;
  if (typeof raw !== 'number' || Number.isNaN(raw)) {
    return 1;
  }
  return Math.min(1, Math.max(0, raw));
}

export type PlanAudioSyncOptions = {
  readonly playing: boolean;
  readonly current: number;
  readonly target?: number;
  readonly frame?: number;
  readonly fps?: number;
  readonly trimBefore?: number;
  readonly trimAfter?: number;
  readonly playbackRate?: number;
  readonly loop?: boolean;
  readonly duration?: number;
  readonly frozen?: boolean;
  readonly premounting?: boolean;
  readonly paused?: boolean;
};

export type AudioSyncPlan = {
  readonly target: number;
  readonly play: boolean;
  readonly pause: boolean;
  readonly seek: boolean;
  readonly silent: boolean;
};

const DRIFT_TOLERANCE = 0.1; // 100ms tolerance to avoid pops and clicks

/**
 * Pure function planning audio element synchronization actions for preview playback.
 * - When playing:
 *   - Starts playback if paused.
 *   - Corrects drift via seek only when discrepancy exceeds 0.1s.
 * - When stopped/scrubbing:
 *   - Pauses and silences playback.
 * - Respects trimAfter, loop modulo, frozen, and premounting states.
 */
export function planAudioSync({
  playing,
  current,
  target: explicitTarget,
  frame = 0,
  fps = 30,
  trimBefore = 0,
  trimAfter,
  playbackRate = 1,
  loop = false,
  duration,
  frozen = false,
  premounting = false,
  paused,
}: PlanAudioSyncOptions): AudioSyncPlan {
  const target = explicitTarget !== undefined
    ? explicitTarget
    : audioTargetTime({ frame, fps, trimBefore, trimAfter, playbackRate, loop, duration });

  const isPastTrimAfter = trimAfter !== undefined && !loop && target >= (trimAfter / fps);
  const pastEnd = !loop && duration !== undefined && Number.isFinite(duration) && duration > 0 && target >= duration;
  const silent = Boolean(frozen || premounting || !playing || isPastTrimAfter || pastEnd);

  const drift = Math.abs(current - target);
  const driftExceeded = drift > DRIFT_TOLERANCE;

  let play = false;
  let pause = false;
  let seek = false;

  if (silent) {
    play = false;
    pause = paused !== true;
    seek = !pastEnd && driftExceeded;
  } else {
    play = paused !== false;
    pause = false;
    seek = driftExceeded;
  }

  return { target, play, pause, seek, silent };
}
