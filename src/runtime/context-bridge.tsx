import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { FrameProvider, useFrameState } from './frame.js';
import { PlaybackProvider, usePlayback } from './playback.js';


const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Captures freemotion contexts for a separate React renderer. */
export function useContextBridge() {
  const state = useFrameState();
  const playback = usePlayback();
  const [store] = useState(() => {
    let snapshot = { state, playback };
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const getSnapshot = () => snapshot;
    function Bridge({ children }: { readonly children: ReactNode }) {
      const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      return <FrameProvider {...current.state}><PlaybackProvider {...current.playback}>{children}</PlaybackProvider></FrameProvider>;
    }
    return {
      Bridge,
      update(next: typeof snapshot) {
        if (snapshot.state !== next.state || snapshot.playback !== next.playback) {
          snapshot = next;
          listeners.forEach(listener => listener());
        }
      },
    };
  });
  useCommitEffect(() => {
    store.update({ state, playback });
  }, [store, state, playback]);
  return store.Bridge;
}
