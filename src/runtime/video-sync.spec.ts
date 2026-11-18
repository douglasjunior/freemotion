import { describe, expect, it } from 'vitest';

import { planVideoSync } from './video-sync.js';


describe('planVideoSync', () => {
  const fps = 30; // frameDuration = ~0.0333s

  it('does not seek during playback when drift is less than 1 frame', () => {
    // 0.02s drift < 1/30s (0.0333s)
    expect(planVideoSync({ playing: true, current: 1.0, target: 1.02, fps })).toBe('none');
    expect(planVideoSync({ playing: true, current: 1.02, target: 1.0, fps })).toBe('none');
  });

  it('seeks during playback when drift exceeds 1 frame', () => {
    // 0.05s drift > 1/30s (0.0333s)
    expect(planVideoSync({ playing: true, current: 1.0, target: 1.05, fps })).toBe('seek');
    expect(planVideoSync({ playing: true, current: 1.05, target: 1.0, fps })).toBe('seek');
  });

  it('seeks when paused with 1 frame difference', () => {
    expect(planVideoSync({ playing: false, current: 1.0, target: 1.0 + 1 / fps, fps })).toBe('seek');
    expect(planVideoSync({ playing: false, current: 1.0 + 1 / fps, target: 1.0, fps })).toBe('seek');
  });

  it('does not start a seek when one is already pending', () => {
    expect(planVideoSync({ playing: true, current: 1.0, target: 2.0, fps, pendingSeek: true })).toBe('none');
    expect(planVideoSync({ playing: false, current: 1.0, target: 2.0, fps, pendingSeek: true })).toBe('none');
  });

  it('returns play when playing and paused with minimal drift', () => {
    expect(planVideoSync({ playing: true, current: 1.0, target: 1.01, fps, paused: true })).toBe('play');
  });

  it('returns pause when not playing and element is not paused', () => {
    expect(planVideoSync({ playing: false, current: 1.0, target: 1.0, fps, paused: false })).toBe('pause');
  });

  it('does not seek when paused if drift is less than half a frame', () => {
    // 0.01s drift < 0.5 * 1/30s (0.0166s)
    expect(planVideoSync({ playing: false, current: 1.0, target: 1.01, fps })).toBe('none');
  });
});
