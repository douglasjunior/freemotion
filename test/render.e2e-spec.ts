import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { centerPixel, ensureSkillClips, expectColor, FIXTURE, hasEncoder, pixelAt, probe, REPO, rightmostDarkPixel, run } from './helpers.js';


const OUT = join(FIXTURE, 'out');
const FONT_SRC = join(REPO, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
const FONT_DEST = join(FIXTURE, 'public/inter.woff2');
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 255, 0];

describe('freemotion render', () => {
  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    ensureSkillClips();
    copyFileSync(FONT_SRC, FONT_DEST);
  });
  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(FONT_DEST, { force: true });
  });

  it('renders an MP4 with every frame, tagged as BT.709', async () => {
    const { code, stdout } = await run(['render', 'Colors'], FIXTURE);
    expect(code).toBe(0);
    expect(stdout).toContain('Colors · 10 frames');

    const file = join(OUT, 'Colors.mp4');
    expect(probe(file)).toMatchObject({ codec_name: 'h264', width: 64, height: 64, pix_fmt: 'yuv420p', nb_read_frames: '10', color_space: 'bt709' });
    expectColor(centerPixel(file, 2), RED, 6);
    expectColor(centerPixel(file, 7), BLUE, 6);
  });

  it('renders a still PNG of one frame, losslessly', async () => {
    const output = join(OUT, 'still.png');
    expect((await run(['render', 'Colors', '--frame', '7', '-o', output], FIXTURE)).code).toBe(0);
    expect(probe(output)).toMatchObject({ width: 64, height: 64 });
    expect(centerPixel(output)).toEqual(BLUE);
  });

  it('renders a still PNG with default white background on unpainted areas', async () => {
    const output = join(OUT, 'still-white-bg.png');
    expect((await run(['render', 'AlphaBox', '--entry', 'src/alpha.tsx', '--frame', '0', '-o', output], FIXTURE)).code).toBe(0);
    const corner = pixelAt(output, 2, 2, 0);
    expect(corner).toEqual([255, 255, 255, 255]);
  });

  it('renders a frame range', async () => {
    const output = join(OUT, 'range.mp4');
    expect((await run(['render', 'Colors', '--frames', '5-9', '-o', output], FIXTURE)).code).toBe(0);
    expect(probe(output).nb_read_frames).toBe('5');
    expectColor(centerPixel(output, 0), BLUE, 6);
  });

  it('renders a GIF', async () => {
    const output = join(OUT, 'colors.gif');
    expect((await run(['render', 'Colors', '-o', output], FIXTURE)).code).toBe(0);
    expect(probe(output)).toMatchObject({ codec_name: 'gif', nb_read_frames: '10' });
    expectColor(centerPixel(output, 0), RED, 8);
  });

  it.runIf(hasEncoder('libvpx-vp9'))('renders a WebM', async () => {
    const output = join(OUT, 'colors.webm');
    expect((await run(['render', 'Colors', '-o', output], FIXTURE)).code).toBe(0);
    expect(probe(output)).toMatchObject({ codec_name: 'vp9', nb_read_frames: '10' });
  });

  it('renders at a higher pixel density with --scale', async () => {
    const output = join(OUT, 'scaled.png');
    expect((await run(['render', 'Colors', '--frame', '0', '--scale', '2', '-o', output], FIXTURE)).code).toBe(0);
    expect(probe(output)).toMatchObject({ width: 128, height: 128 });
  });

  it('merges --props over defaultProps', async () => {
    const output = join(OUT, 'props.png');
    expect((await run(['render', 'Props', '--frame', '0', '--props', '{"color":"#00ff00"}', '-o', output], FIXTURE)).code).toBe(0);
    expect(centerPixel(output)).toEqual(GREEN);
  });

  it('waits for delayRender() before capturing', async () => {
    const output = join(OUT, 'held.png');
    expect((await run(['render', 'Held', '--frame', '0', '-o', output], FIXTURE)).code).toBe(0);
    expect(centerPixel(output)).toEqual(GREEN);
  });

  it('serves public/ files and waits for <Img>', async () => {
    const output = join(OUT, 'asset.png');
    expect((await run(['render', 'Asset', '--frame', '0', '-o', output], FIXTURE)).code).toBe(0);
    expect(centerPixel(output)).toEqual(GREEN);
  });

  it('loads and applies a font with loadFont()', async () => {
    const custom = join(OUT, 'font-custom.png');
    const fallback = join(OUT, 'font-fallback.png');

    expect((await run(['render', 'CustomFont', '--entry', 'src/font.tsx', '--frame', '0', '-o', custom], FIXTURE)).code).toBe(0);
    expect((await run(['render', 'FallbackFont', '--entry', 'src/font.tsx', '--frame', '0', '-o', fallback], FIXTURE)).code).toBe(0);

    const customWidth = rightmostDarkPixel(custom);
    const fallbackWidth = rightmostDarkPixel(fallback);

    expect(customWidth).toBeLessThan(fallbackWidth - 50);
    expect(customWidth).toBeGreaterThan(50);
    expect(customWidth).toBeLessThan(120);
    expect(fallbackWidth).toBeGreaterThan(160);
  });

  it('renders every composition with --all', async () => {
    const outDir = join(OUT, 'all');
    expect((await run(['render', '--all', '--format', 'png', '--out-dir', outDir], FIXTURE)).code).toBe(0);
    for (const id of ['Colors', 'Props', 'Held', 'Asset']) {
      expect(existsSync(join(outDir, `${id}.png`))).toBe(true);
    }
  });

  it('renders an MP4 captured with --image-format jpeg, maintaining color', async () => {
    const output = join(OUT, 'jpeg-capture.mp4');
    const { code } = await run(['render', 'Colors', '--image-format', 'jpeg', '--jpeg-quality', '90', '-o', output], FIXTURE);
    expect(code).toBe(0);
    expectColor(centerPixel(output, 2), RED, 6);
    expectColor(centerPixel(output, 7), BLUE, 6);
  });

  it('renders identically with aggressive tab recycling (--recycle-tabs 3)', async () => {
    const output = join(OUT, 'recycle-colors.mp4');
    const { code, stdout } = await run(['render', 'Colors', '--concurrency', '1', '--recycle-tabs', '3', '-o', output], FIXTURE);
    expect(code).toBe(0);
    expect(stdout).toContain('Colors · 10 frames');

    expect(probe(output)).toMatchObject({ codec_name: 'h264', width: 64, height: 64, pix_fmt: 'yuv420p', nb_read_frames: '10', color_space: 'bt709' });
    expectColor(centerPixel(output, 2), RED, 6);
    expectColor(centerPixel(output, 7), BLUE, 6);
  });

  it.runIf(hasEncoder('libvpx-vp9'))('renders a WebM with alpha and transparent corners', async () => {
    const output = join(OUT, 'alpha.webm');
    const { code } = await run([
      'render', 'AlphaBox',
      '--entry', 'src/alpha.tsx',
      '--pixel-format', 'yuva420p',
      '-o', output,
    ], FIXTURE);
    expect(code).toBe(0);
    const corner = pixelAt(output, 2, 2, 0);
    expect(corner[3]).toBe(0);
    const center = pixelAt(output, 32, 32, 0);
    expectColor(center.slice(0, 3), RED, 6);
    expect(center[3]).toBe(255);
  });

  it.runIf(hasEncoder('prores_ks'))('renders ProRes 4444 in .mov with alpha', async () => {
    const output = join(OUT, 'alpha.mov');
    const { code } = await run([
      'render', 'AlphaBox',
      '--entry', 'src/alpha.tsx',
      '--codec', 'prores',
      '--prores-profile', '4444',
      '-o', output,
    ], FIXTURE);
    expect(code).toBe(0);
    expect(probe(output)).toMatchObject({ codec_name: 'prores' });
    const corner = pixelAt(output, 2, 2, 0);
    expect(corner[3]).toBe(0);
    const center = pixelAt(output, 32, 32, 0);
    expectColor(center.slice(0, 3), RED, 6);
    expect(center[3]).toBe(255);
  });

  it('fails before rendering when --no-overwrite is passed and file exists', async () => {
    const output = join(OUT, 'existing.mp4');
    expect((await run(['render', 'Colors', '-o', output], FIXTURE)).code).toBe(0);
    expect(existsSync(output)).toBe(true);

    const { code, stderr } = await run(['render', 'Colors', '-o', output, '--no-overwrite'], FIXTURE);
    expect(code).toBe(1);
    expect(stderr).toContain('already exists');
    expect(stderr).toContain('--overwrite');
  });

  describe('errors', () => {
    it('lists the compositions when the id is unknown', async () => {
      const { code, stderr } = await run(['render', 'Nope'], FIXTURE);
      expect(code).toBe(1);
      expect(stderr).toContain('Unknown composition: Nope. Available: Colors, Props, Held, Asset, ShotMix.');
    });

    it('reports errors thrown by a composition', async () => {
      const { code, stderr } = await run(['render', 'Throws', '--entry', 'src/broken.tsx', '--frame', '0'], FIXTURE);
      expect(code).toBe(1);
      expect(stderr).toContain('kaboom');
    });

    it('needs even dimensions for MP4', async () => {
      const { code, stderr } = await run(['render', 'Odd', '--entry', 'src/broken.tsx'], FIXTURE);
      expect(code).toBe(1);
      expect(stderr).toContain('needs an even width and height');
    });

    it('explains a missing ffmpeg', async () => {
      const { code, stderr } = await run(['render', 'Colors', '--ffmpeg', '/nonexistent/ffmpeg'], FIXTURE);
      expect(code).toBe(1);
      expect(stderr).toContain('ffmpeg was not found');
    });

    it('explains a missing browser with --no-download', async () => {
      const { code, stderr } = await run(
        ['render', 'Colors', '--no-download'],
        FIXTURE,
        { PLAYWRIGHT_BROWSERS_PATH: '/tmp/nonexistent-playwright-browsers' },
      );
      expect(code).toBe(1);
      expect(stderr).toContain('Browser is not installed. Run freemotion browser ensure or pass --browser-executable.');
    });

    it('fails when a delayRender hold exceeds --timeout and passes when --timeout is larger', async () => {
      const slowFailOutput = join(OUT, 'slow-hold-fail.mp4');
      const { code: failCode, stderr: failStderr } = await run(
        ['render', 'SlowHold', '--entry', 'src/broken.tsx', '--timeout', '1000', '-o', slowFailOutput],
        FIXTURE,
      );
      expect(failCode).toBe(1);
      expect(failStderr).toContain('"slow hold" was not released with continueRender() within 1000 ms.');

      const slowPassOutput = join(OUT, 'slow-hold-pass.mp4');
      const { code: passCode } = await run(
        ['render', 'SlowHold', '--entry', 'src/broken.tsx', '--timeout', '3000', '-o', slowPassOutput],
        FIXTURE,
      );
      expect(passCode).toBe(0);
      expect(probe(slowPassOutput)).toMatchObject({ width: 64, height: 64, nb_read_frames: '2' });
      expectColor(centerPixel(slowPassOutput, 0), GREEN, 6);
    });

    it('fails the render if an error occurs on a recycled tab', async () => {
      const output = join(OUT, 'async-error.mp4');
      const { code, stderr } = await run(
        ['render', 'AsyncError', '--entry', 'src/broken.tsx', '--concurrency', '1', '--recycle-tabs', '2', '-o', output],
        FIXTURE,
      );
      expect(code).toBe(1);
      expect(stderr).toContain('error on old tab');
    });
  });

  describe('--progress json', () => {
    it('outputs strictly machine-parseable JSON lines to stdout with phase: done as the last line', async () => {
      const output = join(OUT, 'progress-colors.mp4');
      const { code, stdout, stderr } = await run(['render', 'Colors', '-o', output, '--progress', 'json', '--no-build-cache'], FIXTURE);
      expect(code).toBe(0);

      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(3);

      const events = lines.map((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
        return JSON.parse(line);
      });

      expect(events[0]).toEqual({ phase: 'bundle', status: 'start' });
      expect(events[1]).toEqual({ phase: 'bundle', status: 'done' });

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toMatchObject({
        phase: 'done',
        id: 'Colors',
        output,
        frames: 10,
      });
      expect(typeof lastEvent.seconds).toBe('number');

      // Human logs went to stderr, leaving stdout clean
      expect(stderr).toContain('Bundling compositions…');
      expect(stderr).toContain('Colors · 10 frames');
    });

    it('emits an error event on stdout and exits with code 1 for broken compositions', async () => {
      const { code, stdout, stderr } = await run(['render', 'Throws', '--entry', 'src/broken.tsx', '--frame', '0', '--progress', 'json'], FIXTURE);
      expect(code).toBe(1);

      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(1);

      const events = lines.map(line => JSON.parse(line));
      const lastEvent = events[events.length - 1];
      expect(lastEvent).toMatchObject({
        phase: 'error',
        message: expect.stringContaining('kaboom'),
      });

      expect(stderr).toContain('kaboom');
    });
  });
});
