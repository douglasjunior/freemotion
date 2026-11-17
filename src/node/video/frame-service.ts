import { spawn } from 'node:child_process';

import { FrameDecoder } from './frame-decoder.js';
import { sourceFrameIndex, sourceTimeFromIndex } from './frame-math.js';
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
    const sourceKey = `${src}:${format}`;
    const decoders = this.decoders.get(sourceKey) ?? [];

    const maxJumpFrames = Math.round(2 * fps); // ~2 seconds forward jump threshold

    // Choose decoder with position <= frameIndex and jump <= maxJumpFrames
    const eligible = decoders.filter(d => !d.closed && d.position <= frameIndex && (frameIndex - d.position) <= maxJumpFrames);

    let decoder: FrameDecoder;
    const firstEligible = eligible.sort((a, b) => b.position - a.position)[0];
    if (firstEligible) {
      // Pick the closest decoder to frameIndex (maximum position)
      decoder = firstEligible;
    } else {
      // Need a new decoder seeking to target
      const startTime = sourceTimeFromIndex(frameIndex, fps);
      const isVp9Alpha = codec.includes('vp9') && hasAlpha;

      if (decoders.length >= 2) {
        // Pick least recently used decoder to replace
        decoders.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
        const toClose = decoders.shift()!;
        void toClose.close();
      }

      decoder = new FrameDecoder({
        ffmpeg: this.ffmpeg,
        src,
        fps,
        startTime,
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

      decoders.push(decoder);
      this.decoders.set(sourceKey, decoders);
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
