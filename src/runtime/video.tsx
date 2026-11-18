import { useEffect, useLayoutEffect, useRef, type SyntheticEvent, type VideoHTMLAttributes } from 'react';

import { getEnvironment } from './environment.js';
import { useCurrentFrame, useVideoConfig } from './frame.js';
import { Img } from './img.js';
import { usePlayback } from './playback.js';
import { getVideoServerUrl } from './render-context.js';
import { sourceTime } from './video-math.js';
import { planVideoSync } from './video-sync.js';


export type VideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'volume'> & {
  readonly src: string;
  readonly trimBefore?: number;
  readonly playbackRate?: number;
  readonly transparent?: boolean;
  readonly volume?: number | ((frame: number) => number);
};

const VIDEO_ONLY_PROPS = new Set([
  'muted',
  'autoPlay',
  'playsInline',
  'controls',
  'poster',
  'preload',
  'loop',
  'disablePictureInPicture',
  'disableRemotePlayback',
]);

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function filterImgProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!VIDEO_ONLY_PROPS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

export function cleanVideoSrc(src: string): string {
  const [path] = src.split(/[?#]/);
  return (path ?? src).replace(/^\/+/, '');
}

/**
 * Renders a video. In render mode, requests exact frame images from the local video frame server.
 * In preview and player modes, renders an HTML video element synchronized with playback.
 */
export const Video = ({
  src,
  trimBefore = 0,
  playbackRate = 1,
  transparent = false,
  volume = 1,
  muted = false,
  style,
  className,
  onError,
  ...rest
}: VideoProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playback = usePlayback();

  const time = sourceTime({ trimBefore, playbackRate, frame, fps });

  const rawVolume = typeof volume === 'function' ? volume(frame) : volume;
  const effectiveVolume = Math.min(1, Math.max(0, rawVolume));
  const effectiveMuted = Boolean(muted || playback.muted || !playback.playing);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef(false);
  const queuedTargetRef = useRef<number | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) {
      return;
    }

    const onSeeked = () => {
      const finish = () => {
        pendingSeekRef.current = false;
        if (queuedTargetRef.current !== null) {
          const next = queuedTargetRef.current;
          queuedTargetRef.current = null;
          pendingSeekRef.current = true;
          el.currentTime = next;
        }
      };

      type ExtendedVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void };
      const extendedEl = el as ExtendedVideo;
      if (typeof extendedEl.requestVideoFrameCallback === 'function') {
        extendedEl.requestVideoFrameCallback(() => finish());
      } else {
        finish();
      }
    };

    el.addEventListener('seeked', onSeeked);
    return () => {
      el.removeEventListener('seeked', onSeeked);
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) {
      return;
    }

    el.volume = effectiveVolume;
    el.muted = effectiveMuted;

    const action = planVideoSync({
      playing: playback.playing,
      current: el.currentTime,
      target: time,
      fps,
      pendingSeek: pendingSeekRef.current,
      paused: el.paused,
    });

    if (action === 'seek') {
      if (pendingSeekRef.current) {
        queuedTargetRef.current = time;
      } else {
        pendingSeekRef.current = true;
        el.currentTime = time;
      }
    } else if (action === 'play') {
      el.playbackRate = playbackRate;
      el.play().catch(() => {
        // Autoplay policy: continue muted
      });
    } else if (action === 'pause') {
      el.pause();
    }
  }, [time, playback.playing, playbackRate, effectiveVolume, effectiveMuted, fps]);

  const env = getEnvironment();
  if (env.isRendering) {
    const serverUrl = getVideoServerUrl();
    if (!serverUrl) {
      throw new Error('freemotion: <Video> in render mode needs a video frame server URL, but none was provided.');
    }
    const cleanSrc = cleanVideoSrc(src);
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const frameUrl = `${baseUrl}/__freemotion/video-frame?src=${encodeURIComponent(cleanSrc)}&time=${time.toFixed(6)}&transparent=${transparent ? '1' : '0'}`;

    return (
      <Img
        src={frameUrl}
        crossOrigin="anonymous"
        style={style}
        className={className}
        label={`<Video src="${src}">`}
        {...filterImgProps(rest)}
      />
    );
  }

  const handleVideoError = (event: SyntheticEvent<HTMLVideoElement, Event>) => {
    onError?.(event);
  };

  return (
    <video
      ref={videoRef}
      src={src}
      preload="auto"
      playsInline
      style={style}
      className={className}
      onError={handleVideoError}
      {...rest}
    />
  );
};
