import { spawn } from 'node:child_process';

import type { Codec, HardwareAcceleration, HardwarePlan, PixelFormat } from './ffmpeg.js';


/**
 * Constant quality for NVENC when no bitrate is given. Measured against `libx264 -crf 18` on a 1080p
 * clip: 16.2 MB against 16.9 MB, SSIM 0.9916 against 0.9927. The other encoders have no such
 * calibration here, so they ask for `--video-bitrate` instead of guessing.
 */
export const NVENC_DEFAULT_CQ = 19;

type Backend = {
  readonly id: string;
  /** Shown in the log, e.g. "NVIDIA NVENC". */
  readonly label: string;
  readonly platforms: readonly NodeJS.Platform[];
  readonly encoders: Partial<Record<Codec, string>>;
  readonly inputArgs: (env: NodeJS.ProcessEnv) => readonly string[];
  readonly filter?: string;
  /** The encoder's quality options, or null when it can only be sized with `--video-bitrate`. */
  readonly rateArgs: (videoBitrate: string | undefined) => readonly string[] | null;
};

const bitrateOnly = (videoBitrate: string | undefined) => (videoBitrate ? ['-b:v', videoBitrate] : null);

/** GPU backends in order of preference. Only those for the current platform are tried. */
export const BACKENDS: readonly Backend[] = [
  {
    id: 'nvenc',
    label: 'NVIDIA NVENC',
    platforms: ['linux', 'win32'],
    encoders: { h264: 'h264_nvenc', h265: 'hevc_nvenc' },
    inputArgs: () => [],
    rateArgs: videoBitrate => (videoBitrate ? ['-b:v', videoBitrate] : ['-rc', 'vbr', '-cq', String(NVENC_DEFAULT_CQ), '-b:v', '0']),
  },
  {
    id: 'amf',
    label: 'AMD AMF',
    platforms: ['win32'],
    encoders: { h264: 'h264_amf', h265: 'hevc_amf' },
    inputArgs: () => [],
    rateArgs: bitrateOnly,
  },
  {
    id: 'vaapi',
    label: 'VA-API (AMD, Intel)',
    platforms: ['linux'],
    encoders: { h264: 'h264_vaapi', h265: 'hevc_vaapi' },
    inputArgs: env => ['-vaapi_device', env.FREEMOTION_VAAPI_DEVICE ?? '/dev/dri/renderD128'],
    filter: 'format=nv12,hwupload',
    rateArgs: bitrateOnly,
  },
  {
    id: 'videotoolbox',
    label: 'Apple VideoToolbox',
    platforms: ['darwin'],
    encoders: { h264: 'h264_videotoolbox', h265: 'hevc_videotoolbox' },
    inputArgs: () => [],
    rateArgs: bitrateOnly,
  },
];

export type EncoderChoice = {
  /** The GPU encoder to use, or null to encode in software. */
  readonly plan: HardwarePlan | null;
  /** Name of the GPU backend, when one is used. */
  readonly label?: string;
  /** Why software is used, when hardware acceleration was asked for. */
  readonly reason?: string;
};

export const SOFTWARE: EncoderChoice = { plan: null };

export type FrameSize = { readonly width: number; readonly height: number };

type Spawn = typeof spawn;
const probed = new Map<string, Promise<string | null>>();

/** The first line ffmpeg printed, which names the cause (the lines after it are its consequences), without the `[encoder @ 0x...]` prefix. */
const firstError = (stderr: string) => stderr.trim().split('\n')[0]?.replace(/^\[[^\]]*\]\s*/, '').trim() || 'ffmpeg failed to start the encoder';

/**
 * Tries the encoder on one black frame with the options and the frame size the render will use, and
 * returns null when it works, or the reason ffmpeg gave when it doesn't. Being listed in
 * `ffmpeg -encoders` is not enough: without the GPU, the driver or the device the encoder still fails
 * to start, and GPU encoders refuse frames below a minimum size. The answer is remembered for the process.
 */
