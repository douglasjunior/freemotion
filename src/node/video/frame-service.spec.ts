import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:stream';

import { FrameService } from './frame-service.js';
import * as probeModule from './probe.js';


const hasFfmpeg = (() => {
  try {
    const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
})();

function toRgb24(buffer: Buffer): Buffer {
  const res = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-i',
    '-',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ], { input: buffer });
  return res.stdout;
}

describe('FrameService unit logic', () => {
  const JPEG_FRAME = Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xD9, // EOI
  ]);

  it('dedupes two identical concurrent requests into a single decode', async () => {
    vi.spyOn(probeModule, 'probeMedia').mockResolvedValue({
      width: 64,
      height: 64,
      fps: 30,
      duration: 10,
      start: 0,
      codec: 'h264',
      pixFmt: 'yuv420p',
      hasAlpha: false,
      hasAudio: false,
    });

    let spawnCount = 0;
    const fakeSpawn = vi.fn().mockImplementation(() => {
      spawnCount++;
      const child = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter() as unknown as NonNullable<ChildProcess['stdout']>;
      stdout.pause = vi.fn() as unknown as () => typeof stdout;
      stdout.resume = vi.fn() as unknown as () => typeof stdout;
      child.stdout = stdout;
      child.stderr = new EventEmitter() as unknown as NonNullable<ChildProcess['stderr']>;
      child.kill = vi.fn().mockImplementation(() => {
        child.emit('close', 0);
        return true;
      }) as unknown as () => boolean;

      setTimeout(() => {
        stdout.emit('data', JPEG_FRAME);
      }, 10);

      return child;
    });

    const service = new FrameService({ spawn: fakeSpawn });

    // Request same frame twice simultaneously
    const [res1, res2] = await Promise.all([
      service.getFrame({ src: 'sample.mp4', time: 0 }),
      service.getFrame({ src: 'sample.mp4', time: 0 }),
    ]);

    expect(res1.buffer).toEqual(JPEG_FRAME);
    expect(res2.buffer).toEqual(JPEG_FRAME);
    expect(spawnCount).toBe(1);

    await service.close();
    vi.restoreAllMocks();
  });

  it('rejects immediately if closed and prevents spawning new decoders', async () => {
    let spawnCount = 0;
    const fakeSpawn = vi.fn().mockImplementation(() => {
      spawnCount++;
      return new EventEmitter();
    });

    const service = new FrameService({ spawn: fakeSpawn });
    await service.close();

    await expect(service.getFrame({ src: 'sample.mp4', time: 0 })).rejects.toThrow(/closed/);
    expect(spawnCount).toBe(0);
  });
});

