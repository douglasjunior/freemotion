import { useMemo, type ReactNode } from 'react';

import { FrameProvider, useFrameState } from './frame.js';
import { PlaybackProvider, usePlayback } from './playback.js';


/** Captures freemotion contexts for a separate React renderer. */
export function useContextBridge() {
  const state = useFrameState();
  const playback = usePlayback();
  return useMemo(() => function ContextBridge({ children }: { readonly children: ReactNode }) {
    return (
      <FrameProvider {...state}>
        <PlaybackProvider {...playback}>{children}</PlaybackProvider>
      </FrameProvider>
    );
  }, [state, playback]);
}
