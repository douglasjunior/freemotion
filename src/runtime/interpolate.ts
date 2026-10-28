import { Easing, type EasingFunction } from './easing.js';


/**
 * What happens outside the input range:
 * - `extend` keeps the slope of the nearest segment going (default);
 * - `clamp` holds the first/last output value;
 * - `identity` returns the input unchanged;
 * - `wrap` loops the input back into the range.
 */
export type ExtrapolateType = 'extend' | 'clamp' | 'identity' | 'wrap';

export type InterpolateOptions = {
  readonly easing?: EasingFunction;
  readonly extrapolateLeft?: ExtrapolateType;
  readonly extrapolateRight?: ExtrapolateType;
};

function validate(inputRange: readonly number[], outputRange: readonly number[]) {
  if (inputRange.length < 2 || inputRange.length !== outputRange.length) {
    throw new Error(`freemotion: interpolate() needs inputRange and outputRange of the same length (at least 2), got ${inputRange.length} and ${outputRange.length}.`);
  }
  for (let i = 0; i < inputRange.length; i++) {
    if (!Number.isFinite(inputRange[i]) || !Number.isFinite(outputRange[i])) {
      throw new Error(`freemotion: interpolate() ranges must be finite numbers, got [${inputRange.join(', ')}] → [${outputRange.join(', ')}].`);
    }
    if (i > 0 && inputRange[i]! <= inputRange[i - 1]!) {
      throw new Error(`freemotion: interpolate() inputRange must be strictly increasing, got [${inputRange.join(', ')}].`);
    }
  }
}

/** Maps `input` from `inputRange` to `outputRange`, segment by segment, applying `easing` within each segment. */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  { easing = Easing.linear, extrapolateLeft = 'extend', extrapolateRight = 'extend' }: InterpolateOptions = {},
): number {
  validate(inputRange, outputRange);
  const last = inputRange.length - 1;
  const first = inputRange[0]!;
  const end = inputRange[last]!;

  let x = input;
  if (x < first || x > end) {
    const mode = x < first ? extrapolateLeft : extrapolateRight;
    if (mode === 'clamp') {
      return x < first ? outputRange[0]! : outputRange[last]!;
    }
    if (mode === 'identity') {
      return x;
    }
    if (mode === 'wrap') {
      const span = end - first;
      x = first + ((((x - first) % span) + span) % span);
    }
  }

  let i = 0;
  while (i < last - 1 && x > inputRange[i + 1]!) {
    i++;
  }
  const inA = inputRange[i]!;
  const inB = inputRange[i + 1]!;
  const outA = outputRange[i]!;
  const outB = outputRange[i + 1]!;
  const t = (x - inA) / (inB - inA);
  return outA + (outB - outA) * easing(t);
}
