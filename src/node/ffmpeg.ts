import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';


export type VideoFormat = 'mp4' | 'webm' | 'mov' | 'gif';
/** `png` is a still, `svg` an animated vector file; neither needs ffmpeg. */
export type OutputFormat = VideoFormat | 'png' | 'svg';

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['mp4', 'webm', 'mov', 'gif', 'png', 'svg'];

export type Codec = 'h264' | 'h265' | 'vp9' | 'prores';
export const CODECS: readonly Codec[] = ['h264', 'h265', 'vp9', 'prores'];

export type ContainerFormat = 'mp4' | 'webm' | 'mov';

export type ImageFormat = 'png' | 'jpeg';
export const IMAGE_FORMATS: readonly ImageFormat[] = ['png', 'jpeg'];

export type PixelFormat = 'yuv420p' | 'yuv422p' | 'yuv444p' | 'yuv420p10le' | 'yuva420p' | 'yuv422p10le' | 'yuva444p10le';
export const PIXEL_FORMATS: readonly PixelFormat[] = [
  'yuv420p',
  'yuv422p',
  'yuv444p',
  'yuv420p10le',
  'yuva420p',
  'yuv422p10le',
  'yuva444p10le',
];

export type ProResProfile = 'proxy' | 'lt' | 'standard' | 'hq' | '4444' | '4444-xq';
export const PRORES_PROFILES: readonly ProResProfile[] = ['proxy', 'lt', 'standard', 'hq', '4444', '4444-xq'];

export const FORMAT_CODECS: Record<ContainerFormat, readonly Codec[]> = {
  mp4: ['h264', 'h265'],
  webm: ['vp9'],
  mov: ['prores', 'h264'],
};

export const DEFAULT_CODEC: Record<ContainerFormat, Codec> = {
  mp4: 'h264',
  webm: 'vp9',
  mov: 'prores',
};

export const CODEC_PIXEL_FORMATS: Record<Codec, readonly PixelFormat[]> = {
  h264: ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le'],
  h265: ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le'],
  vp9: ['yuv420p', 'yuva420p'],
  prores: ['yuv422p10le', 'yuva444p10le'],
};

export const PRORES_PROFILE_NUMBERS: Record<ProResProfile, string> = {
  proxy: '0',
  lt: '1',
  standard: '2',
  hq: '3',
  4444: '4',
  '4444-xq': '5',
};

/** Formats encoded by ffmpeg from PNG or JPEG frames. */
export const isVideoFormat = (format: OutputFormat): format is VideoFormat => format !== 'png' && format !== 'svg';

export const DEFAULT_CRF: Record<Exclude<Codec, 'prores'>, number> = {
  h264: 18,
  h265: 20,
  vp9: 32,
};

export function formatFromPath(path: string): OutputFormat | null {
  const extension = extname(path).slice(1).toLowerCase();
  return (OUTPUT_FORMATS as readonly string[]).includes(extension) ? (extension as OutputFormat) : null;
}

export type FfmpegArgsOptions = {
  readonly format: VideoFormat;
  readonly fps: number;
  readonly codec?: Codec;
  readonly pixelFormat?: PixelFormat;
  readonly proresProfile?: ProResProfile;
  readonly imageFormat?: ImageFormat;
  readonly crf?: number;
  /** GIF: play again from the start (default), or stop on the last frame. */
  readonly loop?: boolean;
  /** Overwrite existing output file (default: true). */
  readonly overwrite?: boolean;
  readonly output: string;
};

/** ffmpeg arguments that read frames from stdin and encode them to `output`. */
export function ffmpegArgs({
  format,
  fps,
  codec,
  pixelFormat,
  proresProfile,
  imageFormat = 'png',
  crf,
  loop = true,
  overwrite = true,
  output,
}: FfmpegArgsOptions): string[] {
  const overwriteFlag = overwrite ? '-y' : '-n';
  const inputCodec = imageFormat === 'jpeg' ? 'mjpeg' : 'png';
  const input = ['-hide_banner', '-loglevel', 'error', overwriteFlag, '-f', 'image2pipe', '-framerate', String(fps), '-c:v', inputCodec, '-i', '-'];

  if (format === 'gif') {
    return [
      ...input,
      '-filter_complex', 'split[a][b];[a]palettegen=stats_mode=full[palette];[b][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
      '-loop', loop ? '0' : '-1',
      output,
    ];
  }

  const resolvedCodec = codec ?? (format in DEFAULT_CODEC ? DEFAULT_CODEC[format as ContainerFormat] : 'h264');
  const resolvedProResProfile = proresProfile ?? 'hq';
  const resolvedPixelFormat = pixelFormat ?? (
    resolvedCodec === 'prores'
      ? (resolvedProResProfile === '4444' || resolvedProResProfile === '4444-xq' ? 'yuva444p10le' : 'yuv422p10le')
      : 'yuv420p'
  );

  const scale = imageFormat === 'jpeg'
    ? 'scale=in_range=pc:in_color_matrix=bt601:out_color_matrix=bt709:out_range=tv'
    : 'scale=out_color_matrix=bt709:out_range=tv';
  const vf = `${scale},format=${resolvedPixelFormat},setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709`;

  switch (resolvedCodec) {
    case 'h264':
      return [
        ...input,
        '-vf', vf,
        '-c:v', 'libx264', '-crf', String(crf ?? DEFAULT_CRF.h264),
        '-video_track_timescale', '90000', '-movflags', '+faststart',
        output,
      ];
    case 'h265':
      return [
        ...input,
        '-vf', vf,
        '-c:v', 'libx265', '-tag:v', 'hvc1', '-crf', String(crf ?? DEFAULT_CRF.h265),
        '-video_track_timescale', '90000', '-movflags', '+faststart',
        output,
      ];
    case 'vp9': {
      const vp9Extra = resolvedPixelFormat === 'yuva420p' ? ['-auto-alt-ref', '0'] : [];
      return [
        ...input,
        '-vf', vf,
        '-c:v', 'libvpx-vp9', '-crf', String(crf ?? DEFAULT_CRF.vp9), '-b:v', '0', '-row-mt', '1',
        ...vp9Extra,
        output,
      ];
    }
    case 'prores':
      return [
        ...input,
        '-vf', vf,
        '-c:v', 'prores_ks', '-profile:v', PRORES_PROFILE_NUMBERS[resolvedProResProfile],
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
