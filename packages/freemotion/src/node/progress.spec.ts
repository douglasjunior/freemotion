import { createReporter, type ProgressEvent, type ProgressStream } from './progress.js';


function createMockStream(): ProgressStream & { lines: () => string[]; output: string } {
  let output = '';
  return {
    write: (chunk: string) => {
      output += chunk;
      return true;
    },
    get output() {
      return output;
    },
    lines: () => output.trim().split('\n').filter(Boolean),
  };
}

describe('createReporter', () => {
  describe('mode: json', () => {
    it('emits one valid JSON object per line on stdout', () => {
      const stdout = createMockStream();
      const reporter = createReporter({ mode: 'json', stdout });

      reporter.event({ phase: 'bundle', status: 'start' });
      reporter.event({ phase: 'bundle', status: 'done' });
      reporter.event({ phase: 'audio', id: 'Intro' });
      reporter.event({ phase: 'mux', id: 'Intro' });
      reporter.event({ phase: 'done', id: 'Intro', output: 'out/Intro.mp4', frames: 30, seconds: 1.5 });
      reporter.event({ phase: 'error', message: 'Failed to render' });

      const lines = stdout.lines();
      expect(lines).toHaveLength(6);
      const parsed = lines.map(line => JSON.parse(line));
      expect(parsed).toEqual([
        { phase: 'bundle', status: 'start' },
        { phase: 'bundle', status: 'done' },
        { phase: 'audio', id: 'Intro' },
        { phase: 'mux', id: 'Intro' },
        { phase: 'done', id: 'Intro', output: 'out/Intro.mp4', frames: 30, seconds: 1.5 },
        { phase: 'error', message: 'Failed to render' },
      ]);
    });

    it('throttles frequent progress events to ~4/s and never loses the final event', () => {
      const stdout = createMockStream();
      let now = 1000;
      const reporter = createReporter({
        mode: 'json',
        stdout,
        throttleMs: 250,
        now: () => now,
      });

      // Frame 1: emitted immediately (first event)
      reporter.event({ phase: 'render', id: 'Intro', done: 1, total: 10 });
      // Frame 2-4: within 250ms -> throttled
      now += 50;
      reporter.event({ phase: 'render', id: 'Intro', done: 2, total: 10 });
      now += 50;
      reporter.event({ phase: 'render', id: 'Intro', done: 3, total: 10 });
      now += 50;
      reporter.event({ phase: 'render', id: 'Intro', done: 4, total: 10 });

      // Frame 5: after 250ms elapsed from first event (now = 1260) -> emitted
      now = 1260;
      reporter.event({ phase: 'render', id: 'Intro', done: 5, total: 10 });

      // Frame 6: within 250ms -> throttled
      now += 50;
      reporter.event({ phase: 'render', id: 'Intro', done: 6, total: 10 });

      // Final frame (done === total): only 50ms later -> MUST be emitted
      now += 50;
      reporter.event({ phase: 'render', id: 'Intro', done: 10, total: 10 });

      const parsed = stdout.lines().map(line => JSON.parse(line));
      expect(parsed).toEqual([
        { phase: 'render', id: 'Intro', done: 1, total: 10 },
        { phase: 'render', id: 'Intro', done: 5, total: 10 },
        { phase: 'render', id: 'Intro', done: 10, total: 10 },
      ]);
    });

    it('throttles render and encode independently per composition', () => {
      const stdout = createMockStream();
      const now = 1000;
      const reporter = createReporter({
        mode: 'json',
        stdout,
        throttleMs: 250,
        now: () => now,
      });

      reporter.event({ phase: 'render', id: 'Intro', done: 1, total: 10 });
      reporter.event({ phase: 'encode', id: 'Intro', done: 1, total: 10 });
      reporter.event({ phase: 'render', id: 'Outro', done: 1, total: 10 });

      const parsed = stdout.lines().map(line => JSON.parse(line));
      expect(parsed).toHaveLength(3);
    });
  });

  describe('default mode', () => {
    it('updates logger progress and does not write JSON to stdout', () => {
      const stdout = createMockStream();
      const progressCalls: string[] = [];
      const mockLog = {
        info: vi.fn(),
        progress: (msg: string) => progressCalls.push(msg),
        done: vi.fn(),
        error: vi.fn(),
      };
      let now = 1000;
      const reporter = createReporter({
        stdout,
        log: mockLog,
        throttleMs: 250,
        now: () => now,
      });

      const event: ProgressEvent = { phase: 'encode', id: 'Intro', done: 1, total: 10 };
      reporter.event(event);
      now += 50;
      reporter.event({ phase: 'encode', id: 'Intro', done: 2, total: 10 });
      now = 1300;
      reporter.event({ phase: 'encode', id: 'Intro', done: 5, total: 10 });
      now += 50;
      reporter.event({ phase: 'encode', id: 'Intro', done: 10, total: 10 });

      expect(stdout.output).toBe('');
      expect(progressCalls).toEqual([
        'Intro · 1/10 frames',
        'Intro · 5/10 frames',
        'Intro · 10/10 frames',
      ]);
    });

    it('adds the speed and the time left once there is a second of progress, and drops them at the end', () => {
      const progressCalls: string[] = [];
      const log = { info: vi.fn(), progress: (msg: string) => progressCalls.push(msg), done: vi.fn(), error: vi.fn() };
      let now = 0;
      const reporter = createReporter({ stdout: createMockStream(), log, throttleMs: 250, now: () => now });

      reporter.event({ phase: 'encode', id: 'Intro', done: 0, total: 100 });
      now = 500;
      reporter.event({ phase: 'encode', id: 'Intro', done: 5, total: 100 });
      now = 1000;
      reporter.event({ phase: 'encode', id: 'Intro', done: 10, total: 100 });
      now = 3000;
      reporter.event({ phase: 'encode', id: 'Intro', done: 100, total: 100 });

      expect(progressCalls).toEqual([
        'Intro · 0/100 frames',
        'Intro · 5/100 frames',
        'Intro · 10/100 frames · 10 fps · ETA 9s',
        'Intro · 100/100 frames',
      ]);
    });

    it('estimates rendering and encoding separately', () => {
      const progressCalls: string[] = [];
      const log = { info: vi.fn(), progress: (msg: string) => progressCalls.push(msg), done: vi.fn(), error: vi.fn() };
      let now = 0;
      const reporter = createReporter({ stdout: createMockStream(), log, throttleMs: 250, now: () => now });

      reporter.event({ phase: 'render', id: 'Intro', done: 20, total: 100 });
      now = 2000;
      reporter.event({ phase: 'render', id: 'Intro', done: 40, total: 100 });
      // Encoding starts behind the rendering, at a lower count: it must not read as negative progress.
      now = 2500;
      reporter.event({ phase: 'encode', id: 'Intro', done: 30, total: 100 });
      now = 4500;
      reporter.event({ phase: 'encode', id: 'Intro', done: 50, total: 100 });

      expect(progressCalls).toEqual([
        'Intro · 20/100 frames',
        'Intro · 40/100 frames · 10 fps · ETA 6s',
        'Intro · 30/100 frames',
        'Intro · 50/100 frames · 10 fps · ETA 5s',
      ]);
    });
  });
});