describe.runIf(hasFfmpeg)('FrameService with real ffmpeg', () => {
  let tmpDir: string;
  let testVideoPath: string;
  let testVideo60FpsPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'freemotion-test-frames-'));
    testVideoPath = join(tmpDir, 'test.mp4');
    testVideo60FpsPath = join(tmpDir, 'test60.mp4');

    // Generate 4-second 30 fps video (120 frames total)
    spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x64:rate=30',
      '-t',
      '4',
      testVideoPath,
    ]);

    // Generate 2-second 60 fps video (120 frames total)
    spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x64:rate=60',
      '-t',
      '2',
      testVideo60FpsPath,
    ]);
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('maps arbitrary composition time to correct frame on a 60 fps source', async () => {
    const service = new FrameService();

    // Composition at 30 fps, frame 1 -> time = 1 / 30 s -> should be source frame 2
    const f1 = await service.getFrame({ src: testVideo60FpsPath, time: 1 / 30 });
    expect(f1.frameIndex).toBe(2);

    // Composition at 30 fps, frame 2 -> time = 2 / 30 s -> should be source frame 4
    const f2 = await service.getFrame({ src: testVideo60FpsPath, time: 2 / 30 });
    expect(f2.frameIndex).toBe(4);

    // Composition at 30 fps, frame 15 -> time = 0.5 s -> should be source frame 30
    const f15 = await service.getFrame({ src: testVideo60FpsPath, time: 0.5 });
    expect(f15.frameIndex).toBe(30);

    await service.close();
  });

  it('uses 1 spawn for sequential requests and reads forward on small jumps', async () => {
    let spawnCount = 0;
    const trackingSpawn = ((...args: [string, readonly string[], object]) => {
      spawnCount++;
      return spawn(args[0], args[1], args[2]);
    }) as unknown as typeof spawn;

    const service = new FrameService({ spawn: trackingSpawn });

    // Frame 0 (time = 0)
    const f0 = await service.getFrame({ src: testVideoPath, time: 0 });
    expect(f0.frameIndex).toBe(0);
    expect(spawnCount).toBe(1);

    // Frame 1 (time = 1/30) - sequential
    const f1 = await service.getFrame({ src: testVideoPath, time: 1 / 30 });
    expect(f1.frameIndex).toBe(1);
    expect(spawnCount).toBe(1);

    // Frame 15 (jump of 14 frames = ~0.46s <= 2s) - reads forward without new spawn
    const f15 = await service.getFrame({ src: testVideoPath, time: 15 / 30 });
    expect(f15.frameIndex).toBe(15);
    expect(spawnCount).toBe(1);

    // Frame 5 was read de passagem, should be in cache
    const f5 = await service.getFrame({ src: testVideoPath, time: 5 / 30 });
    expect(f5.frameIndex).toBe(5);
    expect(spawnCount).toBe(1);

    // Large jump forward: Frame 90 (jump of 75 frames > 2s = 60 frames) -> should spawn new seek
    const f90 = await service.getFrame({ src: testVideoPath, time: 90 / 30 });
    expect(f90.frameIndex).toBe(90);
    expect(spawnCount).toBe(2);

    await service.close();
  });

  it('seeks when requesting backwards for a frame not in cache', async () => {
    let spawnCount = 0;
    const trackingSpawn = ((...args: [string, readonly string[], object]) => {
      spawnCount++;
      return spawn(args[0], args[1], args[2]);
    }) as unknown as typeof spawn;

    // Small cache so frame 0 will be evicted
    const service = new FrameService({ spawn: trackingSpawn, cacheBytes: 100 });

    // Request frame 20 (starts decoder 1 at position 20)
    await service.getFrame({ src: testVideoPath, time: 20 / 30 });
    expect(spawnCount).toBe(1);

    // Request frame 90 (jump of 70 frames > 2s forces new decoder at 90)
    await service.getFrame({ src: testVideoPath, time: 90 / 30 });
    expect(spawnCount).toBe(2);

    // Request frame 0 (backwards, not in cache, prior to all decoders) -> new seek!
    const f0 = await service.getFrame({ src: testVideoPath, time: 0 });
    expect(f0.frameIndex).toBe(0);
    expect(spawnCount).toBe(3);

    await service.close();
  });

  it('matches single-frame ffmpeg extraction pixel-for-pixel on multiple frames', async () => {
    const service = new FrameService();

    // Verify frames 2, 5, 7, 10
    for (const frame of [2, 5, 7, 10]) {
      const time = frame / 30;
      const frameResult = await service.getFrame({ src: testVideoPath, time });

      const seekTime = Math.max(0, (frame - 0.5) / 30);
      const single = spawnSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        seekTime.toFixed(6),
        '-i',
        testVideoPath,
        '-vf',
        'scale=out_color_matrix=bt601:out_range=pc,format=yuvj420p',
        '-frames:v',
        '1',
        '-c:v',
        'mjpeg',
        '-q:v',
        '2',
        '-f',
        'image2pipe',
        '-',
      ]);

      expect(single.status).toBe(0);

      const rgbService = toRgb24(frameResult.buffer);
      const rgbSingle = toRgb24(single.stdout);

      expect(rgbService.length).toBe(rgbSingle.length);

      let delta = 0;
      for (let i = 0; i < rgbService.length; i++) {
        delta += Math.abs((rgbService[i] ?? 0) - (rgbSingle[i] ?? 0));
      }
      const avgDelta = delta / rgbService.length;
      expect(avgDelta).toBeLessThan(1.0); // exact pixel match within JPEG compression tolerance
    }

    await service.close();
  });
});
