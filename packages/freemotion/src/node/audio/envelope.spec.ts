import { describe, expect, it } from 'vitest';

import { buildEnvelope, isConstantVolume } from './envelope.js';


describe('envelope', () => {
  describe('isConstantVolume', () => {
    it('returns constant: true for empty or single volume entries', () => {
      expect(isConstantVolume([])).toEqual({ constant: true, value: 0 });
      expect(isConstantVolume([[0, 0.7]])).toEqual({ constant: true, value: 0.7 });
    });

    it('returns constant: true when all volume entries have identical values', () => {
      expect(isConstantVolume([[0, 0.5], [1, 0.5], [2, 0.5]])).toEqual({ constant: true, value: 0.5 });
    });

    it('returns constant: false when volumes vary across frames', () => {
      expect(isConstantVolume([[0, 0.2], [1, 0.5]])).toEqual({ constant: false, value: 0 });
    });
  });

  describe('buildEnvelope', () => {
    it('generates zero-filled envelope for empty volumes', () => {
      const env = buildEnvelope({ volumes: [], fromFrame: 0, toFrame: 30, fps: 30, sampleRate: 100 });
      expect(env.length).toBe(100); // 1 sec at 100 Hz
      expect(env.every(v => v === 0)).toBe(true);
    });

    it('fills envelope with constant value for single volume entry', () => {
      const env = buildEnvelope({ volumes: [[0, 0.8]], fromFrame: 0, toFrame: 15, fps: 30, sampleRate: 100 });
      expect(env.length).toBe(50); // 0.5 sec at 100 Hz
      expect(env[0]).toBeCloseTo(0.8);
      expect(env[49]).toBeCloseTo(0.8);
    });

    it('linearly interpolates between observed frames across gaps', () => {
      // 30 fps, from frame 0 to 30 (1 sec), sampleRate = 1000 (1000 samples)
      // Volume ramp from 0.0 at frame 0 to 1.0 at frame 30
      const env = buildEnvelope({
        volumes: [[0, 0.0], [30, 1.0]],
        fromFrame: 0,
        toFrame: 30,
        fps: 30,
        sampleRate: 1000,
      });

      expect(env.length).toBe(1000);
      expect(env[0]).toBeCloseTo(0.0);
      expect(env[500]).toBeCloseTo(0.5, 2); // Midway at 0.5 sec
      expect(env[999]).toBeCloseTo(1.0, 2);
    });

    it('clamps outside bounds to first and last observed values', () => {
      // Observed frames: 10 (0.2) to 20 (0.8)
      // Requested timeline: 0 to 30 (1 sec at 30 fps)
      const env = buildEnvelope({
        volumes: [[10, 0.2], [20, 0.8]],
        fromFrame: 0,
        toFrame: 30,
        fps: 30,
        sampleRate: 300,
      });

      // Frame 0 is before first observed frame (10) -> clamped to 0.2
      expect(env[0]).toBeCloseTo(0.2);
      // Frame 10 is at sample index 100
      expect(env[100]).toBeCloseTo(0.2, 2);
      // Frame 20 is at sample index 200
      expect(env[200]).toBeCloseTo(0.8, 2);
      // Frame 30 is at sample index 299 (after last observed frame) -> clamped to 0.8
      expect(env[299]).toBeCloseTo(0.8, 2);
    });

    it('clamps negative volumes to 0 and coerces non-finite numbers', () => {
      const env = buildEnvelope({
        volumes: [[0, -1], [15, Number.NaN], [30, 0.5]],
        fromFrame: 0,
        toFrame: 30,
        fps: 30,
        sampleRate: 100,
      });

      for (const val of env) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(val)).toBe(true);
      }
    });

    it('produces ~3.6 MB for 15 minutes at default 1000 Hz sample rate', () => {
      // 15 minutes = 900 seconds at 30 fps = 27000 frames
      const env = buildEnvelope({
        volumes: [[0, 0.5], [27000, 0.8]],
        fromFrame: 0,
        toFrame: 27000,
        fps: 30,
      });

      // 900 seconds * 1000 samples/sec = 900,000 samples
      expect(env.length).toBe(900_000);
      // 900,000 * 4 bytes per Float32 = 3,600,000 bytes (~3.6 MB)
      expect(env.byteLength).toBe(3_600_000);
    });
  });
});
