import { describe, expect, it } from 'vitest';

import { audioTargetTime, evaluateAudioVolume, planAudioSync } from './audio-sync.js';


describe('audioTargetTime', () => {
  it('calculates linear playback time from frame, fps, trimBefore and playbackRate', () => {
    expect(audioTargetTime({ frame: 0, fps: 30 })).toBe(0);
    expect(audioTargetTime({ frame: 30, fps: 30 })).toBe(1.0);
    expect(audioTargetTime({ frame: 30, fps: 30, trimBefore: 15 })).toBe(1.5);
    expect(audioTargetTime({ frame: 30, fps: 30, playbackRate: 2 })).toBe(2.0);
  });

  it('calculates loop modulo when trimAfter is specified', () => {
    // trimBefore: 30 (1.0s), trimAfter: 90 (3.0s), loop duration = 2.0s
    expect(audioTargetTime({ frame: 0, fps: 30, trimBefore: 30, trimAfter: 90, loop: true })).toBe(1.0);
    expect(audioTargetTime({ frame: 30, fps: 30, trimBefore: 30, trimAfter: 90, loop: true })).toBe(2.0);
    // At frame 60 (elapsed 2.0s): modulo 2.0 = 0 -> wraps back to 1.0s
    expect(audioTargetTime({ frame: 60, fps: 30, trimBefore: 30, trimAfter: 90, loop: true })).toBe(1.0);
    // At frame 75 (elapsed 2.5s): modulo 2.0 = 0.5 -> 1.5s
    expect(audioTargetTime({ frame: 75, fps: 30, trimBefore: 30, trimAfter: 90, loop: true })).toBe(1.5);
  });

  it('calculates loop modulo when audio duration is available and trimAfter is omitted', () => {
    // duration: 4.0s, trimBefore: 0, fps: 30
    expect(audioTargetTime({ frame: 90, fps: 30, loop: true, duration: 2.0 })).toBe(1.0);
    // duration: 4.0s, trimBefore: 30 (1.0s) -> available: 3.0s
    // at frame 120 (4.0s elapsed): 4.0 % 3.0 = 1.0s -> target: 1.0 + 1.0 = 2.0s
    expect(audioTargetTime({ frame: 120, fps: 30, trimBefore: 30, loop: true, duration: 4.0 })).toBe(2.0);
  });
});

describe('evaluateAudioVolume', () => {
  it('defaults to 1 when undefined', () => {
    expect(evaluateAudioVolume(undefined, 0)).toBe(1);
  });

  it('returns static volume clamped to 0..1', () => {
    expect(evaluateAudioVolume(0.5, 0)).toBe(0.5);
    expect(evaluateAudioVolume(1.8, 0)).toBe(1.0);
    expect(evaluateAudioVolume(-0.4, 0)).toBe(0.0);
  });

  it('evaluates dynamic volume function with the current local frame and clamps to 0..1', () => {
    const ducking = (frame: number) => (frame < 10 ? 1 : 0.2);
    expect(evaluateAudioVolume(ducking, 5)).toBe(1.0);
    expect(evaluateAudioVolume(ducking, 15)).toBe(0.2);

    const ramp = (frame: number) => frame * 0.1;
    expect(evaluateAudioVolume(ramp, 5)).toBe(0.5);
    expect(evaluateAudioVolume(ramp, 20)).toBe(1.0);
  });

  it('handles NaN or non-number returns safely', () => {
    expect(evaluateAudioVolume(() => Number.NaN, 0)).toBe(1.0);
  });
});

describe('planAudioSync', () => {
  it('does not seek on play when drift is small (<= 0.1s)', () => {
    const plan = planAudioSync({
      playing: true,
      current: 1.0,
      target: 1.05,
      paused: false,
    });
    expect(plan.play).toBe(false);
    expect(plan.pause).toBe(false);
    expect(plan.seek).toBe(false);
    expect(plan.silent).toBe(false);
  });

  it('starts playback when playing is true and element is paused', () => {
    const plan = planAudioSync({
      playing: true,
      current: 1.0,
      target: 1.02,
      paused: true,
    });
    expect(plan.play).toBe(true);
    expect(plan.pause).toBe(false);
    expect(plan.seek).toBe(false);
    expect(plan.silent).toBe(false);
  });

  it('seeks when drift is large (> 0.1s)', () => {
    const plan = planAudioSync({
      playing: true,
      current: 1.0,
      target: 1.25,
      paused: false,
    });
    expect(plan.seek).toBe(true);
    expect(plan.target).toBe(1.25);
    expect(plan.play).toBe(false);
    expect(plan.pause).toBe(false);
  });

  it('pauses and stays silent during scrub/stopped mode', () => {
    const plan = planAudioSync({
      playing: false,
      current: 1.0,
      target: 1.0,
      paused: false,
    });
    expect(plan.pause).toBe(true);
    expect(plan.play).toBe(false);
    expect(plan.silent).toBe(true);
  });

  it('calculates loop target with modulo', () => {
    const plan = planAudioSync({
      playing: true,
      current: 1.0,
      frame: 90,
      fps: 30,
      duration: 2.0,
      loop: true,
      paused: false,
    });
    // (90 / 30) = 3.0s % 2.0 = 1.0s
    expect(plan.target).toBe(1.0);
    expect(plan.silent).toBe(false);
  });

  it('stays silent and pauses when playback passes trimAfter without loop', () => {
    // trimAfter = 60 (2.0s at 30 fps), frame = 75 (2.5s)
    const plan = planAudioSync({
      playing: true,
      current: 2.0,
      frame: 75,
      fps: 30,
      trimAfter: 60,
      loop: false,
      paused: false,
    });
    expect(plan.silent).toBe(true);
    expect(plan.play).toBe(false);
    expect(plan.pause).toBe(true);
  });

  it('pauses and stays silent when frozen is true', () => {
    const plan = planAudioSync({
      playing: true,
      current: 1.0,
      target: 1.0,
      frozen: true,
      paused: false,
    });
    expect(plan.silent).toBe(true);
    expect(plan.pause).toBe(true);
    expect(plan.play).toBe(false);
  });

  it('pauses and stays silent when premounting is true', () => {
    const plan = planAudioSync({
      playing: true,
      current: 1.0,
      target: 1.0,
      premounting: true,
      paused: false,
    });
    expect(plan.silent).toBe(true);
    expect(plan.pause).toBe(true);
    expect(plan.play).toBe(false);
  });
});
