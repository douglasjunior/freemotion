import { addTimelineEntry, getTimelineSnapshot, subscribeTimeline } from './timeline-registry.js';


it('publishes stable snapshots and removes entries', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeTimeline(listener);
  const entry = { id: 'test', name: 'Scene', from: 4, durationInFrames: 10, depth: 0 };
  const remove = addTimelineEntry(entry);
  const snapshot = getTimelineSnapshot();
  expect(snapshot).toContainEqual(entry);
  expect(getTimelineSnapshot()).toBe(snapshot);
  remove();
  expect(getTimelineSnapshot()).not.toContainEqual(entry);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});
