import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { centerPixel, expectColor, FIXTURE, hasEncoder, probe, psnr, referenceFrame, run } from './helpers.js';


const OUT = join(FIXTURE, 'out');
const CLIPS_DIR = join(FIXTURE, 'public', 'clips');
const TEST_MP4 = join(CLIPS_DIR, 'test.mp4');
const CLIP_A = join(CLIPS_DIR, 'clipA.mp4');
const ALPHA_WEBM = join(CLIPS_DIR, 'alpha_circle.webm');
const ALPHA_PRORES = join(CLIPS_DIR, 'alpha_circle.mov');

// 5 minutes long so that a paused decoder cannot write the rest of its clip into the pipe buffer and exit on
// its own: these tiny frames are about 250 bytes each, and the whole output has to be far bigger than that buffer.
const BUDGET_COLORS = ['red', 'green', 'blue'] as const;
const budgetClip = (color: string) => join(CLIPS_DIR, `budget-${color}.mp4`);

const RED = [255, 0, 0];
// ffmpeg's "green" is the half intensity one (#008000).
const GREEN = [0, 128, 0];
const BLUE = [0, 0, 255];
const CYAN = [0, 255, 255];

function pixelAt(file: string, frame: number, x: number, y: number): [number, number, number] {
  const { width } = probe(file);
  const raw = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-vf',
    `select=eq(n\\,${frame})`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const offset = (y * width + x) * 3;
  return [raw[offset]!, raw[offset + 1]!, raw[offset + 2]!];
}

/** Samples the process table while `task` runs: the most decoders of the budget clips alive at once. */
async function peakDecoders<T>(task: Promise<T>): Promise<{ result: T; peak: number }> {
  let done = false;
  const finished = task.finally(() => {
    done = true;
  });
  const sample = async () => {
    let peak = 0;
    while (!done) {
      const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'stat=,args='], { maxBuffer: 16 * 1024 * 1024 });
      // Only decoders write to image2pipe, which leaves out the short `ffmpeg -i` probes of the same files.
      // A zombie (Z) is a decoder that was already killed and holds no memory.
      const alive = stdout.split('\n').filter(line => !line.trimStart().startsWith('Z')
        && line.includes('ffmpeg')
        && line.includes('image2pipe')
        && BUDGET_COLORS.some(color => line.includes(budgetClip(color))));
      peak = Math.max(peak, alive.length);
      await sleep(20);
    }
    return peak;
  };
  const [result, peak] = await Promise.all([finished, sample()]);
  return { result, peak };
}

