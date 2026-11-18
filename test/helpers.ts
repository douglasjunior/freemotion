import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';


export const REPO = fileURLToPath(new URL('..', import.meta.url));
export const CLI = fileURLToPath(new URL('../dist/node/cli.js', import.meta.url));
export const FIXTURE = fileURLToPath(new URL('./fixtures/basic', import.meta.url));

export type RunResult = { code: number | null; stdout: string; stderr: string };

/** Runs the built CLI to completion. */
export function run(args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, FORCE_COLOR: '0' } });
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
