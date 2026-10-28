export type SpringConfig = {
  /** Friction. Higher values settle faster with less bounce. Default `10`. */
  readonly damping: number;
  /** Weight of the moving object. Heavier springs are slower. Default `1`. */
  readonly mass: number;
  /** Strength of the pull towards the target. Default `100`. */
  readonly stiffness: number;
  /** Never go past the target value. Default `false`. */
  readonly overshootClamping: boolean;
};

export type SpringOptions = {
  readonly frame: number;
  readonly fps: number;
  readonly config?: Partial<SpringConfig>;
  readonly from?: number;
  readonly to?: number;
  /** Frames to wait before starting. */
  readonly delay?: number;
};

const DEFAULT_CONFIG: SpringConfig = { damping: 10, mass: 1, stiffness: 100, overshootClamping: false };

/**
 * A damped spring moving from `from` to `to`, at rest on frame 0. It is the closed-form solution of
 * the damped harmonic oscillator evaluated at t = frame / fps, so any frame can be computed on its
 * own, in any order.
 */
export function spring({ frame, fps, config, from = 0, to = 1, delay = 0 }: SpringOptions): number {
  const { damping, mass, stiffness, overshootClamping } = { ...DEFAULT_CONFIG, ...config };
  if (!(fps > 0) || !(mass > 0) || !(stiffness > 0) || damping < 0) {
    throw new Error(`freemotion: spring() needs a positive fps, mass and stiffness and a non-negative damping (fps=${fps}, mass=${mass}, stiffness=${stiffness}, damping=${damping}).`);
  }
  const elapsed = frame - delay;
  if (elapsed <= 0) {
    return from;
  }
  const t = elapsed / fps;
  const x0 = from - to;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  let offset: number;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    offset = Math.exp(-zeta * omega0 * t) * (x0 * Math.cos(omegaD * t) + ((zeta * omega0 * x0) / omegaD) * Math.sin(omegaD * t));
  } else if (zeta === 1) {
    offset = Math.exp(-omega0 * t) * (x0 + omega0 * x0 * t);
  } else {
    const omegaD = omega0 * Math.sqrt(zeta * zeta - 1);
    offset = Math.exp(-zeta * omega0 * t) * (x0 * Math.cosh(omegaD * t) + ((zeta * omega0 * x0) / omegaD) * Math.sinh(omegaD * t));
  }

  const value = to + offset;
  if (overshootClamping) {
    return from < to ? Math.min(value, to) : Math.max(value, to);
  }
  return value;
}