describe('<Video> render mode e2e', () => {
  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(CLIPS_DIR, { recursive: true, force: true });
    mkdirSync(CLIPS_DIR, { recursive: true });

    const resTest = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=64x64:r=30:d=0.5',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:r=30:d=0.5',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0',
      '-pix_fmt',
      'yuv420p',
      TEST_MP4,
    ], { encoding: 'utf8' });

    if (resTest.status !== 0) {
      throw new Error(`Failed to generate test fixture clip with ffmpeg (code ${resTest.status}): ${resTest.stderr || resTest.error?.message}`);
    }

    const resClipA = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=64x64:r=60:d=3',
      '-vf',
      'geq=r=\'mod(N*17\\,256)\':g=\'mod(N*31\\,256)\':b=\'mod(N*53\\,256)\'',
      '-c:v',
      'libx264',
      '-g',
      '60',
      '-keyint_min',
      '60',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      CLIP_A,
    ], { encoding: 'utf8' });

    if (resClipA.status !== 0) {
      throw new Error(`Failed to generate clipA with ffmpeg (code ${resClipA.status}): ${resClipA.stderr || resClipA.error?.message}`);
    }

    for (const color of BUDGET_COLORS) {
      const res = spawnSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=64x64:r=30:d=300`,
        '-pix_fmt',
        'yuv420p',
        budgetClip(color),
      ], { encoding: 'utf8' });

      if (res.status !== 0) {
        throw new Error(`Failed to generate the ${color} budget clip with ffmpeg (code ${res.status}): ${res.stderr || res.error?.message}`);
      }
    }

    if (hasEncoder('libvpx-vp9')) {
      const resWebm = spawnSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=cyan:s=64x64:r=30:d=1',
        '-vf',
        'format=rgba,geq=r=\'r(X,Y)\':g=\'g(X,Y)\':b=\'b(X,Y)\':a=\'if(lte(hypot(X-32\\,Y-32)\\,16)\\,255\\,0)\'',
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        ALPHA_WEBM,
      ], { encoding: 'utf8' });

      if (resWebm.status !== 0) {
        throw new Error(`Failed to generate alpha webm with ffmpeg (code ${resWebm.status}): ${resWebm.stderr || resWebm.error?.message}`);
      }
    }

    if (hasEncoder('prores_ks')) {
      const resProres = spawnSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=cyan:s=64x64:r=30:d=1',
        '-vf',
        'format=rgba,geq=r=\'r(X,Y)\':g=\'g(X,Y)\':b=\'b(X,Y)\':a=\'if(lte(hypot(X-32\\,Y-32)\\,16)\\,255\\,0)\'',
        '-c:v',
        'prores_ks',
        '-profile:v',
        '4444',
        '-pix_fmt',
        'yuva444p10le',
        ALPHA_PRORES,
      ], { encoding: 'utf8' });

      if (resProres.status !== 0) {
        throw new Error(`Failed to generate alpha ProRes with ffmpeg (code ${resProres.status}): ${resProres.stderr || resProres.error?.message}`);
      }
    }
  });

  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(CLIPS_DIR, { recursive: true, force: true });
  });

  it('renders an MP4 with exact source frames from staticFile', async () => {
    const output = join(OUT, 'SingleVideo.mp4');
    const { code } = await run(['render', 'SingleVideo', '--entry', 'src/video.tsx', '-o', output], FIXTURE);
    expect(code).toBe(0);

    const stream = probe(output);
    expect(stream).toMatchObject({
      codec_name: 'h264',
      width: 64,
      height: 64,
      nb_read_frames: '30',
    });

    expectColor(centerPixel(output, 5), RED, 6);
    expectColor(centerPixel(output, 25), BLUE, 6);
  });

  it.runIf(hasEncoder('libvpx-vp9'))('renders a WebM with exact frames', async () => {
    const output = join(OUT, 'SingleVideo.webm');
    const { code } = await run(['render', 'SingleVideo', '--entry', 'src/video.tsx', '-o', output], FIXTURE);
    expect(code).toBe(0);

    const stream = probe(output);
    expect(stream).toMatchObject({
      codec_name: 'vp9',
      nb_read_frames: '30',
    });
  });

  it('renders two videos on the same frame using deduplication', async () => {
    const output = join(OUT, 'TwoVideos.mp4');
    const { code } = await run(['render', 'TwoVideos', '--entry', 'src/video.tsx', '-o', output], FIXTURE);
    expect(code).toBe(0);

    const stream = probe(output);
    expect(stream.nb_read_frames).toBe('10');

    // Left half (x=16) and right half (x=48) are both red on frame 5
    expectColor(pixelAt(output, 5, 16, 32), RED, 6);
    expectColor(pixelAt(output, 5, 48, 32), RED, 6);
  });

  it('matches reference frames across playback rates with PSNR above threshold', async () => {
    const rates = [1, 2, 4, 0.5];
    const frameIndex = 10;
    const trimBefore = 15;

    for (const rate of rates) {
      const outPng = join(OUT, `rate_${rate}_frame_${frameIndex}.png`);
      const { code } = await run([
        'render',
        'VideoPlaybackRate',
        '--entry',
        'src/video.tsx',
        '--frame',
        String(frameIndex),
        '--props',
        JSON.stringify({ playbackRate: rate, trimBefore }),
        '-o',
        outPng,
      ], FIXTURE);
      expect(code).toBe(0);

      const exactSeconds = (trimBefore + frameIndex * rate) / 30;
      const refPng = referenceFrame(CLIP_A, exactSeconds, join(OUT, `ref_rate_${rate}.png`));
      const score = psnr(outPng, refPng);
      expect(score).toBeGreaterThan(35);
    }

    // Full sequential render pass for playbackRate = 2
    const fullRate2 = join(OUT, 'rate2_full.mp4');
    const resFull = await run([
      'render',
      'VideoPlaybackRate',
      '--entry',
      'src/video.tsx',
      '--props',
      JSON.stringify({ playbackRate: 2, trimBefore }),
      '-o',
      fullRate2,
    ], FIXTURE);
    expect(resFull.code).toBe(0);

    for (const f of [5, 10]) {
      const framePng = join(OUT, `rate2_full_${f}.png`);
      execFileSync('ffmpeg', ['-v', 'error', '-i', fullRate2, '-vf', `select=eq(n\\,${f})`, '-frames:v', '1', '-y', framePng]);
      const exactSeconds = (trimBefore + f * 2) / 30;
      const ref = referenceFrame(CLIP_A, exactSeconds, join(OUT, `ref_rate2_full_${f}.png`));
      expect(psnr(framePng, ref)).toBeGreaterThan(30);
    }
  });

  it('handles consecutive shots from the same file without frame bleeding', async () => {
    // 1. Still frames render verification
    const cut14 = join(OUT, 'cuts_frame_14.png');
    const cut15 = join(OUT, 'cuts_frame_15.png');

    const res14 = await run(['render', 'VideoCuts', '--entry', 'src/video.tsx', '--frame', '14', '-o', cut14], FIXTURE);
    expect(res14.code).toBe(0);

    const res15 = await run(['render', 'VideoCuts', '--entry', 'src/video.tsx', '--frame', '15', '-o', cut15], FIXTURE);
    expect(res15.code).toBe(0);

    // Frame 14: first sequence relative frame 14, trimBefore 0 -> source time 14 / 30s
    const ref14 = referenceFrame(CLIP_A, 14 / 30, join(OUT, 'ref_cut14.png'));
    expect(psnr(cut14, ref14)).toBeGreaterThan(35);

    // Frame 15: second sequence relative frame 0, trimBefore 60 -> source time 60 / 30s = 2.0s
    const ref15 = referenceFrame(CLIP_A, 60 / 30, join(OUT, 'ref_cut15.png'));
    expect(psnr(cut15, ref15)).toBeGreaterThan(35);

    // Frame 15 must NOT match the last frame of the previous shot (frame 14 / 30s) or leaked frame 15 / 30s
    // Use relative margin assertion (> 10 dB) to ensure robust cross-platform tolerance
    const refLeak = referenceFrame(CLIP_A, 15 / 30, join(OUT, 'ref_leak.png'));
    expect(psnr(cut15, ref15)).toBeGreaterThan(psnr(cut15, ref14) + 10);
    expect(psnr(cut15, ref15)).toBeGreaterThan(psnr(cut15, refLeak) + 10);

    // 2. Full sequential multi-frame MP4 render pass verifying sequential decoder & LRU cache
    const fullCuts = join(OUT, 'cuts_full.mp4');
    const resFull = await run(['render', 'VideoCuts', '--entry', 'src/video.tsx', '-o', fullCuts], FIXTURE);
    expect(resFull.code).toBe(0);

    const f14 = join(OUT, 'cuts_full_14.png');
    const f15 = join(OUT, 'cuts_full_15.png');
    execFileSync('ffmpeg', ['-v', 'error', '-i', fullCuts, '-vf', 'select=eq(n\\,14)', '-frames:v', '1', '-y', f14]);
    execFileSync('ffmpeg', ['-v', 'error', '-i', fullCuts, '-vf', 'select=eq(n\\,15)', '-frames:v', '1', '-y', f15]);

    expect(psnr(f14, ref14)).toBeGreaterThan(30);
    expect(psnr(f15, ref15)).toBeGreaterThan(30);
    expect(psnr(f15, ref15)).toBeGreaterThan(psnr(f15, ref14) + 10);
    expect(psnr(f15, ref15)).toBeGreaterThan(psnr(f15, refLeak) + 10);
  });

  it.runIf(hasEncoder('libvpx-vp9'))('composites transparent WebM over a colored background', async () => {
    const outPng = join(OUT, 'alpha_webm.png');
    const { code } = await run(['render', 'VideoAlphaWebm', '--entry', 'src/video.tsx', '--frame', '0', '-o', outPng], FIXTURE);
    expect(code).toBe(0);

    // Inside circular mask: cyan clip color
    expectColor(pixelAt(outPng, 0, 32, 32), CYAN, 6);
    // Outside circular mask: red background
    expectColor(pixelAt(outPng, 0, 5, 5), RED, 6);
  });

  it.runIf(hasEncoder('prores_ks'))('composites transparent ProRes 4444 over a colored background', async () => {
    const outPng = join(OUT, 'alpha_prores.png');
    const { code } = await run(['render', 'VideoAlphaProRes', '--entry', 'src/video.tsx', '--frame', '0', '-o', outPng], FIXTURE);
    expect(code).toBe(0);

    // Inside circular mask: cyan clip color
    expectColor(pixelAt(outPng, 0, 32, 32), CYAN, 6);
    // Outside circular mask: red background
    expectColor(pixelAt(outPng, 0, 5, 5), RED, 6);
  });

  it('produces identical frames regardless of concurrency', async () => {
    const outC1 = join(OUT, 'concurrency_1.mp4');
    const outC3 = join(OUT, 'concurrency_3.mp4');

    const res1 = await run(['render', 'VideoCuts', '--entry', 'src/video.tsx', '--concurrency', '1', '-o', outC1], FIXTURE);
    expect(res1.code).toBe(0);

    const res3 = await run(['render', 'VideoCuts', '--entry', 'src/video.tsx', '--concurrency', '3', '-o', outC3], FIXTURE);
    expect(res3.code).toBe(0);

    const score = psnr(outC1, outC3);
    expect(score).toBe(Infinity);

    // Also assert frame 15 from concurrency output matches ground truth reference
    const ref15 = referenceFrame(CLIP_A, 60 / 30, join(OUT, 'ref_cut15_c1.png'));
    const f15C1 = join(OUT, 'c1_frame_15.png');
    execFileSync('ffmpeg', ['-v', 'error', '-i', outC1, '-vf', 'select=eq(n\\,15)', '-frames:v', '1', '-y', f15C1]);
    expect(psnr(f15C1, ref15)).toBeGreaterThan(30);
  });

  it('fails with a clear error without empty frame when clip is missing', async () => {
    const output = join(OUT, 'MissingClip.mp4');
    const { code, stderr } = await run(['render', 'MissingClip', '--entry', 'src/video.tsx', '-o', output], FIXTURE);
    expect(code).toBe(1);
    expect(stderr).toContain('<Video src="/clips/missing-clip-never-exists.mp4"> failed to load');
    expect(stderr).toContain('video file not found');
    expect(existsSync(output)).toBe(false);
  });

  it('accepts --video-cache-mb flag and renders correctly with minimum cache', async () => {
    const output = join(OUT, 'cached.mp4');
    const { code } = await run(['render', 'SingleVideo', '--entry', 'src/video.tsx', '--video-cache-mb', '1', '-o', output], FIXTURE);
    expect(code).toBe(0);
    expect(probe(output).nb_read_frames).toBe('30');
    expectColor(centerPixel(output, 5), RED, 6);
    expectColor(centerPixel(output, 25), BLUE, 6);
  });

  it('limits live video decoders with --video-decoder-memory-mb', async () => {
    const render = (output: string, ...flags: string[]) =>
      peakDecoders(run(['render', 'DecoderBudget', '--entry', 'src/video.tsx', ...flags, '-o', output], FIXTURE));

    // Without the flag the decoders of earlier clips stay alive, which shows that the sampling sees them.
    const control = await render(join(OUT, 'budget_default.mp4'));
    expect(control.result.code).toBe(0);
    expect(control.peak).toBeGreaterThanOrEqual(2);

    // A 64x64 decoder is estimated at 819 200 bytes, so 1 MB fits exactly one.
    const output = join(OUT, 'budget_limited.mp4');
    const limited = await render(output, '--video-decoder-memory-mb', '1');
    expect(limited.result.code).toBe(0);
    expect(limited.peak).toBeLessThanOrEqual(1);
    expect(probe(output).nb_read_frames).toBe('30');
    expectColor(centerPixel(output, 5), RED, 6);
    expectColor(centerPixel(output, 15), GREEN, 6);
    expectColor(centerPixel(output, 25), BLUE, 6);
  }, 120_000);
});
