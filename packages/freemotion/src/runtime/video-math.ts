export type SourceTimeOptions = {
  readonly trimBefore?: number;
  readonly playbackRate?: number;
  readonly frame: number;
  readonly fps: number;
};

/**
 * Calculates the source video time in seconds for a given composition frame.
 * Formula: trimBefore / fps + frame * playbackRate / fps
 */
export function sourceTime({
  trimBefore = 0,
  playbackRate = 1,
  frame,
  fps,
}: SourceTimeOptions): number {
  if (typeof playbackRate !== 'number' || Number.isNaN(playbackRate) || playbackRate < 0.25 || playbackRate > 16) {
    throw new Error(`freemotion: <Video> playbackRate must be between 0.25 and 16, got ${playbackRate}.`);
  }
  if (typeof trimBefore !== 'number' || !Number.isInteger(trimBefore) || trimBefore < 0) {
    throw new Error(`freemotion: <Video> trimBefore must be a non-negative integer, got ${trimBefore}.`);
  }
  return Math.max(0, trimBefore / fps + (frame * playbackRate) / fps);
}
