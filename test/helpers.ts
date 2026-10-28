import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

export function hasEncoder(name: string): boolean {
  return spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout.includes(name);
}

/** Asserts a color within a tolerance, for lossy formats. */
export function expectColor(actual: readonly number[], expected: readonly number[], tolerance = 0) {
  actual.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(tolerance));
}
