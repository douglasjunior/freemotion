import type { AudioVolumeEntry } from '../../shared/render-api.js';


export type BuildEnvelopeOptions = {
  readonly volumes: readonly AudioVolumeEntry[];
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly fps: number;
  readonly sampleRate?: number;
};

export type ConstantVolumeCheck = {
  readonly constant: boolean;
  readonly value: number;
};

/**
 * Checks whether an array of volume entries has a constant volume.
 */
export function isConstantVolume(volumes: readonly AudioVolumeEntry[]): ConstantVolumeCheck {
  if (volumes.length === 0) {
    return { constant: true, value: 0 };
  }
  const firstValue = volumes[0]![1];
  const safeFirst = Number.isFinite(firstValue) ? Math.max(0, firstValue) : 0;
  for (let i = 1; i < volumes.length; i++) {
    const rawVal = volumes[i]![1];
    const val = Number.isFinite(rawVal) ? Math.max(0, rawVal) : 0;
    if (Math.abs(val - safeFirst) > 1e-5) {
      return { constant: false, value: 0 };
    }
  }
  return { constant: true, value: safeFirst };
}

/**
 * Builds a Float32Array audio volume envelope sampled at `sampleRate` Hz (default 1000 Hz, 1 sample per ms).
 * Linearly interpolates between observed frames, clamps outside boundaries, and ensures non-negative values.
 */
export function buildEnvelope({
  volumes,
  fromFrame,
  toFrame,
  fps,
  sampleRate = 1000,
}: BuildEnvelopeOptions): Float32Array {
  const durationSec = Math.max(0, (toFrame - fromFrame) / fps);
  const numSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const envelope = new Float32Array(numSamples);

  if (volumes.length === 0) {
    return envelope;
  }

  if (volumes.length === 1) {
    const rawVal = volumes[0]![1];
    const val = Number.isFinite(rawVal) ? Math.max(0, rawVal) : 0;
    envelope.fill(val);
    return envelope;
  }

  let k = 0;
  for (let i = 0; i < numSamples; i++) {
    const sampleTimeSec = i / sampleRate;
    const currentFrame = fromFrame + sampleTimeSec * fps;

    // Advance index pointer to segment enclosing currentFrame
    while (k + 1 < volumes.length && volumes[k + 1]![0] <= currentFrame) {
      k++;
    }

    let val: number;
    if (currentFrame <= volumes[0]![0]) {
      val = volumes[0]![1];
    } else if (k >= volumes.length - 1) {
      val = volumes[volumes.length - 1]![1];
    } else {
      const f0 = volumes[k]![0];
      const v0 = volumes[k]![1];
      const f1 = volumes[k + 1]![0];
      const v1 = volumes[k + 1]![1];
      const fraction = f1 === f0 ? 0 : (currentFrame - f0) / (f1 - f0);
      val = v0 + fraction * (v1 - v0);
    }

    envelope[i] = Number.isFinite(val) ? Math.max(0, val) : 0;
  }

  return envelope;
}
