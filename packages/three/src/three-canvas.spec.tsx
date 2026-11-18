import { frameToSeconds } from './three-canvas.js';


it('maps frames to seconds', () => {
  expect([0, 1, 30].map(frame => frameToSeconds(frame, 30))).toEqual([0, 1 / 30, 1]);
});

it('holds a suspended render until its fallback unmounts', async () => {
  const { act, create } = await import('react-test-renderer');
  const { createElement } = await import('react');
  const { HoldFallback } = await import('./three-canvas.js');
  const { setEnvironment, resetEnvironment } = await import('../../../src/runtime/environment.js');
  const { pendingRenderHolds, resetRenderHolds } = await import('../../../src/runtime/delay-render.js');
  setEnvironment({ isRendering: true });
  let root: ReturnType<typeof create>;
  try {
    await act(() => {
      root = create(createElement(HoldFallback));
    });
    expect(pendingRenderHolds()).toContain('ThreeCanvas Suspense');
    await act(() => {
      root.unmount();
    });
    expect(pendingRenderHolds()).toEqual([]);
  } finally {
    resetRenderHolds();
    resetEnvironment();
  }
});

it('holds while a child suspends and releases when it resolves', async () => {
  const { act, create } = await import('react-test-renderer');
  const { createElement, Suspense } = await import('react');
  const { HoldFallback } = await import('./three-canvas.js');
  const { setEnvironment, resetEnvironment } = await import('../../../src/runtime/environment.js');
  const { pendingRenderHolds, resetRenderHolds } = await import('../../../src/runtime/delay-render.js');
  let resolve!: () => void;
  let ready = false;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  function Child() {
    if (!ready) throw promise;
    return null;
  }
  setEnvironment({ isRendering: true });
  let root: ReturnType<typeof create>;
  try {
    await act(() => {
      root = create(createElement(Suspense, { fallback: createElement(HoldFallback) }, createElement(Child)));
    });
    expect(pendingRenderHolds()).toContain('ThreeCanvas Suspense');
    await act(async () => {
      ready = true;
      resolve();
      await promise;
    });
    expect(pendingRenderHolds()).toEqual([]);
    await act(() => {
      root.unmount();
    });
  } finally {
    resetRenderHolds();
    resetEnvironment();
  }
});