export function probeEncoder(ffmpeg: string, plan: HardwarePlan, { width, height }: FrameSize, spawnFn: Spawn = spawn): Promise<string | null> {
  const key = [ffmpeg, plan.encoder, ...plan.inputArgs, plan.filter, ...plan.rateArgs, width, height].join('\0');
  let result = probed.get(key);
  if (!result) {
    result = new Promise<string | null>((resolve) => {
      const child = spawnFn(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        ...plan.inputArgs,
        '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=1:d=1`,
        ...(plan.filter ? ['-vf', plan.filter] : []),
        '-frames:v', '1', '-c:v', plan.encoder, ...plan.rateArgs, '-f', 'null', '-',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk));
      child.on('error', error => resolve(error.message));
      child.on('close', code => resolve(code === 0 ? null : firstError(stderr)));
    });
    probed.set(key, result);
  }
  return result;
}

export function resetEncoderProbes() {
  probed.clear();
}

/** Why this render can't use a GPU encoder, or null when nothing rules it out. */
export function hardwareBlocker({ codec, pixelFormat, crf }: {
  readonly codec: Codec | undefined;
  readonly pixelFormat: PixelFormat | undefined;
  readonly crf: number | undefined;
}): string | null {
  if (codec !== 'h264' && codec !== 'h265') {
    return `${codec ?? 'this format'} is only encoded in software (GPU encoding covers h264 and h265)`;
  }
  if (pixelFormat !== undefined && pixelFormat !== 'yuv420p') {
    return `pixel format ${pixelFormat} is only encoded in software (use yuv420p)`;
  }
  if (crf !== undefined) {
    return '--crf does not apply to GPU encoders (use --video-bitrate instead)';
  }
  return null;
}

/** Decides between a GPU encoder and software for `--hardware-acceleration`. */
export async function chooseEncoder({ mode, codec, pixelFormat, crf, videoBitrate, size, ffmpeg, platform = process.platform, env = process.env, probe = probeEncoder }: {
  readonly mode: HardwareAcceleration;
  readonly codec: Codec | undefined;
  readonly pixelFormat: PixelFormat | undefined;
  readonly crf: number | undefined;
  readonly videoBitrate?: string;
  /** Size of the video, which decides whether a GPU encoder accepts it. */
  readonly size: FrameSize;
  readonly ffmpeg: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly probe?: (ffmpeg: string, plan: HardwarePlan, size: FrameSize) => Promise<string | null>;
}): Promise<EncoderChoice> {
  if (mode === 'disable') {
    return SOFTWARE;
  }
  const decline = (reason: string): EncoderChoice => {
    if (mode === 'required') {
      throw new Error(`--hardware-acceleration required, but ${reason}. Use "if-possible" to fall back to software, or "disable".`);
    }
    return { plan: null, reason };
  };

  const blocker = hardwareBlocker({ codec, pixelFormat, crf });
  if (blocker) {
    return decline(blocker);
  }
  const candidates = BACKENDS.filter(backend => backend.platforms.includes(platform) && backend.encoders[codec!]);
  if (!candidates.length) {
    return decline(`no GPU encoder is supported on ${platform}`);
  }

  const needBitrate: string[] = [];
  const failures: string[] = [];
  for (const backend of candidates) {
    const rateArgs = backend.rateArgs(videoBitrate);
    if (!rateArgs) {
      needBitrate.push(backend.label);
      continue;
    }
    const plan: HardwarePlan = { encoder: backend.encoders[codec!]!, inputArgs: backend.inputArgs(env), filter: backend.filter, rateArgs };
    const failure = await probe(ffmpeg, plan, size);
    if (failure === null) {
      return { plan, label: backend.label };
    }
    failures.push(`${plan.encoder}: ${failure}`);
  }

  if (!failures.length) {
    return decline(`${needBitrate.join(' and ')} needs --video-bitrate (there is no default quality for it)`);
  }
  return decline(`the GPU encoder did not start (${failures.join('; ')}). It needs a supported GPU, a recent driver and an ffmpeg built with it`);
}

/** The log line for the encoder that was picked, or null when acceleration is off. */
export function describeChoice(mode: HardwareAcceleration, choice: EncoderChoice): string | null {
  if (mode === 'disable') {
    return null;
  }
  return choice.plan
    ? `Encoder: ${choice.plan.encoder} (${choice.label}), hardware accelerated: true`
    : `Hardware acceleration unavailable: ${choice.reason}. Encoding in software.`;
}
