import { spring } from './spring.js';


const fps = 30;

describe('spring', () => {
  it('rests at `from` until it starts', () => {
    expect(spring({ frame: 0, fps })).toBe(0);
    expect(spring({ frame: -5, fps, from: 3, to: 7 })).toBe(3);
    expect(spring({ frame: 9, fps, delay: 10 })).toBe(0);
  });

  it('settles on `to`', () => {
    expect(spring({ frame: 300, fps })).toBeCloseTo(1, 4);
    expect(spring({ frame: 300, fps, from: 10, to: -10 })).toBeCloseTo(-10, 3);
  });

  it('overshoots when under-damped and not when clamped', () => {
    const frames = Array.from({ length: 90 }, (_, frame) => frame);
    const free = Math.max(...frames.map(frame => spring({ frame, fps, config: { damping: 5 } })));
    const clamped = Math.max(...frames.map(frame => spring({ frame, fps, config: { damping: 5, overshootClamping: true } })));
    expect(free).toBeGreaterThan(1.1);
    expect(clamped).toBeLessThanOrEqual(1);
  });

  it('never overshoots when critically or over-damped', () => {
    // Critical damping: damping = 2 * sqrt(stiffness * mass).
    for (const damping of [20, 40]) {
      let previous = 0;
      for (let frame = 1; frame < 120; frame++) {
        const value = spring({ frame, fps, config: { damping } });
        expect(value).toBeLessThanOrEqual(1 + 1e-9);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });

  it('matches the analytic solution of the damped oscillator', () => {
    // m = 1, k = 100, c = 10 → ω0 = 10, ζ = 0.5, ωd = 10·√0.75.
    const t = 0.25;
    const omegaD = 10 * Math.sqrt(0.75);
    const expected = 1 - Math.exp(-5 * t) * (Math.cos(omegaD * t) + (5 / omegaD) * Math.sin(omegaD * t));
    expect(spring({ frame: t * fps, fps })).toBeCloseTo(expected, 10);
  });

  it('delays the start', () => {
    expect(spring({ frame: 25, fps, delay: 10 })).toBe(spring({ frame: 15, fps }));
  });

  it('rejects impossible configs', () => {
    expect(() => spring({ frame: 1, fps: 0 })).toThrow();
    expect(() => spring({ frame: 1, fps, config: { mass: 0 } })).toThrow();
    expect(() => spring({ frame: 1, fps, config: { damping: -1 } })).toThrow();
  });
});
