import { renderToStaticMarkup } from 'react-dom/server';

import { useContextBridge } from './context-bridge.js';
import { FrameProvider, useCurrentFrame, useVideoConfig } from './frame.js';
import { PlaybackProvider, usePlayback } from './playback.js';


it('bridges frame and playback into a separate tree', () => {
  let Bridge: ReturnType<typeof useContextBridge> | undefined;
  function Capture() {
    Bridge = useContextBridge();
    return null;
  }
  function Read() {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { playing, muted } = usePlayback();
    return <span>{`${frame}/${fps}/${playing}/${muted}`}</span>;
  }
  renderToStaticMarkup(
    <FrameProvider config={{ fps: 30, width: 100, height: 100, durationInFrames: 60 }} frame={12}>
      <PlaybackProvider playing muted><Capture /></PlaybackProvider>
    </FrameProvider>,
  );
  expect(Bridge).toBeDefined();
  const Captured = Bridge!;
  expect(renderToStaticMarkup(<Captured><Read /></Captured>)).toContain('12/30/true/true');
});
