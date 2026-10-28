import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { centerPixel, expectColor, FIXTURE, hasEncoder, probe, run } from './helpers.js';


const OUT = join(FIXTURE, 'out');
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 255, 0];

describe('freemotion render', () => {
  beforeAll(() => rmSync(OUT, { recursive: true, force: true }));
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));

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

  it('renders every composition with --all', async () => {
    const outDir = join(OUT, 'all');
    expect((await run(['render', '--all', '--format', 'png', '--out-dir', outDir], FIXTURE)).code).toBe(0);
    for (const id of ['Colors', 'Props', 'Held', 'Asset']) {
      expect(existsSync(join(outDir, `${id}.png`))).toBe(true);
    }
  });

  describe('errors', () => {
    it('lists the compositions when the id is unknown', async () => {
      const { code, stderr } = await run(['render', 'Nope'], FIXTURE);
      expect(code).toBe(1);
      expect(stderr).toContain('Unknown composition: Nope. Available: Colors, Props, Held, Asset.');
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
  });
});
