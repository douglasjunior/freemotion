import { createContext, useContext, useMemo, type ReactNode } from 'react';


export type PlaybackState = {
  readonly playing: boolean;
  readonly muted: boolean;
};

const DEFAULT_PLAYBACK_STATE: PlaybackState = {
  playing: false,
  muted: false,
};

const PlaybackContext = createContext<PlaybackState>(DEFAULT_PLAYBACK_STATE);

/**
 * Accesses the current playback state (playing, muted).
 * Used by <Video> and <Audio> to synchronize preview playback with the Studio and Player.
 */
export function usePlayback(): PlaybackState {
  return useContext(PlaybackContext);
}

export type PlaybackProviderProps = {
  readonly playing?: boolean;
  readonly muted?: boolean;
  readonly children: ReactNode;
};

/**
 * Provides the playback state to compositions rendered inside a <Player> or Studio.
 */
export const PlaybackProvider = ({
  playing = false,
  muted = false,
  children,
}: PlaybackProviderProps) => {
  const value = useMemo(() => ({ playing, muted }), [playing, muted]);
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
};
