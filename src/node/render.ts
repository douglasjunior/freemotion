import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { build, mergeConfig, preview, type InlineConfig } from 'vite';

import { RENDER_API_GLOBAL, type CompositionMeta } from '../shared/render-api.js';

import { launchBrowser } from './browser.js';
import { assertFfmpeg, ffmpegArgs, formatFromPath, resolveFfmpeg, type OutputFormat, type VideoFormat } from './ffmpeg.js';
import type { Logger } from './logger.js';
import { produceInOrder } from './ordered-frames.js';
import { RENDER_ENTRY } from './paths.js';
import { resolveEntry } from './project.js';
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
  /** Merged over each composition's `defaultProps`. */
  readonly props?: Record<string, unknown>;
  readonly concurrency: number;
  readonly crf?: number;
  /** Device pixel ratio: 2 renders twice the width and height. */
  readonly scale: number;
  /** ffmpeg binary. Default: the project's `ffmpeg-static`, else `ffmpeg` on PATH. */
  readonly ffmpeg?: string;
  readonly browserExecutable?: string;
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
};

type Tab = {
  readonly page: Page;
  /** Uncaught errors of the page (e.g. thrown in an effect or a timer); any of them fails the render. */
  readonly errors: Error[];
  readonly cdp: CDPSession;
  readonly meta: CompositionMeta;
  readonly scale: number;
};

async function openTab({ browser, baseUrl, options }: Session, id: string): Promise<Tab> {
  const page = await browser.newPage({ deviceScaleFactor: options.scale });
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto(baseUrl);
  await page.waitForFunction(name => name in window, RENDER_API_GLOBAL, { timeout: 60_000 }).catch((error: Error) => {
    throw errors[0] ?? error;
  });
  const meta = await page.evaluate(
    ([name, compositionId, props]) => window[name as typeof RENDER_API_GLOBAL]!.mount(compositionId, props),
    [RENDER_API_GLOBAL, id, options.props ?? null] as const,
  );
  await page.setViewportSize({ width: meta.width, height: meta.height });
  return { page, errors, cdp: await page.context().newCDPSession(page), meta, scale: options.scale };
}

async function capture({ page, cdp, errors, meta, scale }: Tab, frame: number): Promise<Buffer> {
  await page.evaluate(
    ([name, value]) => window[name as typeof RENDER_API_GLOBAL]!.setFrame(value),
    [RENDER_API_GLOBAL, frame] as const,
  );
  if (errors.length > 0) {
    throw errors[0];
  }
  // Straight from the DevTools protocol: `optimizeForSpeed` trades PNG compression (not quality) for
  // a capture several times faster than page.screenshot().
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: meta.width, height: meta.height, scale },
  });
  return Buffer.from(data, 'base64');
}

function checkFrame(meta: CompositionMeta, frame: number, flag: string) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= meta.durationInFrames) {
    throw new Error(`${flag} ${frame} is outside "${meta.id}" (frames 0–${meta.durationInFrames - 1}).`);
  }
}

async function renderStill(session: Session, job: RenderJob): Promise<RenderResult> {
  const startedAt = Date.now();
  const tab = await openTab(session, job.id);
  const { meta } = tab;
  const frame = session.options.frame ?? 0;
  checkFrame(meta, frame, '--frame');
  await writeFile(job.output, await capture(tab, frame));
  await tab.page.close();
  return { id: job.id, output: job.output, format: 'png', frames: 1, seconds: (Date.now() - startedAt) / 1000 };
}

