import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { build, mergeConfig, preview, type InlineConfig } from 'vite';

import { RENDER_API_GLOBAL, type CompositionMeta } from '../shared/render-api.js';

import { AudioCollector, audioEncodeArgs, mixAudio, planAudio, probeAudioMedia, type AudioProbeInfo } from './audio/index.js';
import { launchBrowser } from './browser.js';
import { bundleCachePlugin, createStagingDir, isBundleCacheValid, publishBundle, resolveBundleCacheDir } from './bundle-cache.js';
import {
  assertFfmpeg,
  DEFAULT_CODEC,
  DEFAULT_AUDIO_CODEC,
  ffmpegArgs,
  formatFromPath,
  isVideoFormat,
  resolveFfmpeg,
  type AudioCodec,
  type Codec,
  type ContainerFormat,
  type ImageFormat,
  type OutputFormat,
  type PixelFormat,
  type ProResProfile,
  type VideoFormat,
} from './ffmpeg.js';
import { type GlBackend } from './gl.js';
import type { Logger } from './logger.js';
import { produceInOrder } from './ordered-frames.js';
import { RENDER_ENTRY } from './paths.js';
import { createReporter, type Reporter } from './progress.js';
import { resolveEntry } from './project.js';
import { resolvePublicDir, servePublicDirPlugin } from './public-dir.js';
import { startVideoFrameServer, type VideoFrameServer } from './video/server.js';
import { createViteConfig, renderHtmlPlugin } from './vite-config.js';


type RenderJob = {
  readonly id: string;
  readonly output: string;
  readonly format: OutputFormat;
};

export type RenderOptions = {
  readonly root: string;
  readonly entry?: string;
  readonly configFile?: string | false;
  /** Whether to reuse the cached build bundle if sources haven't changed. Default `true`. */
  readonly buildCache?: boolean;
  /** Composition ids to render, or every composition of the project. */
  readonly compositions: readonly string[] | 'all';
  /** File to write when rendering a single composition. Its extension picks the format. */
  readonly output?: string;
  /** Folder for `<id>.<format>` files when `output` is not given. */
  readonly outDir: string;
  /** Overrides the format implied by `output`. Default: `png` with `frame`, otherwise `mp4`. */
  readonly format?: OutputFormat;
  /** Still images: the frame to capture. */
  readonly frame?: number;
  /** Videos: first and last frame (inclusive) to render. */
  readonly frames?: readonly [number, number];
  /** Videos: keep one frame out of every n, and lower the frame rate to match. Default `1`. */
  readonly everyNthFrame?: number;
  /** GIF and SVG: start over at the end (default), or stop on the last frame. */
  readonly loop?: boolean;
  /** Merged over each composition's `defaultProps`. */
  readonly props?: Record<string, unknown>;
  readonly concurrency: number;
  readonly crf?: number;
  /** Device pixel ratio: 2 renders twice the width and height. */
  readonly scale: number;
  /** Memory limit for decoded video frames in MB. Default: 512. */
  readonly videoCacheMb?: number;
  /** Intermediate frame capture format: png or jpeg (default: png). */
  readonly imageFormat?: ImageFormat;
  /** JPEG quality 1-100 (default: 92). */
  readonly jpegQuality?: number;
  /** Video codec: h264, h265, vp9 or prores. */
  readonly codec?: Codec;
  /** Pixel format (default: yuv420p). */
  readonly pixelFormat?: PixelFormat;
  /** ProRes profile: proxy, lt, standard, hq, 4444 or 4444-xq (default: hq). */
  readonly proresProfile?: ProResProfile;
  /** Overwrite existing files (default: true). */
  readonly overwrite?: boolean;
  /** Recreate each tab after n frames to bound memory. Default: 1000; 0 disables. */
  readonly recycleTabs?: number;
  /** Maximum wait time for delayRender holds in ms. Default: 30000. */
  readonly timeout?: number;
  /** Mute all audio. */
  readonly muted?: boolean;
  /** Add silent audio stream when no audio assets are present. */
  readonly silentAudio?: boolean;
  /** Audio codec: aac or opus. */
  readonly audioCodec?: AudioCodec;
  /** WebGL backend for Chromium. */
  readonly gl?: GlBackend;
  /** If false, fail when the browser is not installed instead of downloading it. Default: true. */
  readonly download?: boolean;
  /** ffmpeg binary. Default: the project's `ffmpeg-static`, else `ffmpeg` on PATH. */
  readonly ffmpeg?: string;
  readonly browserExecutable?: string;
  readonly progress?: 'json';
  readonly log: Logger;
};

