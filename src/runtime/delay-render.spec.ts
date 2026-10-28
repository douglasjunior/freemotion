import { cancelRender, continueRender, delayRender, pendingRenderHolds, resetRenderHolds, waitForRenderHolds } from './delay-render.js';


describe('delayRender', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRenderHolds();
  });

  afterEach(() => {
    resetRenderHolds();
    vi.useRealTimers();
  });

  it('resolves right away without holds', async () => {
    await expect(waitForRenderHolds()).resolves.toBeUndefined();
  });

  it('waits until every hold is released', async () => {
    const a = delayRender('data');
    const b = delayRender('font');
    let done = false;
    const waiting = waitForRenderHolds().then(() => {
      done = true;
    });

    continueRender(a);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(pendingRenderHolds()).toEqual(['font']);

    continueRender(b);
    await waiting;
    expect(done).toBe(true);
  });

  it('ignores releasing the same handle twice', async () => {
    const handle = delayRender();
    continueRender(handle);
    continueRender(handle);
    await expect(waitForRenderHolds()).resolves.toBeUndefined();
  });

  it('fails when a hold times out', async () => {
    delayRender('slow fetch', { timeoutInMilliseconds: 1000 });
    const waiting = waitForRenderHolds();
    vi.advanceTimersByTime(1000);
    await expect(waiting).rejects.toThrow(/"slow fetch" was not released .* 1000 ms/);
  });

  it('fails when the render is cancelled', async () => {
    delayRender();
    const waiting = waitForRenderHolds();
    cancelRender('no data');
    await expect(waiting).rejects.toThrow('no data');
    await expect(waitForRenderHolds()).rejects.toThrow('no data');
  });
});
