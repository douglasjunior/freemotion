import { useEffect, useLayoutEffect, useRef } from 'react';

import { registerAudio } from './audio-registry.js';
import { evaluateAudioVolume, planAudioSync } from './audio-sync.js';
import { getEnvironment } from './environment.js';
import { useFrameState, useVideoConfig } from './frame.js';
import { usePlayback } from './playback.js';


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
  const { fps } = useVideoConfig();
  const playback = usePlayback();
  const env = getEnvironment();

  const registrationRef = useRef<{
    lastRenderedFrame: number | null;
    ordinal: number | null;
  }>({
    lastRenderedFrame: null,
    ordinal: null,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // In preview mode, imperatively manage HTMLAudioElement lifecycle
  useEffect(() => {
    if (typeof document === 'undefined' || env.isRendering) {
      return;
    }
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.src = src;
    audioRef.current = el;

    return () => {
      el.pause?.();
      el.removeAttribute('src');
      el.load?.();
      audioRef.current = null;
    };
  }, [src, env.isRendering]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.loop = loop;
      el.playbackRate = playbackRate;
    }
  }, [loop, playbackRate]);

  // In preview mode, synchronize audio playback, volume and muted state on each frame render
  useIsomorphicLayoutEffect(() => {
    if (env.isRendering) {
      return;
    }
    const el = audioRef.current;
    if (!el) {
      return;
    }

    const effectiveVolume = evaluateAudioVolume(volume, frame);
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;

    const plan = planAudioSync({
      playing: playback.playing,
      current: el.currentTime,
      frame,
      fps,
      trimBefore,
      trimAfter,
      playbackRate,
      loop,
      duration,
      frozen,
      premounting,
      paused: el.paused,
    });

    if (plan.pause) {
      el.pause?.();
    }

    if (plan.seek) {
      try {
        el.currentTime = plan.target;
      } catch {
        // Ignore seek error if element is unready
      }
    }

    if (plan.play) {
      el.playbackRate = playbackRate;
      el.play?.()?.catch(() => {
        // Autoplay policy: continue silently
      });
    }

    try {
      el.volume = effectiveVolume;
      el.muted = Boolean(muted || playback.muted || plan.silent);
    } catch {
      // Ignore volume assignment issues in non-standard environments
    }
  });

  return null;
};