export type RenderResult = {
  readonly id: string;
  readonly output: string;
  readonly format: OutputFormat;
  readonly frames: number;
  readonly seconds: number;
};

type Session = {
  readonly browser: Browser;
  readonly baseUrl: string;
  readonly options: RenderOptions;
  readonly ffmpeg: string;
  readonly videoServerUrl: string;
  readonly reporter: Reporter;
  readonly publicDir: string;
};

async function moveFile(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
      await copyFile(source, destination);
      await unlink(source);
    } else {
      throw error;
    }
  }
}

function runFfmpeg(ffmpeg: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`freemotion: ffmpeg failed with code ${code}: ${stderr.trim()}`));
      } else {
        resolve();
      }
    });
  });
}

export function resolveAssetSrc(src: string, publicDir: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  if (isAbsolute(src)) {
    return src;
  }
  const cleanPath = src.replace(/^\/+/, '');
  return resolve(publicDir, cleanPath);
}

type Tab = {
  readonly page: Page;
  /** Uncaught errors of the page (e.g. thrown in an effect or a timer); any of them fails the render. */
  readonly errors: Error[];
  readonly cdp: CDPSession;
  readonly meta: CompositionMeta;
  readonly scale: number;
  readonly imageFormat: ImageFormat;
  readonly jpegQuality: number;
};

async function openTab(
  session: Session,
  id: string,
  { alpha = false, imageFormat = 'png', jpegQuality = 92 }: {
    readonly alpha?: boolean;
    readonly imageFormat?: ImageFormat;
    readonly jpegQuality?: number;
  } = {},
): Promise<Tab> {
  const { browser, baseUrl, options, videoServerUrl } = session;
  const page = await browser.newPage({ deviceScaleFactor: options.scale });
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto(baseUrl);
  await page.waitForFunction(name => name in window, RENDER_API_GLOBAL, { timeout: 60_000 }).catch((error: Error) => {
    throw errors[0] ?? error;
  });
  const meta = await page.evaluate(
    ([name, compositionId, props, mountOptions]) => window[name as typeof RENDER_API_GLOBAL]!.mount(compositionId, props, mountOptions),
    [
      RENDER_API_GLOBAL, id, options.props ?? null, {
        videoServerUrl,
        timeoutInMilliseconds: options.timeout,
      },
    ] as const,
  );
  await page.setViewportSize({ width: meta.width, height: meta.height });
  const cdp = await page.context().newCDPSession(page);
  if (alpha) {
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  }
  return { page, errors, cdp, meta, scale: options.scale, imageFormat, jpegQuality };
}

async function capture({ page, cdp, errors, meta, scale, imageFormat, jpegQuality }: Tab, frame: number): Promise<Buffer> {
  await page.evaluate(
    ([name, value]) => window[name as typeof RENDER_API_GLOBAL]!.setFrame(value),
    [RENDER_API_GLOBAL, frame] as const,
  );
  if (errors.length > 0) {
    throw errors[0];
  }
  // Straight from the DevTools protocol: `optimizeForSpeed` trades PNG compression (not quality) for
  // a capture several times faster than page.screenshot().
  const screenshotOptions = imageFormat === 'jpeg'
    ? {
      format: 'jpeg' as const,
      quality: jpegQuality,
      optimizeForSpeed: true,
      clip: { x: 0, y: 0, width: meta.width, height: meta.height, scale },
    }
    : {
      format: 'png' as const,
      optimizeForSpeed: true,
      clip: { x: 0, y: 0, width: meta.width, height: meta.height, scale },
    };
  const { data } = await cdp.send('Page.captureScreenshot', screenshotOptions);
  return Buffer.from(data, 'base64');
}

function checkFrame(meta: CompositionMeta, frame: number, flag: string) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= meta.durationInFrames) {
    throw new Error(`${flag} ${frame} is outside "${meta.id}" (frames 0–${meta.durationInFrames - 1}).`);
  }
}

