import { describe, expect, it } from 'vitest';

import { planVideoSync } from './video-sync.js';


describe('planVideoSync', () => {
  const fps = 30; // frameDuration = ~0.0333s

  it('does not seek during playback when drift is less than 1 frame', () => {
    // 0.02s drift < 1/30s (0.0333s)
    expect(planVideoSync({ playing: true, current: 1.0, target: 1.02, fps })).toEqual({
      play: false,
      pause: false,
      seek: false,
      queueSeek: false,
    });
    expect(planVideoSync({ playing: true, current: 1.02, target: 1.0, fps })).toEqual({
      play: false,
      pause: false,
      seek: false,
      queueSeek: false,
    });
  });

  it('seeks during playback when drift exceeds 1 frame', () => {
    // 0.05s drift > 1/30s (0.0333s)
    expect(planVideoSync({ playing: true, current: 1.0, target: 1.05, fps })).toMatchObject({
      seek: true,
      queueSeek: false,
    });
    expect(planVideoSync({ playing: true, current: 1.05, target: 1.0, fps })).toMatchObject({
      seek: true,
      queueSeek: false,
    });
  });

  it('seeks when paused with 1 frame difference', () => {
    expect(planVideoSync({ playing: false, current: 1.0, target: 1.0 + 1 / fps, fps })).toMatchObject({
      seek: true,
      queueSeek: false,
    });
    expect(planVideoSync({ playing: false, current: 1.0 + 1 / fps, target: 1.0, fps })).toMatchObject({
      seek: true,
      queueSeek: false,
    });
  });

  it('does not start a seek when one is already pending and queues target during scrub', () => {
    // During playback, pending seek suppresses seek and does not queue
    expect(planVideoSync({ playing: true, current: 1.0, target: 2.0, fps, pendingSeek: true })).toMatchObject({
      seek: false,
      queueSeek: false,
    });

    // During scrub, pending seek suppresses immediate seek and queues the target
    expect(planVideoSync({ playing: false, current: 1.0, target: 2.0, fps, pendingSeek: true })).toMatchObject({
      seek: false,
      queueSeek: true,
    });
  });

  it('returns play when playing and paused with minimal drift', () => {
    expect(planVideoSync({ playing: true, current: 1.0, target: 1.01, fps, paused: true })).toEqual({
      play: true,
      pause: false,
      seek: false,
      queueSeek: false,
    });
  });

  it('returns pause when not playing and element is not paused', () => {
    expect(planVideoSync({ playing: false, current: 1.0, target: 1.0, fps, paused: false })).toEqual({
      play: false,
      pause: true,
      seek: false,
      queueSeek: false,
    });
  });

  it('returns both pause and seek when stopping playback with drift', () => {
    expect(planVideoSync({ playing: false, current: 1.0, target: 1.5, fps, paused: false })).toEqual({
      play: false,
      pause: true,
      seek: true,
      queueSeek: false,
    });
  });

  it('does not seek when paused if drift is less than half a frame', () => {
    // 0.01s drift < 0.5 * 1/30s (0.0166s)
    expect(planVideoSync({ playing: false, current: 1.0, target: 1.01, fps })).toEqual({
      play: false,
      pause: false,
      seek: false,
      queueSeek: false,
    });
  });
});
