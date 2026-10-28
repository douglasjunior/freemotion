import { Easing } from './easing.js';
import { interpolate } from './interpolate.js';


describe('interpolate', () => {
  it('maps linearly inside the range', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(0, [0, 10], [100, 0])).toBe(100);
  });

  it('handles several segments', () => {
    const range = [0, 10, 20];
    const output = [0, 100, 0];
    expect(interpolate(5, range, output)).toBe(50);
    expect(interpolate(10, range, output)).toBe(100);
    expect(interpolate(15, range, output)).toBe(50);
  });

  it('applies the easing within each segment', () => {
    expect(interpolate(5, [0, 10], [0, 100], { easing: Easing.quad })).toBe(25);
    expect(interpolate(15, [10, 20], [0, 100], { easing: Easing.quad })).toBe(25);
  });

  it('extends by default', () => {
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(-50);
    expect(interpolate(20, [0, 10], [0, 100])).toBe(200);
  });

  it('clamps when asked', () => {
    const options = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
    expect(interpolate(-5, [0, 10], [0, 100], options)).toBe(0);
    expect(interpolate(20, [0, 10], [0, 100], options)).toBe(100);
  });

  it('returns the input with identity', () => {
    expect(interpolate(42, [0, 10], [0, 1], { extrapolateRight: 'identity' })).toBe(42);
  });

  it('wraps the input back into the range', () => {
    expect(interpolate(12, [0, 10], [0, 100], { extrapolateRight: 'wrap' })).toBeCloseTo(20);
    expect(interpolate(-2, [0, 10], [0, 100], { extrapolateLeft: 'wrap' })).toBeCloseTo(80);
  });

  it('rejects invalid ranges', () => {
    expect(() => interpolate(0, [0], [0])).toThrow(/same length/);
    expect(() => interpolate(0, [0, 10], [0, 1, 2])).toThrow(/same length/);
    expect(() => interpolate(0, [10, 0], [0, 1])).toThrow(/strictly increasing/);
    expect(() => interpolate(0, [0, 0], [0, 1])).toThrow(/strictly increasing/);
    expect(() => interpolate(0, [0, Infinity], [0, 1])).toThrow(/finite/);
  });
});