async function renderStill(session: Session, job: RenderJob): Promise<RenderResult> {
  const startedAt = Date.now();
  if (session.options.imageFormat === 'jpeg') {
    session.options.log.info('Warning: still PNG output requires PNG capture; ignoring --image-format jpeg.');
  }
  const tab = await openTab(session, job.id, { imageFormat: 'png' });
  const { meta } = tab;
  const frame = session.options.frame ?? 0;
  checkFrame(meta, frame, '--frame');
  const png = await capture(tab, frame);
  session.reporter.event({ phase: 'render', id: job.id, done: 1, total: 1 });
  await writeFile(job.output, png);
  await tab.page.close();
  return { id: job.id, output: job.output, format: 'png', frames: 1, seconds: (Date.now() - startedAt) / 1000 };
}

/** The frames of a video or animated SVG, honoring `--frames` and `--every-nth-frame`, and their frame rate. */
function planFrames(meta: CompositionMeta, options: RenderOptions): { frames: number[]; fps: number } {
  const [from, to] = options.frames ?? [0, meta.durationInFrames - 1];
  checkFrame(meta, from, '--frames start');
  checkFrame(meta, to, '--frames end');
  if (to < from) {
    throw new Error(`--frames ${from}-${to} is empty.`);
  }
  const step = options.everyNthFrame ?? 1;
  return { frames: Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step), fps: meta.fps / step };
}

