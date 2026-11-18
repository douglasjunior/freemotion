/**
 * Calculates the exact source frame index from a presentation time and source frame rate.
 * Rounds to nearest integer and clamps to 0.
 */
export function sourceFrameIndex(time: number, fps: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(time * fps));
}

/**
 * Calculates the presentation time in seconds for a given source frame index.
 */
export function sourceTimeFromIndex(frameIndex: number, fps: number): number {
  if (!Number.isFinite(frameIndex) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }
  return Math.max(0, frameIndex) / fps;
}
