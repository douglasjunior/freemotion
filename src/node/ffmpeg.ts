import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';


export type VideoFormat = 'mp4' | 'webm' | 'gif';
/** `png` is a still, `svg` an animated vector file; neither needs ffmpeg. */
export type OutputFormat = VideoFormat | 'png' | 'svg';

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['mp4', 'webm', 'gif', 'png', 'svg'];

/** Formats encoded by ffmpeg from PNG frames. */
export const isVideoFormat = (format: OutputFormat): format is VideoFormat => format !== 'png' && format !== 'svg';

export const DEFAULT_CRF: Record<Exclude<VideoFormat, 'gif'>, number> = { mp4: 18, webm: 32 };

export function formatFromPath(path: string): OutputFormat | null {
  const extension = extname(path).slice(1).toLowerCase();
  return (OUTPUT_FORMATS as readonly string[]).includes(extension) ? (extension as OutputFormat) : null;
}

// RGB → YUV with the BT.709 matrix in limited range, tagged as BT.709 with the sRGB transfer curve,
// so players show the same colors the browser drew.
const YUV_FILTERS = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709';

/** ffmpeg arguments that read PNG frames from stdin and encode them to `output`. */
export function ffmpegArgs({ format, fps, crf, loop = true, output }: {
  readonly format: VideoFormat;
  readonly fps: number;
  readonly crf?: number;
  /** GIF: play again from the start (default), or stop on the last frame. */
  readonly loop?: boolean;
  readonly output: string;
}): string[] {
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
  switch (format) {
    case 'mp4':
      return [
        ...input,
        '-vf', YUV_FILTERS,
        '-c:v', 'libx264', '-crf', String(crf ?? DEFAULT_CRF.mp4),
        '-video_track_timescale', '90000', '-movflags', '+faststart',
        output,
      ];
    case 'webm':
      return [
        ...input,
        '-vf', YUV_FILTERS,
        '-c:v', 'libvpx-vp9', '-crf', String(crf ?? DEFAULT_CRF.webm), '-b:v', '0', '-row-mt', '1',
        output,
      ];
    case 'gif':
      return [
        ...input,
        '-filter_complex', 'split[a][b];[a]palettegen=stats_mode=full[palette];[b][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
        '-loop', loop ? '0' : '-1',
        output,
      ];
  }
}

/**
 * The ffmpeg binary to use: an explicit path, else the `ffmpeg-static` package installed in the
 * project (projects created by `freemotion init` have it), else `ffmpeg` on PATH. freemotion never
 * ships ffmpeg itself.
 */
export function resolveFfmpeg(root: string, explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  try {
    const path = createRequire(join(root, 'package.json'))('ffmpeg-static') as string | null;
    if (path && existsSync(path)) {
      return path;
    }
  } catch {
    // Not installed in this project.
  }
  return 'ffmpeg';
}

/** Fails with install instructions when ffmpeg can't be started. */
export async function assertFfmpeg(binary: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['-version'], { stdio: 'ignore' });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT'
        ? new Error([
          `ffmpeg was not found ("${binary}"). freemotion needs it to encode videos. Either:`,
          '  add it to the project:  npm install ffmpeg-static  (with pnpm, also run: pnpm approve-builds)',
          '  or install it system-wide:',
          '    macOS:   brew install ffmpeg',
          '    Ubuntu:  sudo apt install ffmpeg',
          '    Windows: winget install ffmpeg',
          'or point to a binary with --ffmpeg <path> or the FREEMOTION_FFMPEG environment variable.',
        ].join('\n'))
        : error);
    });
    child.on('close', () => resolve());
  });
}
