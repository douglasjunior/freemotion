import { createContext, useContext, useMemo, type ReactNode } from 'react';


export type VideoConfig = {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly durationInFrames: number;
};

export type FrameState = {
  readonly config: VideoConfig;
  readonly frame: number;
  readonly offset: number;
  readonly frozen: boolean;
};

const FrameContext = createContext<FrameState | null>(null);

export function useFrameState(): FrameState {
  const state = useContext(FrameContext);
  if (!state) {
    throw new Error('freemotion: this hook must be used inside a <Stage>, a <Player> or a composition rendered by the studio.');
  }
  return state;
}

/** The frame being drawn. Inside a `<Sequence>` it is relative to the start of that sequence. */
export function useCurrentFrame(): number {
  return useFrameState().frame;
}

/** The absolute frame on the composition timeline, accounting for enclosing Sequence offsets. */
export function useAbsoluteFrame(): number {
  const { frame, offset } = useFrameState();
  return frame + offset;
}

/** Size, frame rate and duration of the composition being drawn. */
export function useVideoConfig(): VideoConfig {
  return useFrameState().config;
}

export const FrameProvider = ({
  config,
  frame,
  offset = 0,
  frozen = false,
  children,
}: {
  readonly config: VideoConfig;
  readonly frame: number;
  readonly offset?: number;
  readonly frozen?: boolean;
  readonly children: ReactNode;
}) => {
  const value = useMemo(() => ({ config, frame, offset, frozen }), [config, frame, offset, frozen]);
  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
};
