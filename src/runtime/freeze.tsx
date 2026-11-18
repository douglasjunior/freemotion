import type { ReactNode } from 'react';

import { FrameProvider, useFrameState } from './frame.js';


export type FreezeProps = {
  /** The frozen frame number, relative to the parent sequence or composition. */
  readonly frame: number;
  /** When false, children render with the parent frame dynamically. Default `true`. */
  readonly active?: boolean;
  readonly children?: ReactNode;
};

/**
 * Freezes time for its children at a specific frame.
 * Inside it, `useCurrentFrame()` returns `frame`, `<Video>` locks on the frozen frame,
 * and `<Audio>` remains silent.
 */
export const Freeze = ({ frame, active = true, children }: FreezeProps) => {
  if (!Number.isFinite(frame)) {
    throw new Error(`freemotion: <Freeze> "frame" must be a finite number, received ${frame}.`);
  }

  const { config, offset, premounting } = useFrameState();

  if (!active) {
    return <>{children}</>;
  }

  return (
    <FrameProvider
      config={config}
      frame={frame}
      offset={offset}
      frozen
      premounting={premounting}
    >
      {children}
    </FrameProvider>
  );
};
