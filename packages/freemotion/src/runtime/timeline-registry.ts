export type TimelineEntry = { readonly id: string; readonly name: string; readonly from: number; readonly durationInFrames: number; readonly depth: number };
let snapshot: readonly TimelineEntry[] = [];
const listeners = new Set<() => void>();
export const getTimelineSnapshot = () => snapshot;
export function subscribeTimeline(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function addTimelineEntry(entry: TimelineEntry) {
  snapshot = [...snapshot.filter(item => item.id !== entry.id), entry];
  listeners.forEach(listener => listener());
  return () => {
    snapshot = snapshot.filter(item => item.id !== entry.id);
    listeners.forEach(listener => listener());
  };
}
