import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';


export const REPO = fileURLToPath(new URL('..', import.meta.url));
export const CLI = fileURLToPath(new URL('../dist/node/cli.js', import.meta.url));
export const FIXTURE = fileURLToPath(new URL('./fixtures/basic', import.meta.url));
export const SKILL_CLIPS_DIR = join(FIXTURE, 'public', 'skill');

function generateClipWithFfmpeg(args: readonly string[], outputPath: string): void {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, outputPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (existsSync(outputPath)) {
      rmSync(outputPath, { force: true });
    }
    throw new Error(`ffmpeg failed generating ${outputPath} (code ${result.status}): ${result.stderr || result.error?.message}`);
  }
}

export function ensureSkillClips(): void {
  mkdirSync(SKILL_CLIPS_DIR, { recursive: true });
  const shot1 = join(SKILL_CLIPS_DIR, 'shot1.mp4');
  const shot2 = join(SKILL_CLIPS_DIR, 'shot2.mp4');
  const shot3 = join(SKILL_CLIPS_DIR, 'shot3.mp4');
  const nar1 = join(SKILL_CLIPS_DIR, 'narration1.wav');
  const nar2 = join(SKILL_CLIPS_DIR, 'narration2.wav');
  const nar3 = join(SKILL_CLIPS_DIR, 'narration3.wav');
  const sfx = join(SKILL_CLIPS_DIR, 'sfx.wav');
  const music = join(SKILL_CLIPS_DIR, 'music.wav');

  if (!existsSync(shot1)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'nullsrc=s=64x64:r=30:d=3',
      '-vf', 'geq=r=\'mod(N*19\\,256)\':g=\'mod(N*37\\,256)\':b=\'mod(N*59\\,256)\'',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ], shot1);
  }
  if (!existsSync(shot2)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'nullsrc=s=64x64:r=30:d=3',
      '-vf', 'geq=r=\'mod(N*23\\,256)\':g=\'mod(N*41\\,256)\':b=\'mod(N*61\\,256)\'',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ], shot2);
  }
  if (!existsSync(shot3)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'nullsrc=s=64x64:r=30:d=3',
      '-vf', 'geq=r=\'mod(N*29\\,256)\':g=\'mod(N*43\\,256)\':b=\'mod(N*67\\,256)\'',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ], shot3);
  }
  if (!existsSync(nar1)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2',
      '-af', 'volume=8', '-c:a', 'pcm_s16le',
    ], nar1);
  }
  if (!existsSync(nar2)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=1500:duration=2',
      '-af', 'volume=8', '-c:a', 'pcm_s16le',
    ], nar2);
  }
  if (!existsSync(nar3)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=2500:duration=2',
      '-af', 'volume=8', '-c:a', 'pcm_s16le',
    ], nar3);
  }
  if (!existsSync(sfx)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=800:duration=1',
      '-af', 'volume=8', '-c:a', 'pcm_s16le',
    ], sfx);
  }
  if (!existsSync(music)) {
    generateClipWithFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-af', 'volume=8', '-c:a', 'pcm_s16le',
    ], music);
  }
}

export type RunResult = { code: number | null; stdout: string; stderr: string };

/** Runs the built CLI to completion. */
export function run(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, FORCE_COLOR: '0', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

type Stream = { width: number; height: number; pix_fmt: string; nb_read_frames?: string; color_space?: string; codec_name: string };

export function probe(file: string): Stream {
  const output = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  return (JSON.parse(output) as { streams: Stream[] }).streams[0]!;
}

/** RGB of the center pixel of frame `index` of an image or video file. */
export function centerPixel(file: string, index = 0): [number, number, number] {
  const { width, height } = probe(file);
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `select=eq(n\\,${index})`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
  return [raw[offset]!, raw[offset + 1]!, raw[offset + 2]!];
}

/** RGBA of pixel at `(x, y)` of frame `index` of an image or video file. */
export function pixelAt(file: string, x: number, y: number, index = 0): [number, number, number, number] {
  const { width, codec_name } = probe(file);
  const decoder = codec_name === 'vp9' ? ['-c:v', 'libvpx-vp9'] : [];
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', ...decoder, '-i', file,
    '-vf', `select=eq(n\\,${index})`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const offset = (y * width + x) * 4;
  return [raw[offset]!, raw[offset + 1]!, raw[offset + 2]!, raw[offset + 3]!];
}

export function hasEncoder(name: string): boolean {
  return spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout.includes(name);
}

/** Computes average PSNR (dB) between two video or image files via ffmpeg. Returns Infinity when identical. */
export function psnr(a: string, b: string): number {
  const result = spawnSync('ffmpeg', ['-v', 'info', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const output = (result.stderr || '') + (result.stdout || '');
  const match = output.match(/average:([0-9.]+|inf)/i);
  if (!match) {
    throw new Error(`Failed to calculate PSNR between ${a} and ${b}: ${output}`);
  }
  return match[1]?.toLowerCase() === 'inf' ? Infinity : parseFloat(match[1]!);
}

/** Extracts an exact frame at a given timestamp in seconds from a video file using ffmpeg. */
export function referenceFrame(file: string, seconds: number, outputPath?: string): string {
  const target = outputPath ?? fileURLToPath(new URL(`./fixtures/basic/out/ref_${Date.now()}_${Math.random().toString(36).slice(2)}.png`, import.meta.url));
  mkdirSync(dirname(target), { recursive: true });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    seconds.toFixed(6),
    '-i',
    file,
    '-frames:v',
    '1',
    '-y',
    target,
  ]);
  return target;
}

/** Rightmost pixel x-coordinate where color is darker than threshold (used to measure rendered text width). */
export function rightmostDarkPixel(file: string, threshold = 200): number {
  const { width, height } = probe(file);
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  let maxX = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      const r = raw[offset]!;
      const g = raw[offset + 1]!;
      const b = raw[offset + 2]!;
      if (r < threshold || g < threshold || b < threshold) {
        if (x > maxX) {
          maxX = x;
        }
      }
    }
  }
  return maxX;
}

/** Asserts a color within a tolerance, for lossy formats. */
export function expectColor(actual: readonly number[], expected: readonly number[], tolerance = 0) {
  actual.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(tolerance));
}

export type AudioStream = {
  codec_name: string;
  codec_type: 'audio';
  sample_rate: string;
  channels: number;
};

export function probeAudioStreams(file: string): AudioStream[] {
  const output = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  const streams = (JSON.parse(output) as { streams: ({ codec_type: string } & AudioStream)[] }).streams;
  return streams.filter(s => s.codec_type === 'audio');
}

export function readPcmMono(file: string, sampleRate = 48000): Float32Array {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error',
    '-i', file,
    '-f', 'f32le',
    '-ac', '1',
    '-ar', String(sampleRate),
    '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

export function computeRms(samples: Float32Array, start = 0, end = samples.length): number {
  let sum = 0;
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i++) {
    const val = samples[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum / count);
}

/**
 * Computes normalized Goertzel power at target frequency `targetFreq`.
 * Returns a value between 0.0 (no energy) and ~1.0 (pure tone at full amplitude).
 */
export function goertzelPower(samples: Float32Array, targetFreq: number, sampleRate = 48000): number {
  if (samples.length === 0) return 0;
  const n = samples.length;
  const k = Math.round((n * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);

  let s0 = 0;
  let s1 = 0;
  let s2 = 0;

  for (let i = 0; i < n; i++) {
    s0 = (samples[i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (4 * Math.max(0, power)) / (n * n);
}

