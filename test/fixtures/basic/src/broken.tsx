// Compositions that must fail, loaded with --entry src/broken.tsx.
import { AbsoluteFill, continueRender, defineComposition, delayRender, useCurrentFrame } from 'freemotion';
import { useEffect, useState } from 'react';


const Throws = () => {
  throw new Error('kaboom');
};

const Blank = () => null;

const SlowHold = () => {
  const [handle] = useState(() => delayRender('slow hold'));
  useEffect(() => {
    const timer = setTimeout(() => {
      continueRender(handle);
    }, 1500);
    return () => clearTimeout(timer);
  }, [handle]);
  return <AbsoluteFill style={{ background: '#00ff00' }} />;
};

const AsyncError = () => {
  const frame = useCurrentFrame();
  useEffect(() => {
    if (frame === 1) {
      setTimeout(() => {
        throw new Error('error on old tab');
      }, 50);
    }
  }, [frame]);
  return <AbsoluteFill style={{ background: '#ff0000' }} />;
};

export default [
  defineComposition({ id: 'Throws', component: Throws, fps: 30, width: 64, height: 64, durationInFrames: 1 }),
  defineComposition({ id: 'Odd', component: Blank, fps: 30, width: 63, height: 63, durationInFrames: 2 }),
  defineComposition({ id: 'SlowHold', component: SlowHold, fps: 30, width: 64, height: 64, durationInFrames: 2 }),
  defineComposition({ id: 'AsyncError', component: AsyncError, fps: 30, width: 64, height: 64, durationInFrames: 4 }),
];
