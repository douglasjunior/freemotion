import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { FrameDecoder } from './frame-decoder.js';


describe('FrameDecoder unit tests', () => {
  const JPEG_SAMPLE = Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xD9, // EOI
  ]);

  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // Construct a valid PNG with IDAT containing 'IEND' text inside it, and final IEND chunk
  const createPngWithDeceptiveIdat = () => {
    // IHDR chunk: 13 bytes data
    const ihdrData = Buffer.alloc(13);
    const ihdrLen = Buffer.alloc(4);
    ihdrLen.writeUInt32BE(13, 0);
    const ihdrChunk = Buffer.concat([ihdrLen, Buffer.from('IHDR', 'ascii'), ihdrData, Buffer.alloc(4)]); // 12 + 13 = 25

    // IDAT chunk with 'IEND' inside its payload
    const idatData = Buffer.from('fake data with IEND marker embedded here!', 'ascii');
    const idatLen = Buffer.alloc(4);
    idatLen.writeUInt32BE(idatData.length, 0);
    const idatChunk = Buffer.concat([idatLen, Buffer.from('IDAT', 'ascii'), idatData, Buffer.alloc(4)]);

    // Real IEND chunk
    const iendLen = Buffer.alloc(4);
    iendLen.writeUInt32BE(0, 0);
    const iendChunk = Buffer.concat([iendLen, Buffer.from('IEND', 'ascii'), Buffer.alloc(4)]);

    return Buffer.concat([PNG_HEADER, ihdrChunk, idatChunk, iendChunk]);
  };

  it('parses PNG using chunk length without false positive on IEND in payload', async () => {
    const pngFrame = createPngWithDeceptiveIdat();

    let childStdout: EventEmitter;
    const fakeSpawn = vi.fn().mockImplementation(() => {
      const child = new EventEmitter() as unknown as ChildProcess;
      childStdout = new EventEmitter();
      (childStdout as unknown as { pause: () => void }).pause = vi.fn();
      (childStdout as unknown as { resume: () => void }).resume = vi.fn();
      child.stdout = childStdout as unknown as NonNullable<ChildProcess['stdout']>;
      child.stderr = new EventEmitter() as unknown as NonNullable<ChildProcess['stderr']>;
      child.kill = vi.fn() as unknown as () => boolean;
      return child;
    });

    const emitted: Buffer[] = [];
    const decoder = new FrameDecoder({
      src: 'test.mp4',
      fps: 30,
      transparent: true,
      spawn: fakeSpawn,
      onFrame: (_idx, buf) => emitted.push(buf),
    });

    const reqPromise = decoder.requestFrame(0);

    // Emit PNG in chunks
    const chunk1 = pngFrame.subarray(0, 30);
    const chunk2 = pngFrame.subarray(30);
    childStdout!.emit('data', chunk1);
    childStdout!.emit('data', chunk2);

    const frame = await reqPromise;
    expect(frame).toEqual(pngFrame);
    expect(emitted.length).toBe(1);

    await decoder.close();
  });

  it('marks decoder as exited and rejects pending and future requests when process closes', async () => {
    let childStdout: EventEmitter;
    let childStderr: EventEmitter;
    let childProcess: EventEmitter;

    const fakeSpawn = vi.fn().mockImplementation(() => {
      childProcess = new EventEmitter();
      childStdout = new EventEmitter();
      childStderr = new EventEmitter();
      (childStdout as unknown as { pause: () => void }).pause = vi.fn();
      (childStdout as unknown as { resume: () => void }).resume = vi.fn();
      const cp = childProcess as unknown as ChildProcess;
      cp.stdout = childStdout as unknown as NonNullable<ChildProcess['stdout']>;
      cp.stderr = childStderr as unknown as NonNullable<ChildProcess['stderr']>;
      cp.kill = vi.fn() as unknown as () => boolean;
      return cp;
    });

    const decoder = new FrameDecoder({
      src: 'test.mp4',
      fps: 30,
      spawn: fakeSpawn,
    });

    const pendingRequest = decoder.requestFrame(0);

    // Child process closes with code 1 before frame 0 arrives
    childStderr!.emit('data', Buffer.from('ffmpeg error: file corrupted'));
    childProcess!.emit('close', 1);

    expect(decoder.exited).toBe(true);
    await expect(pendingRequest).rejects.toThrow(/file corrupted/);

    // Future request should reject immediately without hanging
    await expect(decoder.requestFrame(1)).rejects.toThrow(/file corrupted/);

    await decoder.close();
  });

  it('applies backpressure by pausing stdout when 8 frames ahead of request', async () => {
    let childStdout: EventEmitter;
    const pauseSpy = vi.fn();
    const resumeSpy = vi.fn();

    const fakeSpawn = vi.fn().mockImplementation(() => {
      const child = new EventEmitter() as unknown as ChildProcess;
      childStdout = new EventEmitter();
      (childStdout as unknown as { pause: () => void }).pause = pauseSpy;
      (childStdout as unknown as { resume: () => void }).resume = resumeSpy;
      child.stdout = childStdout as unknown as NonNullable<ChildProcess['stdout']>;
      child.stderr = new EventEmitter() as unknown as NonNullable<ChildProcess['stderr']>;
      child.kill = vi.fn() as unknown as () => boolean;
      return child;
    });

    const decoder = new FrameDecoder({
      src: 'test.mp4',
      fps: 30,
      spawn: fakeSpawn,
    });

    // Request frame 0
    decoder.requestFrame(0).catch(() => undefined);

    // Emit 8 JPEG frames
    for (let i = 0; i < 8; i++) {
      childStdout!.emit('data', JPEG_SAMPLE);
    }
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    // Now request frame 10 (not yet decoded): position is 8 < 10 + 8 = 18, should resume
    decoder.requestFrame(10).catch(() => undefined);
    expect(resumeSpy).toHaveBeenCalledTimes(1);

    await decoder.close();
  });
});
