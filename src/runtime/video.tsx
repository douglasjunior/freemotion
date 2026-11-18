import type { VideoHTMLAttributes } from 'react';

import { getEnvironment } from './environment.js';
import { useCurrentFrame, useVideoConfig } from './frame.js';
import { Img } from './img.js';
import { getVideoServerUrl } from './render-context.js';
import { sourceTime } from './video-math.js';


export type VideoProps = VideoHTMLAttributes<HTMLVideoElement> & {
  readonly src: string;
  readonly trimBefore?: number;
  readonly playbackRate?: number;
  readonly transparent?: boolean;
  readonly volume?: number;
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
 * In preview and player modes, renders an HTML video element.
 */
export const Video = ({
  src,
  trimBefore = 0,
  playbackRate = 1,
  transparent = false,
  volume: _volume = 1,
  style,
  className,
  ...rest
}: VideoProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const time = sourceTime({ trimBefore, playbackRate, frame, fps });

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

  return (
    <video
      src={src}
      style={style}
      className={className}
      {...rest}
    />
  );
};
