import { useSyncExternalStore } from 'react';

import { getTimelineSnapshot, subscribeTimeline } from '../runtime/timeline-registry.js';

import { layoutTracks } from './timeline-layout.js';


export function Timeline({ duration, frame, seek }: { readonly duration: number; readonly frame: number; readonly seek: (frame: number) => void }) {
  const entries = useSyncExternalStore(subscribeTimeline, getTimelineSnapshot, getTimelineSnapshot);
  const tracks = layoutTracks(entries, duration);
  if (!tracks.length) return null;
  const rows = Math.max(...tracks.map(track => track.row)) + 1;
  return (
    <div style={{ position: 'relative', height: Math.min(rows * 28, 140), overflowY: 'auto' }}>
      <div style={{ height: rows * 28, position: 'relative' }}>
        {tracks.map(track => <button key={track.id} title={`${track.from}–${track.from + track.durationInFrames}`} onClick={() => seek(track.from)} style={{ position: 'absolute', left: `${track.left}%`, width: `${track.width}%`, top: track.row * 28, height: 25, overflow: 'hidden' }}>{track.name}</button>)}
        <div style={{ position: 'absolute', left: `${frame / duration * 100}%`, height: '100%', borderLeft: '1px solid red', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}
