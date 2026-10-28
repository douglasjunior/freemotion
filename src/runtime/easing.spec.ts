import { Easing, type EasingFunction } from './easing.js';


const curves: Record<string, EasingFunction> = {
  linear: Easing.linear,
  ease: Easing.ease,
  quad: Easing.quad,
  cubic: Easing.cubic,
  poly4: Easing.poly(4),
  sin: Easing.sin,
  circle: Easing.circle,
  exp: Easing.exp,
  elastic: Easing.elastic(),
  back: Easing.back(),
  bounce: Easing.bounce,
  bezier: Easing.bezier(0.4, 0, 0.2, 1),
  out: Easing.out(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
};

describe('Easing', () => {
  it.each(Object.entries(curves))('%s starts at 0 and ends at 1', (_, curve) => {
    expect(curve(0)).toBeCloseTo(0, 6);
    expect(curve(1)).toBeCloseTo(1, 6);
  });

  it('out mirrors the curve', () => {
    expect(Easing.out(Easing.quad)(0.5)).toBe(0.75);
  });

  it('inOut is symmetric around the middle', () => {
    const curve = Easing.inOut(Easing.cubic);
    expect(curve(0.5)).toBeCloseTo(0.5);
    expect(curve(0.25) + curve(0.75)).toBeCloseTo(1);
  });

  it('back dips below zero before moving forward', () => {
    expect(Easing.back()(0.2)).toBeLessThan(0);
  });

  describe('bezier', () => {
    it('matches known points of CSS ease-in-out (0.42, 0, 0.58, 1)', () => {
      const curve = Easing.bezier(0.42, 0, 0.58, 1);
      expect(curve(0.5)).toBeCloseTo(0.5, 5);
      expect(curve(0.25)).toBeCloseTo(0.1291, 3);
      expect(curve(0.75)).toBeCloseTo(0.8709, 3);
    });

    it('is the identity when the control points sit on the diagonal', () => {
      expect(Easing.bezier(0.3, 0.3, 0.7, 0.7)(0.37)).toBe(0.37);
    });

    it('is monotonic for monotonic control points', () => {
      const curve = Easing.bezier(0.25, 0.1, 0.25, 1);
      let previous = 0;
      for (let x = 0; x <= 1; x += 0.01) {
        const y = curve(x);
        expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = y;
      }
    });

    it('rejects x control points outside [0, 1]', () => {
      expect(() => Easing.bezier(-0.1, 0, 0.5, 1)).toThrow();
      expect(() => Easing.bezier(0.5, 0, 1.2, 1)).toThrow();
    });
  });
});
