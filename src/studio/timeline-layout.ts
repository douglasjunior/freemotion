import type { TimelineEntry } from '../runtime/timeline-registry.js';


export function layoutTracks(entries: readonly TimelineEntry[], duration: number) {
  const ends: number[] = [];
  return [...entries].sort((a, b) => a.from - b.from || a.depth - b.depth).flatMap((entry) => {
    const start = Math.max(0, entry.from);
    const end = Math.min(duration, entry.from + entry.durationInFrames);
    if (end <= start || duration <= 0) return [];
    let row = ends.findIndex(value => value <= start);
    if (row < 0) row = ends.length;
    ends[row] = end;
    return [{ ...entry, left: start / duration * 100, width: (end - start) / duration * 100, row }];
  });
}
