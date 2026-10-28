// Page for the scroll e2e test: a <ScrollPlayer> in the page and a useScrollFrame() inside a
// scrolling box. Both write the frame they show to data attributes the test reads.
import { Player, ScrollPlayer, useScrollFrame } from 'freemotion';
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';

import { colors } from './compositions';


const InBox = () => {
  const box = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const frame = useScrollFrame(target, colors.durationInFrames, { container: box, range: 'visible', smoothing: 0 });
  return (
    <div ref={box} data-testid="box" data-frame={Math.round(frame)} style={{ height: 200, overflow: 'auto' }}>
      <div style={{ height: 200 }} />
      <div ref={target} style={{ width: 200 }}>
        <Player composition={colors} frame={frame} />
      </div>
      <div style={{ height: 200 }} />
    </div>
  );
};

const Page = () => (
  <main>
    <InBox />
    <div style={{ height: '100vh' }} />
    <ScrollPlayer
      composition={colors}
      scrollLength="300vh"
      smoothing={0}
      onFrameChange={(frame) => {
        document.body.dataset.frame = String(frame);
      }}
    />
    <div style={{ height: '100vh' }} />
  </main>
);

createRoot(document.getElementById('root')!).render(<Page />);
