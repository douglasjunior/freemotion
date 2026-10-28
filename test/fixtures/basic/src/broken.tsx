// Compositions that must fail, loaded with --entry src/broken.tsx.
import { defineComposition } from 'freemotion';


const Throws = () => {
  throw new Error('kaboom');
};

const Blank = () => null;

export default [
  defineComposition({ id: 'Throws', component: Throws, fps: 30, width: 64, height: 64, durationInFrames: 1 }),
  defineComposition({ id: 'Odd', component: Blank, fps: 30, width: 63, height: 63, durationInFrames: 2 }),
];
