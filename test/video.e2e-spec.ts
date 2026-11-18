import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { centerPixel, expectColor, FIXTURE, hasEncoder, probe, run } from './helpers.js';


const OUT = join(FIXTURE, 'out');
const CLIPS_DIR = join(FIXTURE, 'public', 'clips');
const TEST_MP4 = join(CLIPS_DIR, 'test.mp4');

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

describe('<Video> render mode e2e', () => {
  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(CLIPS_DIR, { recursive: true });

    if (!existsSync(TEST_MP4)) {
      spawnSync('ffmpeg', [
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
      ]);
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
  });

  it('fails with a clear error without empty frame when clip is missing', async () => {
    const { code, stderr } = await run(['render', 'MissingClip', '--entry', 'src/video.tsx'], FIXTURE);
    expect(code).toBe(1);
    expect(stderr).toContain('<Video src="/clips/missing-clip-never-exists.mp4"> failed to load');
  });

  it('accepts --video-cache-mb flag', async () => {
    const output = join(OUT, 'cached.mp4');
    const { code } = await run(['render', 'SingleVideo', '--entry', 'src/video.tsx', '--video-cache-mb', '256', '-o', output], FIXTURE);
    expect(code).toBe(0);
  });
});
