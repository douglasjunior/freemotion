import { spawn, type ChildProcess } from 'node:child_process';

import { sourceFrameIndex } from './frame-math.js';


const JPEG_SOI = Buffer.from([0xFF, 0xD8]);
const JPEG_EOI = Buffer.from([0xFF, 0xD9]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const PNG_IEND = Buffer.from('IEND', 'ascii');

export type FrameDecoderOptions = {
  readonly ffmpeg?: string;
  readonly src: string;
  readonly fps: number;
  readonly startTime?: number;
  readonly transparent?: boolean;
  readonly isVp9Alpha?: boolean;
  readonly spawn?: typeof spawn;
  readonly onFrame?: (frameIndex: number, buffer: Buffer) => void;
};

type FrameWaiter = {
  readonly resolve: (buffer: Buffer) => void;
  readonly reject: (error: Error) => void;
};

/**
 * Long-lived sequential frame decoder driven by ffmpeg stdout pipe.
 */
export class FrameDecoder {
  readonly startFrame: number;
  private currentFrameIndex: number;
  private maxRequestedFrame: number;
  private isPaused = false;
  private isClosed = false;

  private child: ChildProcess | null = null;
  private accumulated = Buffer.alloc(0);
  private stderrOutput = '';
  private readonly pendingWaiters = new Map<number, FrameWaiter>();
  private readonly decodedFrames = new Map<number, Buffer>();

  lastUsedAt: number;

  constructor(private readonly options: FrameDecoderOptions) {
    const startTime = options.startTime ?? 0;
    this.startFrame = sourceFrameIndex(startTime, options.fps);
    this.currentFrameIndex = this.startFrame;
    this.maxRequestedFrame = this.startFrame;
    this.lastUsedAt = Date.now();

    this.startProcess();
  }

  get position(): number {
    return this.currentFrameIndex;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  private startProcess(): void {
    const {
      ffmpeg = 'ffmpeg',
      src,
      startTime = 0,
      transparent = false,
      isVp9Alpha = false,
      spawn: spawnFn = spawn,
    } = this.options;

    const args: string[] = ['-hide_banner', '-loglevel', 'error'];

    if (isVp9Alpha) {
      args.push('-c:v', 'libvpx-vp9');
    }

    if (startTime > 0) {
      args.push('-ss', startTime.toFixed(4));
    }

    args.push('-i', src, '-an', '-fps_mode', 'passthrough');

    if (transparent) {
      args.push('-c:v', 'png', '-pix_fmt', 'rgba', '-f', 'image2pipe', '-');
    } else {
      args.push(
        '-vf',
        'scale=out_color_matrix=bt601:out_range=pc,format=yuvj420p',
        '-c:v',
        'mjpeg',
        '-q:v',
        '2',
        '-f',
        'image2pipe',
        '-',
      );
    }

    const child = spawnFn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.accumulated = Buffer.concat([this.accumulated, chunk]);
      this.parseFrames();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrOutput += chunk.toString('utf-8');
    });

    child.on('error', (err: Error) => {
      this.rejectAll(err);
    });

    child.on('close', (code: number | null) => {
      if (this.pendingWaiters.size > 0 && !this.isClosed) {
        const errorMsg = this.stderrOutput.trim()
          || `freemotion: ffmpeg process exited with code ${code} before requested frames were produced.`;
        this.rejectAll(new Error(errorMsg));
      }
    });
  }

  private parseFrames(): void {
    const isPng = Boolean(this.options.transparent);

    while (this.accumulated.length > 0) {
      if (isPng) {
        const startIndex = this.accumulated.indexOf(PNG_HEADER);
        if (startIndex === -1) {
          break;
        }
        const iendIndex = this.accumulated.indexOf(PNG_IEND, startIndex + 8);
        if (iendIndex === -1) {
          break;
        }
        const frameEnd = iendIndex + 8; // 'IEND' (4 bytes) + CRC (4 bytes)
        if (this.accumulated.length < frameEnd) {
          break;
        }

        const frameBuffer = this.accumulated.subarray(startIndex, frameEnd);
        this.accumulated = this.accumulated.subarray(frameEnd);
        this.emitFrame(frameBuffer);
      } else {
        const startIndex = this.accumulated.indexOf(JPEG_SOI);
        if (startIndex === -1) {
          break;
        }
        const endIndex = this.accumulated.indexOf(JPEG_EOI, startIndex + 2);
        if (endIndex === -1) {
          break;
        }

        const frameBuffer = this.accumulated.subarray(startIndex, endIndex + 2);
        this.accumulated = this.accumulated.subarray(endIndex + 2);
        this.emitFrame(frameBuffer);
      }
    }

    this.checkBackpressure();
  }

  private emitFrame(buffer: Buffer): void {
    const frameIndex = this.currentFrameIndex++;
    this.decodedFrames.set(frameIndex, buffer);
    if (this.decodedFrames.size > 32) {
      const oldest = this.decodedFrames.keys().next().value;
      if (oldest !== undefined) {
        this.decodedFrames.delete(oldest);
      }
    }

    this.options.onFrame?.(frameIndex, buffer);

    const waiter = this.pendingWaiters.get(frameIndex);
    if (waiter) {
      this.pendingWaiters.delete(frameIndex);
      waiter.resolve(buffer);
    }
  }

  private checkBackpressure(): void {
    if (!this.child?.stdout) {
      return;
    }

    // Pause stdout if we are 8 or more frames ahead of the highest requested frame
    if (this.currentFrameIndex >= this.maxRequestedFrame + 8) {
      if (!this.isPaused) {
        this.isPaused = true;
        this.child.stdout.pause();
      }
    } else if (this.isPaused) {
      this.isPaused = false;
      this.child.stdout.resume();
    }
  }

  requestFrame(frameIndex: number): Promise<Buffer> {
    this.lastUsedAt = Date.now();

    if (this.isClosed) {
      return Promise.reject(new Error('freemotion: decoder is closed.'));
    }

    if (frameIndex < this.startFrame) {
      return Promise.reject(
        new Error(`freemotion: frame ${frameIndex} is prior to decoder startFrame ${this.startFrame}.`),
      );
    }

    if (this.decodedFrames.has(frameIndex)) {
      return Promise.resolve(this.decodedFrames.get(frameIndex)!);
    }

    this.maxRequestedFrame = Math.max(this.maxRequestedFrame, frameIndex);
    if (this.isPaused && this.currentFrameIndex < this.maxRequestedFrame + 8) {
      this.isPaused = false;
      this.child?.stdout?.resume();
    }

    return new Promise<Buffer>((resolve, reject) => {
      this.pendingWaiters.set(frameIndex, { resolve, reject });
    });
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.pendingWaiters.values()) {
      waiter.reject(error);
    }
    this.pendingWaiters.clear();
  }

  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.rejectAll(new Error('freemotion: decoder was closed.'));

    const child = this.child;
    this.child = null;
    this.accumulated = Buffer.alloc(0);
    this.decodedFrames.clear();

    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          child.kill('SIGKILL');
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
  }
}
