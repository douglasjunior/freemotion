import { produceInOrder } from './ordered-frames.js';


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('produceInOrder', () => {
  it('consumes in order even when workers finish out of order', async () => {
    const frames = Array.from({ length: 30 }, (_, i) => i + 100);
    const consumed: number[] = [];
    await produceInOrder({
      frames,
      workers: ['a', 'b', 'c'],
      ahead: 6,
      produce: async (_, frame) => {
        await sleep((frame * 7) % 5);
        return frame;
      },
      consume: (item) => {
        consumed.push(item);
      },
    });
    expect(consumed).toEqual(frames);
  });

  it('never runs further ahead than allowed', async () => {
    let written = 0;
    let maxLead = 0;
    await produceInOrder({
      frames: Array.from({ length: 40 }, (_, i) => i),
      workers: [1, 2, 3, 4],
      ahead: 3,
      produce: async (_, frame) => {
        maxLead = Math.max(maxLead, frame - written);
        await sleep(frame % 3);
        return frame;
      },
      consume: async () => {
        await sleep(2);
        written++;
      },
    });
    expect(maxLead).toBeLessThanOrEqual(3 + 1);
  });

  it('uses every worker', async () => {
    const used = new Set<string>();
    await produceInOrder({
      frames: Array.from({ length: 12 }, (_, i) => i),
      workers: ['a', 'b', 'c'],
      ahead: 12,
      produce: async (worker, frame) => {
        used.add(worker);
        await sleep(1);
        return frame;
      },
      consume: () => undefined,
    });
    expect(used).toEqual(new Set(['a', 'b', 'c']));
  });

  it('rejects when a frame fails', async () => {
    await expect(produceInOrder({
      frames: [0, 1, 2, 3],
      workers: [0, 1],
      ahead: 4,
      produce: async (_, frame) => {
        if (frame === 2) {
          throw new Error('frame 2 broke');
        }
        return frame;
      },
      consume: () => undefined,
    })).rejects.toThrow('frame 2 broke');
  });
});