async function renderVideo(session: Session, job: RenderJob, format: VideoFormat): Promise<RenderResult> {
  const { options, reporter } = session;
  const startedAt = Date.now();

  const codec = options.codec ?? (format in DEFAULT_CODEC ? DEFAULT_CODEC[format as ContainerFormat] : undefined);
  const proresProfile = options.proresProfile ?? (codec === 'prores' ? 'hq' : undefined);
  const pixelFormat = options.pixelFormat ?? (
    codec === 'prores'
      ? (proresProfile === '4444' || proresProfile === '4444-xq' ? 'yuva444p10le' : 'yuv422p10le')
      : (codec ? 'yuv420p' : undefined)
  );

  const hasAlpha = pixelFormat === 'yuva420p' || pixelFormat === 'yuva444p10le';
  let imageFormat = options.imageFormat ?? 'png';
  if (hasAlpha && options.imageFormat === 'jpeg') {
    options.log.info('Warning: alpha output requires PNG capture; ignoring --image-format jpeg.');
    imageFormat = 'png';
  }
  const jpegQuality = options.jpegQuality ?? 92;

  const recycleAfter = options.recycleTabs ?? 1000;
  const tabOptions = { alpha: hasAlpha, imageFormat, jpegQuality };
  const first = await openTab(session, job.id, tabOptions);
  const { meta } = first;

  const { frames, fps } = planFrames(meta, options);
  const [width, height] = [meta.width * options.scale, meta.height * options.scale];
  if (format !== 'gif' && (width % 2 !== 0 || height % 2 !== 0)) {
    await first.page.close().catch(() => undefined);
    throw new Error(`"${meta.id}" renders at ${width}×${height}; ${format.toUpperCase()} needs an even width and height.`);
  }

  const extra = Math.max(0, Math.min(options.concurrency, frames.length) - 1);
  const tabs = [first, ...(await Promise.all(Array.from({ length: extra }, () => openTab(session, job.id, tabOptions))))];

  type TabSlot = {
    tab: Tab;
    capturedCount: number;
  };
  const slots: TabSlot[] = tabs.map(tab => ({ tab, capturedCount: 0 }));

  let jobTempDir: string | null = null;
  if (format !== 'gif') {
    jobTempDir = await mkdtemp(join(tmpdir(), `freemotion-${job.id}-`));
  }
  const videoOutput = jobTempDir ? join(jobTempDir, `video.${format}`) : job.output;

  const ffmpeg = spawn(session.ffmpeg, ffmpegArgs({
    format,
    fps,
    codec,
    pixelFormat,
    proresProfile,
    imageFormat,
    crf: options.crf,
    loop: options.loop,
    overwrite: format === 'gif' ? options.overwrite : true,
    output: videoOutput,
  }), {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const exited = once(ffmpeg, 'close');
  let written = 0;
  let rendered = 0;
  const collector = new AudioCollector();

  try {
    try {
      await produceInOrder({
        frames,
        workers: slots,
        ahead: slots.length * 4,
        produce: async (slot, frame) => {
          if (recycleAfter > 0 && slot.capturedCount >= recycleAfter) {
            if (slot.tab.errors.length > 0) {
              throw slot.tab.errors[0];
            }
            if (format !== 'gif') {
              await collector.collect(slot.tab.page);
            }
            if (slot.tab.errors.length > 0) {
              throw slot.tab.errors[0];
            }
            await slot.tab.page.close().catch(() => undefined);
            slot.tab = await openTab(session, job.id, tabOptions);
            slot.capturedCount = 0;
          }

          const png = await capture(slot.tab, frame);
          slot.capturedCount++;
          rendered++;
          reporter.event({ phase: 'render', id: job.id, done: rendered, total: frames.length });
          return png;
        },
        consume: async (png) => {
          written++;
          reporter.event({ phase: 'encode', id: job.id, done: written, total: frames.length });
          if (!ffmpeg.stdin.write(png)) {
            await once(ffmpeg.stdin, 'drain');
          }
        },
      });
    } finally {
      ffmpeg.stdin.end();
    }
    const [code] = await exited;

    if (format !== 'gif') {
      for (const slot of slots) {
        if (slot.tab.errors.length > 0) {
          throw slot.tab.errors[0];
        }
        await collector.collect(slot.tab.page);
        if (slot.tab.errors.length > 0) {
          throw slot.tab.errors[0];
        }
      }
    }
    await Promise.all(slots.map(slot => slot.tab.page.close().catch(() => undefined)));

    if (code !== 0) {
      throw new Error(`ffmpeg exited with code ${code} while encoding "${job.id}".`);
    }

    if (format === 'gif') {
      return { id: job.id, output: job.output, format, frames: frames.length, seconds: (Date.now() - startedAt) / 1000 };
    }

    const isMuted = Boolean(options.muted);
    const rawAssets = collector.getAssets();
    const resolvedAssets = rawAssets.map(asset => ({
      ...asset,
      src: resolveAssetSrc(asset.src, session.publicDir),
    }));

    const probeCache = new Map<string, AudioProbeInfo | undefined>();
    const probe = async (src: string) => {
      let info = probeCache.get(src);
      if (info === undefined && !probeCache.has(src)) {
        info = await probeAudioMedia(src, session.ffmpeg);
        probeCache.set(src, info);
      }
      return info;
    };

    let hasAudio = false;
    if (!isMuted) {
      for (const asset of resolvedAssets) {
        if (asset.volumes.length === 0) continue;
        const info = await probe(asset.src);
        if (info?.hasAudio) {
          hasAudio = true;
          break;
        }
      }
    }

    const targetAudioCodec = options.audioCodec ?? DEFAULT_AUDIO_CODEC[format as ContainerFormat];
    const audioArgs = audioEncodeArgs({ codec: targetAudioCodec });
    const movFlags = format === 'mp4' ? ['-movflags', '+faststart'] : [];

    await mkdir(dirname(job.output), { recursive: true });

    if (isMuted || !hasAudio) {
      if (options.silentAudio) {
        reporter.event({ phase: 'mux', id: job.id });
        await runFfmpeg(session.ffmpeg, [
          '-i', videoOutput,
          '-f', 'lavfi',
          '-i', 'anullsrc=r=48000:cl=stereo',
          '-c:v', 'copy',
          ...audioArgs,
          '-shortest',
          ...movFlags,
          job.output,
        ]);
      } else {
        await moveFile(videoOutput, job.output);
      }
    } else {
      const step = options.everyNthFrame ?? 1;
      const range = { from: frames[0]!, to: frames[0]! + frames.length * step };
      const plan = await planAudio({
        assets: resolvedAssets,
        fps: meta.fps,
        range,
        step,
        probe,
        tempDir: jobTempDir!,
      });

      for (const warning of plan.warnings) {
        options.log.info(warning);
      }

      reporter.event({ phase: 'audio', id: job.id });
      const mixedAudioPath = await mixAudio(plan, { ffmpeg: session.ffmpeg });

      reporter.event({ phase: 'mux', id: job.id });
      await runFfmpeg(session.ffmpeg, [
        '-i', videoOutput,
        '-f', 'wav',
        '-i', mixedAudioPath,
        '-c:v', 'copy',
        ...audioArgs,
        ...movFlags,
        job.output,
      ]);
    }

    return { id: job.id, output: job.output, format, frames: frames.length, seconds: (Date.now() - startedAt) / 1000 };
  } finally {
    await Promise.all(slots.map(slot => slot.tab.page.close().catch(() => undefined)));
    if (jobTempDir) {
      await rm(jobTempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Animated SVG: one tab draws the frames in order and, after each one, records the stage's DOM. At
 * the end the page turns what changed between frames into CSS keyframes (see svg-recorder.ts).
 * With `--frame` the file is a still of that frame.
 */
async function renderSvg(session: Session, job: RenderJob): Promise<RenderResult> {
  const { options, reporter } = session;
  const startedAt = Date.now();
  const tab = await openTab(session, job.id);
  const { page, errors, meta } = tab;
  let frames: number[];
  let fps = meta.fps;
  if (options.frame === undefined) {
    ({ frames, fps } = planFrames(meta, options));
  } else {
    checkFrame(meta, options.frame, '--frame');
    frames = [options.frame];
  }

  let recorded = 0;
  await page.evaluate(name => window[name as typeof RENDER_API_GLOBAL]!.beginSvg(), RENDER_API_GLOBAL);
  for (const frame of frames) {
    await page.evaluate(
      ([name, value]) => window[name as typeof RENDER_API_GLOBAL]!.setFrame(value),
      [RENDER_API_GLOBAL, frame] as const,
    );
    if (errors.length > 0) {
      throw errors[0];
    }
    await page.evaluate(name => window[name as typeof RENDER_API_GLOBAL]!.recordSvgFrame(), RENDER_API_GLOBAL);
    recorded++;
    reporter.event({ phase: 'render', id: job.id, done: recorded, total: frames.length });
  }
  const { svg, warnings } = await page.evaluate(
    ([name, svgOptions]) => window[name as typeof RENDER_API_GLOBAL]!.finishSvg(svgOptions),
    [RENDER_API_GLOBAL, { fps, loop: options.loop ?? true }] as const,
  );
  if (errors.length > 0) {
    throw errors[0];
  }
  warnings.forEach(warning => options.log.info(`  ${job.id}: ${warning}`));
  await writeFile(job.output, svg);
  await page.close();
  return { id: job.id, output: job.output, format: 'svg', frames: frames.length, seconds: (Date.now() - startedAt) / 1000 };
}

/** Decides the output file and format of each composition to render. */
export function planJobs(options: Pick<RenderOptions, 'compositions' | 'output' | 'outDir' | 'format' | 'frame'>, available: readonly string[]): RenderJob[] {
  const ids = options.compositions === 'all' ? available : options.compositions;
  const missing = ids.filter(id => !available.includes(id));
  if (missing.length > 0) {
    throw new Error(`Unknown composition${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Available: ${available.join(', ') || '(none)'}.`);
  }
  if (ids.length === 0) {
    throw new Error('Nothing to render: the project exports no compositions.');
  }
  if (options.output && ids.length > 1) {
    throw new Error('--output works with a single composition. Use --out-dir to render several.');
  }
  return ids.map((id) => {
    const fallback = options.format ?? (options.frame === undefined ? 'mp4' : 'png');
    const output = options.output ?? join(options.outDir, `${id}.${fallback}`);
    const format = options.format ?? formatFromPath(output);
    if (!format) {
      throw new Error(`Can't tell the format of "${output}". Use a .mp4, .webm, .mov, .gif, .png or .svg file, or pass --format.`);
    }
    return { id, output, format };
  });
}

/** Builds the project once, then renders each composition with headless Chromium and ffmpeg. */
export async function render(options: RenderOptions): Promise<RenderResult[]> {
  const { root, log } = options;
  if (options.overwrite === false && options.output && existsSync(resolve(root, options.output))) {
    throw new Error(`Output file "${options.output}" already exists. Pass --overwrite to replace it.`);
  }
  const reporter = createReporter({ mode: options.progress, log });
  const entry = resolveEntry(root, options.entry);
  const base = await createViteConfig({ root, entry, command: 'build', configFile: options.configFile });
  const useCache = options.buildCache !== false;
  const cacheDir = resolveBundleCacheDir(root, entry);
  let outDir = cacheDir;
  let isCached = false;

  if (useCache) {
    isCached = await isBundleCacheValid(cacheDir, {
      root,
      entry,
      configFile: options.configFile,
      configDependencies: base.configDependencies,
    });
  }

  if (isCached) {
    log.info('Using cached bundle');
  } else {
    log.info('Bundling compositions…');
    reporter.event({ phase: 'bundle', status: 'start' });
    if (useCache) {
      const stagingDir = await createStagingDir(cacheDir);
      try {
        await build(mergeConfig(base, {
          base: '/',
          logLevel: 'warn',
          plugins: [
            renderHtmlPlugin(),
            bundleCachePlugin({
              root,
              entry,
              configFile: options.configFile,
              configDependencies: base.configDependencies,
            }),
          ],
          build: {
            outDir: stagingDir,
            emptyOutDir: true,
            copyPublicDir: false,
            reportCompressedSize: false,
            rollupOptions: { input: RENDER_ENTRY },
          },
        } satisfies InlineConfig));
        await publishBundle(stagingDir, cacheDir);
        outDir = cacheDir;
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    } else {
      outDir = await mkdtemp(join(tmpdir(), 'freemotion-'));
      await build(mergeConfig(base, {
        base: '/',
        logLevel: 'warn',
        plugins: [renderHtmlPlugin()],
        build: {
          outDir,
          emptyOutDir: true,
          copyPublicDir: false,
          reportCompressedSize: false,
          rollupOptions: { input: RENDER_ENTRY },
        },
      } satisfies InlineConfig));
    }
    reporter.event({ phase: 'bundle', status: 'done' });
  }

  const publicDir = resolvePublicDir(root, base.publicDir);
  const server = await preview({
    root,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { port: 0, host: '127.0.0.1', open: false },
    plugins: publicDir ? [servePublicDirPlugin(publicDir)] : [],
  });
  const { port } = server.httpServer.address() as AddressInfo;
  let browser: Browser | null = null;
  let videoServer: VideoFrameServer | null = null;

  try {
    const ffmpeg = resolveFfmpeg(root, options.ffmpeg);
    const resolvedPublicDir = publicDir || resolve(root, 'public');
    const cacheBytes = (options.videoCacheMb ?? 512) * 1024 * 1024;
    videoServer = await startVideoFrameServer({ ffmpeg, publicDir: resolvedPublicDir, cacheBytes });

    browser = await launchBrowser({
      executablePath: options.browserExecutable,
      gl: options.gl,
      download: options.download,
      log: log.info,
    });
    const session: Session = {
      browser,
      baseUrl: `http://127.0.0.1:${port}/`,
      options,
      ffmpeg,
      videoServerUrl: videoServer.url,
      reporter,
      publicDir: resolvedPublicDir,
    };
    const probe = await browser.newPage();
    await probe.goto(session.baseUrl);
    await probe.waitForFunction(name => name in window, RENDER_API_GLOBAL, { timeout: 60_000 });
    const available = await probe.evaluate(name => window[name as typeof RENDER_API_GLOBAL]!.compositions.map(item => item.id), RENDER_API_GLOBAL);
    await probe.close();

    const jobs = planJobs(options, available);
    if (options.overwrite === false) {
      for (const job of jobs) {
        if (existsSync(resolve(root, job.output))) {
          throw new Error(`Output file "${job.output}" already exists. Pass --overwrite to replace it.`);
        }
      }
    }
    if (jobs.some(job => isVideoFormat(job.format))) {
      await assertFfmpeg(session.ffmpeg);
    }
    const results: RenderResult[] = [];
    for (const job of jobs) {
      const output = resolve(root, job.output);
      await mkdir(dirname(output), { recursive: true });
      const result = job.format === 'png'
        ? await renderStill(session, { ...job, output })
        : job.format === 'svg'
          ? await renderSvg(session, { ...job, output })
          : await renderVideo(session, { ...job, output }, job.format);
      reporter.event({ phase: 'done', id: result.id, output: job.output, frames: result.frames, seconds: result.seconds });
      log.done(`${result.id} · ${result.frames} ${result.frames === 1 ? 'frame' : 'frames'} in ${result.seconds.toFixed(1)}s → ${job.output}`);
      results.push(result);
    }
    return results;
  } finally {
    await browser?.close();
    await server.close();
    await videoServer?.close();
    if (!useCache) {
      await rm(outDir, { recursive: true, force: true });
    }
  }
}
