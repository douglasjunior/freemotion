import { describe, expect, it } from 'vitest';

import { sourceTime } from './video-math.js';


describe('sourceTime', () => {
  it('calculates time with defaults', () => {
    expect(sourceTime({ frame: 0, fps: 30 })).toBe(0);
    expect(sourceTime({ frame: 30, fps: 30 })).toBe(1);
    expect(sourceTime({ frame: 45, fps: 30 })).toBe(1.5);
  });

  it('accounts for trimBefore in composition frames', () => {
    expect(sourceTime({ trimBefore: 15, frame: 0, fps: 30 })).toBe(0.5);
    expect(sourceTime({ trimBefore: 150, frame: 0, fps: 30 })).toBe(5);
    expect(sourceTime({ trimBefore: 30, frame: 30, fps: 30 })).toBe(2);
  });

  it('accounts for playbackRate', () => {
    expect(sourceTime({ playbackRate: 2, frame: 15, fps: 30 })).toBe(1);
    expect(sourceTime({ playbackRate: 0.5, frame: 30, fps: 30 })).toBe(0.5);
  });

  it('combines trimBefore and playbackRate', () => {
    // (30 + 20 * 1.5) / 30 = 60 / 30 = 2.0
    expect(sourceTime({ trimBefore: 30, playbackRate: 1.5, frame: 20, fps: 30 })).toBe(2);
    // (150 + 10 * 4) / 30 = 190 / 30
    expect(sourceTime({ trimBefore: 150, playbackRate: 4, frame: 10, fps: 30 })).toBeCloseTo(190 / 30);
  });

  it('validates playbackRate range (0.25 to 16)', () => {
    expect(() => sourceTime({ playbackRate: 0, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> playbackRate must be between 0.25 and 16, got 0.',
    );
    expect(() => sourceTime({ playbackRate: 0.24, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> playbackRate must be between 0.25 and 16, got 0.24.',
    );
    expect(() => sourceTime({ playbackRate: 16.1, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> playbackRate must be between 0.25 and 16, got 16.1.',
    );
    expect(() => sourceTime({ playbackRate: 17, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> playbackRate must be between 0.25 and 16, got 17.',
    );
    expect(() => sourceTime({ playbackRate: Number.NaN, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> playbackRate must be between 0.25 and 16, got NaN.',
    );
  });

  it('validates trimBefore is non-negative integer', () => {
    expect(() => sourceTime({ trimBefore: -1, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> trimBefore must be a non-negative integer, got -1.',
    );
    expect(() => sourceTime({ trimBefore: 1.5, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> trimBefore must be a non-negative integer, got 1.5.',
    );
    expect(() => sourceTime({ trimBefore: Number.NaN, frame: 0, fps: 30 })).toThrow(
      'freemotion: <Video> trimBefore must be a non-negative integer, got NaN.',
    );
  });
});
