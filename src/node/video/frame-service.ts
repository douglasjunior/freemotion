import { spawn } from 'node:child_process';

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
  readonly spawn?: typeof spawn;
};

const DEFAULT_CACHE_BYTES = 512 * 1024 * 1024; // 512 MB

export class FrameService {
  private readonly ffmpeg: string;
  private readonly cache: ByteLruCache<FrameResult>;
  private readonly spawnFn: typeof spawn;
  private readonly decoders = new Map<string, FrameDecoder[]>();
  private readonly inflight = new Map<string, Promise<FrameResult>>();
  private isClosed = false;

  constructor(options: FrameServiceOptions = {}) {
    this.ffmpeg = options.ffmpeg ?? 'ffmpeg';
    this.cache = new ByteLruCache<FrameResult>(options.cacheBytes ?? DEFAULT_CACHE_BYTES);
    this.spawnFn = options.spawn ?? spawn;
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

    const fetchPromise = this.fetchFrame(src, frameIndex, info.fps, usePng, info.codec, info.hasAlpha, contentType, format);
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
  ): Promise<FrameResult> {
    if (this.isClosed) {
      throw new Error('freemotion: FrameService is closed.');
    }

    const sourceKey = `${src}:${format}`;
    const allDecoders = this.decoders.get(sourceKey) ?? [];

    // Filter out closed or exited decoders
    const activeDecoders = allDecoders.filter(d => !d.closed && !d.exited);

    const maxJumpFrames = Math.round(2 * fps); // ~2 seconds forward jump threshold

    // Choose active decoder with position <= frameIndex and jump <= maxJumpFrames
    const eligible = activeDecoders.filter(d => d.position <= frameIndex && (frameIndex - d.position) <= maxJumpFrames);

    let decoder: FrameDecoder;
    const firstEligible = eligible.sort((a, b) => b.position - a.position)[0];
    if (firstEligible) {
      // Pick the closest decoder to frameIndex (maximum position)
      decoder = firstEligible;
    } else {
      if (this.isClosed) {
        throw new Error('freemotion: FrameService is closed.');
      }

      // Seek half a frame before target to guarantee the first frame pts matches target
      const startTime = Math.max(0, (frameIndex - 0.5) / fps);
      const isVp9Alpha = codec.includes('vp9') && hasAlpha;

      let currentDecoders = [...activeDecoders];
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

      decoder = new FrameDecoder({
        ffmpeg: this.ffmpeg,
        src,
        fps,
        startTime,
        targetFrameIndex: frameIndex,
        transparent: usePng,
        isVp9Alpha,
        spawn: this.spawnFn,
        onFrame: (idx, buf) => {
          const key = `${src}:${format}:${idx}`;
          const res: FrameResult = {
            buffer: buf,
            contentType,
            format,
            frameIndex: idx,
          };
          this.cache.set(key, res, buf.byteLength);
        },
      });

      currentDecoders.push(decoder);
      this.decoders.set(sourceKey, currentDecoders);
    }

    const buffer = await decoder.requestFrame(frameIndex);
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
