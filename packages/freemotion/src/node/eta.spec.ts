import { createRateTracker, describeRate, formatDuration } from './eta.js';


describe('formatDuration', () => {
  it('shows seconds, minutes with seconds, or hours with minutes', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(60)).toBe('1m 00s');
    expect(formatDuration(725)).toBe('12m 05s');
    expect(formatDuration(3600)).toBe('1h 00m');
    expect(formatDuration(8040)).toBe('2h 14m');
  });

  it('rounds to the nearest second and never goes negative', () => {
    expect(formatDuration(44.6)).toBe('45s');
    expect(formatDuration(-3)).toBe('0s');
  });
});

describe('createRateTracker', () => {
  it('gives no estimate until there is a second of progress to measure', () => {
    const tracker = createRateTracker();
    expect(tracker.update(0, 1, 100)).toBeNull();
    expect(tracker.update(500, 3, 100)).toBeNull();
    expect(tracker.update(1000, 5, 100)).toEqual({ perSecond: 4, etaSeconds: 23.75 });
  });

  it('gives no estimate when nothing moved, or when it is finished', () => {
    const tracker = createRateTracker();
    tracker.update(0, 10, 100);
    expect(tracker.update(2000, 10, 100)).toBeNull();
    expect(tracker.update(4000, 100, 100)).toBeNull();
  });

  it('follows the recent speed instead of the average since the start', () => {
    const tracker = createRateTracker({ windowMs: 10_000 });
    // 20 s at 1 frame per second, then 20 s at 10 frames per second.
    let done = 0;
    for (let time = 0; time <= 20_000; time += 1000) {
      tracker.update(time, (done = time / 1000), 1000);
    }
    let rate = tracker.update(20_000, done, 1000);
    expect(rate!.perSecond).toBeCloseTo(1, 5);
    for (let time = 21_000; time <= 40_000; time += 1000) {
      done += 10;
      rate = tracker.update(time, done, 1000);
    }
    expect(rate!.perSecond).toBeCloseTo(10, 0);
    expect(rate!.etaSeconds).toBeCloseTo((1000 - done) / 10, 0);
  });
});

describe('describeRate', () => {
  it('writes the speed and the time left', () => {
    expect(describeRate({ perSecond: 4.234, etaSeconds: 8040 })).toBe('4.2 fps · ETA 2h 14m');
    expect(describeRate({ perSecond: 37.8, etaSeconds: 30 })).toBe('38 fps · ETA 30s');
  });
});
