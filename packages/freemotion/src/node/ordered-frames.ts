export type OrderedFramesOptions<Worker, Item> = {
  /** Frame numbers to produce, in output order. */
  readonly frames: readonly number[];
  /** Each worker produces one frame at a time (e.g. a browser tab). */
  readonly workers: readonly Worker[];
  /** How far a worker may run ahead of the next frame to be consumed. Bounds memory. */
  readonly ahead: number;
  readonly produce: (worker: Worker, frame: number) => Promise<Item>;
  /** Called strictly in `frames` order; backpressure is respected by awaiting it. */
  readonly consume: (item: Item, frame: number) => Promise<void> | void;
};

/**
 * Produces frames in parallel and consumes them in order. Workers claim the next free frame, wait
 * while they are too far ahead, and hand results to an in-order flush.
 */
export async function produceInOrder<Worker, Item>({ frames, workers, ahead, produce, consume }: OrderedFramesOptions<Worker, Item>): Promise<void> {
  const ready = new Map<number, Item>();
  const waiting: (() => void)[] = [];
  let claimed = 0;
  let written = 0;
  let flushing: Promise<void> = Promise.resolve();
  let failed = false;

  const flush = async () => {
    while (ready.has(written)) {
      const item = ready.get(written)!;
      ready.delete(written);
      const index = written++;
      waiting.splice(0).forEach(wake => wake());
      await consume(item, frames[index]!);
    }
  };

  const run = async (worker: Worker) => {
    while (claimed < frames.length && !failed) {
      const index = claimed++;
      while (index - written > ahead && !failed) {
        await new Promise<void>(resolve => waiting.push(resolve));
      }
      try {
        ready.set(index, await produce(worker, frames[index]!));
      } catch (error) {
        failed = true;
        waiting.splice(0).forEach(wake => wake());
        throw error;
      }
      // Flushes run one after the other so `consume` never overlaps itself.
      flushing = flushing.then(flush);
      await flushing;
    }
  };

  await Promise.all(workers.map(run));
}
