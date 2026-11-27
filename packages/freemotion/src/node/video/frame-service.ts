import { spawn } from 'node:child_process';
import { totalmem } from 'node:os';

import { FrameDecoder } from './frame-decoder.js';
import { sourceFrameIndex } from './frame-math.js';
import { ByteLruCache } from './lru-cache.js';
import { probeMedia } from './probe.js';


export type FrameResult = {
  readonly buffer: Buffer;
  readonly contentType: 'image/jpeg' | 'image/png';
  readonly format: 'jpeg' | 'png';
  readonly frameIndex: number;
};

export type GetFrameOptions = {
  readonly src: string;
  readonly time: number;
  readonly transparent?: boolean;
};

export type FrameServiceOptions = {
  readonly ffmpeg?: string;
  readonly cacheBytes?: number;
  /**
   * Memory the ffmpeg decoders may use together. A decoder holds the frames of a whole video stream
   * and costs about 200 bytes per pixel of the video (1.4 to 1.8 GB for 4K), so a render that goes
   * through many videos would otherwise keep one decoder of each. When a new decoder does not fit,
   * the idle ones used least recently are closed. Decoders waiting for a frame are never closed, so a
   * render can go above this while several frames are requested at once.
   * Default: 35% of the machine's memory.
   */
  readonly decoderBudgetBytes?: number;
  readonly spawn?: typeof spawn;
};

const DEFAULT_CACHE_BYTES = 512 * 1024 * 1024; // 512 MB
const DEFAULT_BUDGET_SHARE = 0.35;
/** How often a request that does not fit in the memory budget looks again. */
const WAIT_FOR_MEMORY_MS = 25;
/** Measured on 4K H.264 (1.4 to 1.8 GB for one stream): ffmpeg's decode, scale and JPEG queues. */
const DECODER_BYTES_PER_PIXEL = 200;

export class FrameService {
  private readonly ffmpeg: string;
  private readonly cache: ByteLruCache<FrameResult>;
  private readonly spawnFn: typeof spawn;
  private readonly decoderBudgetBytes: number;
  private readonly decoderBytes = new WeakMap<FrameDecoder, number>();
  private readonly decoders = new Map<string, FrameDecoder[]>();
  private readonly inflight = new Map<string, Promise<FrameResult>>();
  private isClosed = false;

  constructor(options: FrameServiceOptions = {}) {
    this.ffmpeg = options.ffmpeg ?? 'ffmpeg';
    this.cache = new ByteLruCache<FrameResult>(options.cacheBytes ?? DEFAULT_CACHE_BYTES);
    this.spawnFn = options.spawn ?? spawn;
    this.decoderBudgetBytes = options.decoderBudgetBytes ?? totalmem() * DEFAULT_BUDGET_SHARE;
  }

