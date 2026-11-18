import { useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

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


it('preserves children while propagating frame changes', async () => {
  const config = { fps: 30, width: 100, height: 100, durationInFrames: 60 };
  let mounts = 0;
  let unmounts = 0;
  function Child() {
    const frame = useCurrentFrame();
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return <span>{frame}</span>;
  }
  function Host() {
    const Bridge = useContextBridge();
    return <Bridge><Child /></Bridge>;
  }
  let root: ReactTestRenderer;
  const tree = (frame: number) => <FrameProvider config={config} frame={frame}><Host /></FrameProvider>;
  await act(() => {
    root = create(tree(0));
  });
  await act(() => {
    root.update(tree(1));
  });
  expect(root!.toJSON()).toMatchObject({ children: ['1'] });
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  await act(() => {
    root.unmount();
  });
});
