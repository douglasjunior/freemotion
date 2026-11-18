import { useEffect, useLayoutEffect, useRef } from 'react';

import { registerAudio } from './audio-registry.js';
import { getEnvironment } from './environment.js';
import { useFrameState } from './frame.js';


export type AudioProps = {
  readonly src: string;
  readonly volume?: number | ((frame: number) => number);
  readonly loop?: boolean;
  readonly playbackRate?: number;
  readonly trimBefore?: number;
  readonly trimAfter?: number;
  readonly muted?: boolean;
};

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Declares an audio track in a composition.
 * In render mode, registers the audio track and records its per-frame volume envelope for mixing.
 * In preview mode, playback is handled by the preview audio runtime.
 */
export const Audio = ({
  src,
  volume = 1,
  loop = false,
  playbackRate = 1,
  trimBefore = 0,
  trimAfter,
  muted = false,
}: AudioProps) => {
  if (playbackRate < 0.25 || playbackRate > 16 || Number.isNaN(playbackRate)) {
    throw new Error(`freemotion: <Audio> playbackRate must be between 0.25 and 16, received ${playbackRate}.`);
  }

  const { frame, offset, frozen, premounting } = useFrameState();
  const env = getEnvironment();

  const registrationRef = useRef<{
    lastRenderedFrame: number | null;
    ordinal: number | null;
  }>({
    lastRenderedFrame: null,
    ordinal: null,
  });

  // In render mode, registers the audio track and per-frame volume envelope once per commit
  useIsomorphicLayoutEffect(() => {
    if (!env.isRendering || muted || frozen || premounting) {
      return;
    }

    const absoluteFrame = offset + frame;
    const isSameFrameReRender =
      registrationRef.current.lastRenderedFrame === absoluteFrame
      && registrationRef.current.ordinal !== null;

    const currentVolume = typeof volume === 'function' ? volume(frame) : volume;
    const asset = registerAudio({
      src,
      frame,
      offset,
      volume: currentVolume,
      trimBefore,
      trimAfter,
      playbackRate,
      loop,
      ordinal: isSameFrameReRender ? registrationRef.current.ordinal! : undefined,
    });

    registrationRef.current.lastRenderedFrame = absoluteFrame;
    registrationRef.current.ordinal = asset.ordinal;
  });

  return null;
};
