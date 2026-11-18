import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { centerPixel, expectColor, FIXTURE, hasEncoder, probe, psnr, referenceFrame, run } from './helpers.js';


const OUT = join(FIXTURE, 'out');
const CLIPS_DIR = join(FIXTURE, 'public', 'clips');
const TEST_MP4 = join(CLIPS_DIR, 'test.mp4');
const CLIP_A = join(CLIPS_DIR, 'clipA.mp4');
const ALPHA_WEBM = join(CLIPS_DIR, 'alpha_circle.webm');
const ALPHA_PRORES = join(CLIPS_DIR, 'alpha_circle.mov');

const RED = [255, 0, 0];
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

describe('<Video> render mode e2e', () => {
  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(CLIPS_DIR, { recursive: true });

    if (!existsSync(TEST_MP4)) {
      const result = spawnSync('ffmpeg', [
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

      if (result.status !== 0) {
        throw new Error(`Failed to generate test fixture clip with ffmpeg (code ${result.status}): ${result.stderr || result.error?.message}`);
      }
    }

    if (!existsSync(CLIP_A)) {
      const result = spawnSync('ffmpeg', [
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

      if (result.status !== 0) {
        throw new Error(`Failed to generate clipA with ffmpeg (code ${result.status}): ${result.stderr || result.error?.message}`);
      }
    }

    if (hasEncoder('libvpx-vp9') && !existsSync(ALPHA_WEBM)) {
      const result = spawnSync('ffmpeg', [
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

      if (result.status !== 0) {
        throw new Error(`Failed to generate alpha webm with ffmpeg (code ${result.status}): ${result.stderr || result.error?.message}`);
      }
    }

    if (hasEncoder('prores_ks') && !existsSync(ALPHA_PRORES)) {
      const result = spawnSync('ffmpeg', [
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

      if (result.status !== 0) {
        throw new Error(`Failed to generate alpha ProRes with ffmpeg (code ${result.status}): ${result.stderr || result.error?.message}`);
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
  });

  it('handles consecutive shots from the same file without frame bleeding', async () => {
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

    // Verify it did not leak frame 15 from the first shot (source time 15 / 30 = 0.5s)
    const refLeak = referenceFrame(CLIP_A, 15 / 30, join(OUT, 'ref_leak.png'));
    expect(psnr(cut15, refLeak)).toBeLessThan(25);
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
});
