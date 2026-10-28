// Render holds: a composition that needs something asynchronous before a frame is complete (data,
// a font, an image) takes a hold, and the renderer waits until every hold is released.

const DEFAULT_TIMEOUT = 30_000;

type Hold = { readonly label: string; readonly timer: ReturnType<typeof setTimeout> };
type Waiter = { readonly resolve: () => void; readonly reject: (error: Error) => void };

const holds = new Map<number, Hold>();
const waiters = new Set<Waiter>();
let nextHandle = 1;
let failure: Error | null = null;

export type DelayRenderOptions = {
  /** Fails the render if the hold is not released in time. Default 30 000 ms. */
  readonly timeoutInMilliseconds?: number;
};

/** Takes a hold: the renderer won't capture the frame until `continueRender(handle)` is called. */
export function delayRender(label?: string, { timeoutInMilliseconds = DEFAULT_TIMEOUT }: DelayRenderOptions = {}): number {
  const handle = nextHandle++;
  const name = label ?? `delayRender #${handle}`;
  const timer = setTimeout(() => {
    cancelRender(new Error(`freemotion: "${name}" was not released with continueRender() within ${timeoutInMilliseconds} ms.`));
  }, timeoutInMilliseconds);
  holds.set(handle, { label: name, timer });
  return handle;
}

/** Releases a hold taken with `delayRender()`. Releasing twice is harmless. */
export function continueRender(handle: number): void {
  const hold = holds.get(handle);
  if (!hold) {
    return;
  }
  clearTimeout(hold.timer);
  holds.delete(handle);
  if (holds.size === 0) {
    waiters.forEach(waiter => waiter.resolve());
    waiters.clear();
  }
}

/** Aborts the render with an error, e.g. when the data a frame needs failed to load. */
export function cancelRender(error: unknown): void {
  failure = error instanceof Error ? error : new Error(String(error));
  waiters.forEach(waiter => waiter.reject(failure!));
  waiters.clear();
}

/** Labels of the holds still pending. */
export function pendingRenderHolds(): string[] {
  return [...holds.values()].map(hold => hold.label);
}

/** Resolves once no hold is pending; rejects if the render was cancelled. Used by the renderer. */
export function waitForRenderHolds(): Promise<void> {
  if (failure) {
    return Promise.reject(failure);
  }
  if (holds.size === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
}

/** Drops every hold and any failure. For tests. */
export function resetRenderHolds(): void {
  holds.forEach(hold => clearTimeout(hold.timer));
  holds.clear();
  waiters.clear();
  failure = null;
}
