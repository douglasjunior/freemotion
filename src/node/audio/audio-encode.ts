export type AudioCodec = 'aac' | 'libopus' | 'opus' | 'pcm';

export type AudioEncodeOptions = {
  readonly codec?: AudioCodec;
  readonly sampleRate?: number;
  readonly bitrate?: string;
};

/**
 * Returns ffmpeg arguments for audio encoding (48 kHz stereo by default).
 * Supported codecs:
 * - 'aac' (default): 192k bitrate
 * - 'libopus' / 'opus': 128k bitrate
 * - 'pcm': pcm_s16le
 */
export function audioEncodeArgs(options: AudioEncodeOptions = {}): string[] {
  const codec = options.codec ?? 'aac';
  const sampleRate = options.sampleRate ?? 48000;

  if (codec === 'libopus' || codec === 'opus') {
    return [
      '-c:a', 'libopus',
      '-b:a', options.bitrate ?? '128k',
      '-ar', String(sampleRate),
      '-ac', '2',
    ];
  }

  if (codec === 'pcm') {
    return [
      '-c:a', 'pcm_s16le',
      '-ar', String(sampleRate),
      '-ac', '2',
    ];
  }

  return [
    '-c:a', 'aac',
    '-b:a', options.bitrate ?? '192k',
    '-ar', String(sampleRate),
    '-ac', '2',
  ];
}

export type MuxArgsOptions = {
  readonly format?: string;
};

/**
 * Returns ffmpeg arguments for muxing video and audio streams into container.
 * For MP4 containers, enables `+faststart` for web streaming.
 */
export function muxArgs(options: MuxArgsOptions = {}): string[] {
  const args = ['-c', 'copy'];
  if (options.format === 'mp4' || (!options.format && options.format !== 'webm')) {
    args.push('-movflags', '+faststart');
  }
  return args;
}
