import { useEffect, useState, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { vi } from 'vitest';

import { pendingRenderHolds, resetRenderHolds } from '../../freemotion/src/runtime/delay-render.js';
import { resetEnvironment, setEnvironment } from '../../freemotion/src/runtime/environment.js';
import { FrameProvider } from '../../freemotion/src/runtime/frame.js';

import { ThreeCanvas } from './three-canvas.js';


const calls = vi.hoisted(() => ({ advance: vi.fn() }));
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      setMounted(true);
    }, []);
    return mounted ? children : null;
  },
  useThree: (select: (state: { advance: typeof calls.advance }) => unknown) => select({ advance: calls.advance }),
}));

it('holds each frame until its draw completes', async () => {
  setEnvironment({ isRendering: true });
  const observed: string[][] = [];
  calls.advance.mockImplementation(() => {
    observed.push(pendingRenderHolds());
  });
  const config = { fps: 30, width: 100, height: 100, durationInFrames: 30 };
  const tree = (frame: number) => <FrameProvider config={config} frame={frame}><ThreeCanvas width={100} height={100} /></FrameProvider>;
  let root: ReactTestRenderer;
  try {
    await act(() => {
      root = create(tree(0));
    });
    expect(observed[0]).toContain('ThreeCanvas frame 0');
    expect(pendingRenderHolds()).toEqual([]);
    await act(() => {
      root.update(tree(1));
    });
    expect(observed[1]).toContain('ThreeCanvas frame 1');
    expect(pendingRenderHolds()).toEqual([]);
    await act(() => {
      root.unmount();
    });
  } finally {
    resetRenderHolds();
    resetEnvironment();
  }
});
