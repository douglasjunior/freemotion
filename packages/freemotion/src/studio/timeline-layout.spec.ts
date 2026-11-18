import { layoutTracks } from './timeline-layout.js';


it('clips, orders and stacks overlapping tracks', () => {
  const entries = [
    { id: 'b', name: 'B', from: 5, durationInFrames: Infinity, depth: 1 },
    { id: 'a', name: 'A', from: -5, durationInFrames: 15, depth: 0 },
    { id: 'c', name: 'C', from: 30, durationInFrames: 5, depth: 0 },
  ];
  expect(layoutTracks(entries, 20)).toMatchObject([
    { id: 'a', left: 0, width: 50, row: 0 },
    { id: 'b', left: 25, width: 75, row: 1 },
  ]);
});
