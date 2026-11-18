import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';


export type MediaInfo = {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly start: number;
  readonly codec: string;
  readonly pixFmt: string;
  readonly hasAlpha: boolean;
  readonly hasAudio: boolean;
};

type ProbeCacheEntry = {
  readonly mtimeMs: number;
  readonly info: MediaInfo;
};

const probeCache = new Map<string, ProbeCacheEntry>();

/**
 * Parses video metadata from the stderr output of `ffmpeg -hide_banner -i <file>`.
 */
export function parseFfmpegInfo(stderr: string): MediaInfo {
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durationMatch && durationMatch[1] && durationMatch[2] && durationMatch[3]
    ? parseInt(durationMatch[1], 10) * 3600 + parseInt(durationMatch[2], 10) * 60 + parseFloat(durationMatch[3])
    : 0;

  const startMatch = stderr.match(/start:\s*(-?\d+(?:\.\d+)?)/);
  const start = startMatch && startMatch[1] ? parseFloat(startMatch[1]) : 0;

  const hasAudio = /Stream\s+#\d+:\d+.*?: Audio:/.test(stderr);

  const videoMatch = stderr.match(/Stream\s+#\d+:\d+.*?: Video:\s*([^\n\r]+)/);
  if (!videoMatch || !videoMatch[1]) {
    throw new Error('freemotion: no video stream found in media.');
  }

  const videoLine = videoMatch[1];

  const codecMatch = videoLine.match(/^([a-zA-Z0-9_-]+)/);
  const codec = codecMatch && codecMatch[1] ? codecMatch[1].toLowerCase() : '';

  let width = 0;
  let height = 0;
  const dimMatch = videoLine.match(/,\s*(?:[a-z0-9_]+(?:\([^)]*\))?,\s*)?(\d{2,5})x(\d{2,5})/);
  if (dimMatch && dimMatch[1] && dimMatch[2]) {
    width = parseInt(dimMatch[1], 10);
    height = parseInt(dimMatch[2], 10);
  } else {
    const fallbackDim = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
    if (fallbackDim && fallbackDim[1] && fallbackDim[2]) {
      width = parseInt(fallbackDim[1], 10);
      height = parseInt(fallbackDim[2], 10);
    }
  }

  let pixFmt = '';
  const pixFmtMatch = videoLine.match(/,\s*([a-z0-9_]+)(?:\([^)]*\))?,\s*\d{2,5}x\d{2,5}/);
  if (pixFmtMatch && pixFmtMatch[1]) {
    pixFmt = pixFmtMatch[1].toLowerCase();
  } else {
    const generalPixFmt = videoLine.match(/\b(yuva?\d+p\w*|rgba|bgra|argb|abgr|yuv\d+p\w*)\b/);
    if (generalPixFmt && generalPixFmt[1]) {
      pixFmt = generalPixFmt[1].toLowerCase();
    }
  }

  const hasAlphaMode = /alpha_mode\s*:\s*1/i.test(stderr);
  const hasAlpha = pixFmt.includes('yuva')
    || pixFmt.includes('rgba')
    || pixFmt.includes('bgra')
    || pixFmt.includes('argb')
    || (codec.includes('vp9') && hasAlphaMode);

  let fps = 30;
  const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
  if (fpsMatch && fpsMatch[1]) {
    fps = parseFloat(fpsMatch[1]);
  } else {
    const tbrMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*tbr/);
    if (tbrMatch && tbrMatch[1]) {
      fps = parseFloat(tbrMatch[1]);
    }
  }

  return {
    width,
    height,
    fps,
    duration,
    start,
    codec,
    pixFmt,
    hasAlpha,
    hasAudio,
  };
}

/**
 * Probes media file metadata using `ffmpeg -i` with in-memory caching keyed by filePath and mtime.
 */
export async function probeMedia(filePath: string, ffmpeg = 'ffmpeg'): Promise<MediaInfo> {
  const fileStat = await stat(filePath);
  const cached = probeCache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.info;
  }

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', filePath]);
    const chunks: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error([
          `ffmpeg was not found ("${ffmpeg}"). freemotion needs it to decode videos. Either:`,
          '  add it to the project:  npm install ffmpeg-static  (with pnpm, also run: pnpm approve-builds)',
          '  or install it system-wide:',
          '    macOS:   brew install ffmpeg',
          '    Ubuntu:  sudo apt install ffmpeg',
          '    Windows: winget install ffmpeg',
          'or point to a binary with --ffmpeg <path> or the FREEMOTION_FFMPEG environment variable.',
        ].join('\n')));
      } else {
        reject(error);
      }
    });
    child.on('close', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
  });

  const info = parseFfmpegInfo(stderr);
  probeCache.set(filePath, { mtimeMs: fileStat.mtimeMs, info });
  return info;
}

/** Clear the probe cache (for testing). */
export function clearProbeCache(): void {
  probeCache.clear();
}