  get cacheBytes(): number {
    return this.cache.bytes;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  async getFrame({ src, time, transparent = false }: GetFrameOptions): Promise<FrameResult> {
    if (this.isClosed) {
      throw new Error('freemotion: FrameService is closed.');
    }

    const info = await probeMedia(src, this.ffmpeg);

    if (this.isClosed) {
      throw new Error('freemotion: FrameService is closed.');
    }

    const frameIndex = sourceFrameIndex(time, info.fps);
    const usePng = Boolean(transparent && info.hasAlpha);
    const contentType = usePng ? 'image/png' : 'image/jpeg';
    const format = usePng ? 'png' : 'jpeg';

    const cacheKey = `${src}:${format}:${frameIndex}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.inflight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const fetchPromise = this.fetchFrame(src, frameIndex, info.fps, usePng, info.codec, info.hasAlpha, contentType, format, info.width * info.height * DECODER_BYTES_PER_PIXEL);
    this.inflight.set(cacheKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  private async fetchFrame(
    src: string,
    frameIndex: number,
    fps: number,
    usePng: boolean,
    codec: string,
    hasAlpha: boolean,
    contentType: 'image/jpeg' | 'image/png',
    format: 'jpeg' | 'png',
    decoderCost: number,
  ): Promise<FrameResult> {
    if (this.isClosed) {
      throw new Error('freemotion: FrameService is closed.');
    }

    const buffer = await this.requestFromDecoder({ src, frameIndex, fps, usePng, codec, hasAlpha, contentType, format, cost: decoderCost });
    const result: FrameResult = {
      buffer,
      contentType,
      format,
      frameIndex,
    };

    const cacheKey = `${src}:${format}:${frameIndex}`;
    this.cache.set(cacheKey, result, buffer.byteLength);
    return result;
  }

  /**
   * Asks for `frameIndex` from a decoder that can serve it: one already running just before it, or a
   * new one. A new one is only started once it fits in the memory budget. Until then the request waits,
   * because the decoders in the way are busy serving frames and become idle, and closable, as they finish.
   * The frame is requested in the same step the decoder is picked, so that no other request sees it as
   * idle and closes it in between.
   */
  private async requestFromDecoder({ src, frameIndex, fps, usePng, codec, hasAlpha, contentType, format, cost }: {
    readonly src: string;
    readonly frameIndex: number;
    readonly fps: number;
    readonly usePng: boolean;
    readonly codec: string;
    readonly hasAlpha: boolean;
    readonly contentType: 'image/jpeg' | 'image/png';
    readonly format: 'jpeg' | 'png';
    readonly cost: number;
  }): Promise<Buffer> {
    const sourceKey = `${src}:${format}`;
    const maxJumpFrames = Math.round(2 * fps); // ~2 seconds forward jump threshold

    for (;;) {
      if (this.isClosed) {
        throw new Error('freemotion: FrameService is closed.');
      }

      const activeDecoders = (this.decoders.get(sourceKey) ?? []).filter(d => !d.closed && !d.exited);

      // The active decoder closest before the frame, no more than ~2 seconds behind it.
      const closest = activeDecoders
        .filter(d => d.position <= frameIndex && (frameIndex - d.position) <= maxJumpFrames)
        .sort((a, b) => b.position - a.position)[0];
      if (closest) {
        return closest.requestFrame(frameIndex);
      }

      if (!this.makeRoomForDecoder(cost)) {
        await new Promise(resolve => setTimeout(resolve, WAIT_FOR_MEMORY_MS));
        continue;
      }

      let currentDecoders = activeDecoders.filter(d => !d.closed);
      if (currentDecoders.length >= 2) {
        // Prefer closing an idle decoder (pendingCount === 0)
        const idleDecoders = currentDecoders.filter(d => d.pendingCount === 0);
        if (idleDecoders.length > 0) {
          idleDecoders.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
          const toClose = idleDecoders[0]!;
          currentDecoders = currentDecoders.filter(d => d !== toClose);
          void toClose.close();
        }
      }

      const decoder = new FrameDecoder({
        ffmpeg: this.ffmpeg,
        src,
        fps,
        // Seek half a frame before target to guarantee the first frame pts matches target
        startTime: Math.max(0, (frameIndex - 0.5) / fps),
        targetFrameIndex: frameIndex,
        transparent: usePng,
        isVp9Alpha: codec.includes('vp9') && hasAlpha,
        spawn: this.spawnFn,
        onFrame: (idx, buf) => {
          this.cache.set(`${src}:${format}:${idx}`, { buffer: buf, contentType, format, frameIndex: idx }, buf.byteLength);
        },
      });
      this.decoderBytes.set(decoder, cost);
      currentDecoders.push(decoder);
      this.decoders.set(sourceKey, currentDecoders);
      return decoder.requestFrame(frameIndex);
    }
  }

  /** Decoders that are still running, of every video. Forgets the ones that ended. */
  private liveDecoders(): FrameDecoder[] {
    const live: FrameDecoder[] = [];
    for (const [key, list] of this.decoders) {
      const running = list.filter(decoder => !decoder.closed && !decoder.exited);
      if (running.length > 0) {
        this.decoders.set(key, running);
        live.push(...running);
      } else {
        this.decoders.delete(key);
      }
    }
    return live;
  }

  /**
   * Closes the least recently used idle decoders, of any video, until one more of `cost` bytes fits in
   * the budget. Returns false when it still does not fit because the rest are busy. A decoder is always
   * allowed when none is running, even one bigger than the whole budget.
   */
  private makeRoomForDecoder(cost: number): boolean {
    const live = this.liveDecoders();
    const idle = live.filter(decoder => decoder.pendingCount === 0).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    let used = live.reduce((sum, decoder) => sum + (this.decoderBytes.get(decoder) ?? 0), 0);
    let running = live.length;
    for (const decoder of idle) {
      if (used + cost <= this.decoderBudgetBytes) {
        break;
      }
      used -= this.decoderBytes.get(decoder) ?? 0;
      running--;
      void decoder.close();
    }
    return running === 0 || used + cost <= this.decoderBudgetBytes;
  }

  async close(): Promise<void> {
    this.isClosed = true;

    // Wait for in-flight requests to complete or abort
    if (this.inflight.size > 0) {
      await Promise.allSettled(Array.from(this.inflight.values()));
    }

    const closePromises: Promise<void>[] = [];
    for (const decodersList of this.decoders.values()) {
      for (const decoder of decodersList) {
        closePromises.push(decoder.close());
      }
    }
    await Promise.all(closePromises);
    this.decoders.clear();
    this.cache.clear();
    this.inflight.clear();
  }
}
