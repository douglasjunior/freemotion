export type EasingFunction = (t: number) => number;

const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-7;
const BISECTION_ITERATIONS = 40;

/**
 * Cubic Bézier timing curve through (0, 0), (x1, y1), (x2, y2) and (1, 1), the same model as CSS
 * `cubic-bezier()`. For a given progress x, solves the curve's parameter t (Newton's method,
 * falling back to bisection where the slope is flat) and returns y(t).
 */
function bezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new Error('freemotion: Easing.bezier needs x1 and x2 within [0, 1].');
  }
  if (x1 === y1 && x2 === y2) {
    return t => t;
  }
  // Polynomial coefficients of B(t) = a·t³ + b·t² + c·t for each axis.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const curveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const curveY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < NEWTON_ITERATIONS; i++) {
      const error = curveX(t) - x;
      if (Math.abs(error) < NEWTON_EPSILON) {
        return t;
      }
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) {
        break;
      }
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < BISECTION_ITERATIONS; i++) {
      const value = curveX(t);
      if (Math.abs(value - x) < NEWTON_EPSILON) {
        break;
      }
      if (value < x) {
        low = t;
      } else {
        high = t;
      }
      t = (low + high) / 2;
    }
    return t;
  };

  return x => (x <= 0 ? 0 : x >= 1 ? 1 : curveY(solve(x)));
}

function bounce(t: number): number {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  }
  if (t < 2 / 2.75) {
    const u = t - 1.5 / 2.75;
    return 7.5625 * u * u + 0.75;
  }
  if (t < 2.5 / 2.75) {
    const u = t - 2.25 / 2.75;
    return 7.5625 * u * u + 0.9375;
  }
  const u = t - 2.625 / 2.75;
  return 7.5625 * u * u + 0.984375;
}

/**
 * Timing curves for `interpolate()`. The base curves accelerate from zero ("ease in"); wrap them
 * with `Easing.out()` or `Easing.inOut()` to change where the motion slows down.
 */
export const Easing = {
  linear: (t: number) => t,
  /** CSS `ease`. */
  ease: bezier(0.25, 0.1, 0.25, 1),
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  poly: (n: number): EasingFunction => t => t ** n,
  sin: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  circle: (t: number) => 1 - Math.sqrt(1 - t * t),
  exp: (t: number) => (t === 0 ? 0 : 2 ** (10 * (t - 1))),
  /** Springy overshoot; `bounciness` 1 is a single wobble, higher values wobble more. */
  elastic: (bounciness = 1): EasingFunction => {
    const p = bounciness * Math.PI;
    return t => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
  },
  /** Pulls back before moving forward. */
  back: (s = 1.70158): EasingFunction => t => t * t * ((s + 1) * t - s),
  bounce,
  bezier,
  in: (easing: EasingFunction): EasingFunction => easing,
  out: (easing: EasingFunction): EasingFunction => t => 1 - easing(1 - t),
  inOut: (easing: EasingFunction): EasingFunction => t => (t < 0.5 ? easing(t * 2) / 2 : 1 - easing((1 - t) * 2) / 2),
};