async function renderVideo(session: Session, job: RenderJob, format: VideoFormat): Promise<RenderResult> {
  const { options } = session;
  const startedAt = Date.now();
  const first = await openTab(session, job.id);
  const { meta } = first;

  const [from, to] = options.frames ?? [0, meta.durationInFrames - 1];
  checkFrame(meta, from, '--frames start');
  checkFrame(meta, to, '--frames end');
  if (to < from) {
    throw new Error(`--frames ${from}-${to} is empty.`);
  }
  const step = options.everyNthFrame ?? 1;
  const frames = Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
  const [width, height] = [meta.width * options.scale, meta.height * options.scale];
  if (format !== 'gif' && (width % 2 !== 0 || height % 2 !== 0)) {
    throw new Error(`"${meta.id}" renders at ${width}×${height}; ${format.toUpperCase()} needs an even width and height.`);
  }

  const extra = Math.max(0, Math.min(options.concurrency, frames.length) - 1);
  const tabs = [first, ...(await Promise.all(Array.from({ length: extra }, () => openTab(session, job.id))))];

  const ffmpeg = spawn(session.ffmpeg, ffmpegArgs({ format, fps: meta.fps / step, crf: options.crf, output: job.output }), {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const exited = once(ffmpeg, 'close');
  let written = 0;
  const progress = setInterval(() => options.log.progress(`${job.id} · ${written}/${frames.length} frames`), 250);

  try {
    await produceInOrder({
      frames,
      workers: tabs,
      ahead: tabs.length * 4,
      produce: capture,
      consume: async (png) => {
        written++;
        if (!ffmpeg.stdin.write(png)) {
          await once(ffmpeg.stdin, 'drain');
        }
      },
    });
  } finally {
    clearInterval(progress);
    ffmpeg.stdin.end();
  }
  const [code] = await exited;
  await Promise.all(tabs.map(tab => tab.page.close()));
  if (code !== 0) {
    throw new Error(`ffmpeg exited with code ${code} while encoding "${job.id}".`);
  }
  return { id: job.id, output: job.output, format, frames: frames.length, seconds: (Date.now() - startedAt) / 1000 };
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
      throw new Error(`Can't tell the format of "${output}". Use a .mp4, .webm, .gif or .png file, or pass --format.`);
    }
    return { id, output, format };
  });
}

/** Builds the project once, then renders each composition with headless Chromium and ffmpeg. */
export async function render(options: RenderOptions): Promise<RenderResult[]> {
  const { root, log } = options;
  const entry = resolveEntry(root, options.entry);
  const outDir = await mkdtemp(join(tmpdir(), 'freemotion-'));
  const base = await createViteConfig({ root, entry, command: 'build', configFile: options.configFile });
  log.info('Bundling compositions…');
  await build(mergeConfig(base, {
    base: '/',
    logLevel: 'warn',
    plugins: [renderHtmlPlugin()],
    build: {
      outDir,
      emptyOutDir: true,
      copyPublicDir: true,
      reportCompressedSize: false,
      rollupOptions: { input: RENDER_ENTRY },
    },
  } satisfies InlineConfig));

  const server = await preview({
    root,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { port: 0, host: '127.0.0.1', open: false },
  });
  const { port } = server.httpServer.address() as AddressInfo;
  let browser: Browser | null = null;

  try {
    browser = await launchBrowser({ executablePath: options.browserExecutable, log: log.info });
    const session: Session = { browser, baseUrl: `http://127.0.0.1:${port}/`, options, ffmpeg: resolveFfmpeg(root, options.ffmpeg) };
    const probe = await browser.newPage();
    await probe.goto(session.baseUrl);
    await probe.waitForFunction(name => name in window, RENDER_API_GLOBAL, { timeout: 60_000 });
    const available = await probe.evaluate(name => window[name as typeof RENDER_API_GLOBAL]!.compositions.map(item => item.id), RENDER_API_GLOBAL);
    await probe.close();

    const jobs = planJobs(options, available);
    if (jobs.some(job => job.format !== 'png')) {
      await assertFfmpeg(session.ffmpeg);
    }
    const results: RenderResult[] = [];
    for (const job of jobs) {
      const output = resolve(root, job.output);
      await mkdir(dirname(output), { recursive: true });
      const result = job.format === 'png'
        ? await renderStill(session, { ...job, output })
        : await renderVideo(session, { ...job, output }, job.format);
      log.done(`${result.id} · ${result.frames} ${result.frames === 1 ? 'frame' : 'frames'} in ${result.seconds.toFixed(1)}s → ${job.output}`);
      results.push(result);
    }
    return results;
  } finally {
    await browser?.close();
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  }
}
