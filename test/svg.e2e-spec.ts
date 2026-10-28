import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

import { centerPixel, FIXTURE, run } from './helpers.js';


const OUT = join(FIXTURE, 'out-svg');
const FPS = 30;
const BLACK = [0, 0, 0];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];

// The files are checked in a real browser: inline, with the animations frozen at a given frame, and
// as an <img>, the way a README shows them.
describe('freemotion render (animated SVG)', () => {
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];

  beforeAll(async () => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    page.on('pageerror', error => errors.push(error.message));
  });

  afterAll(async () => {
    await browser?.close();
    rmSync(OUT, { recursive: true, force: true });
  });

  const render = async (args: readonly string[], file: string) => {
    const output = join(OUT, file);
    const result = await run(['render', ...args, '-o', output], FIXTURE);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    return { ...result, svg: readFileSync(output, 'utf8') };
  };

  const parserError = (svg: string) => page.evaluate(
    text => new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror')?.textContent ?? null,
    svg,
  );

  /** Shows the SVG inline and freezes every animation in the middle of `frame`. */
  const showInlineAt = async (svg: string, frame: number) => {
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    await page.evaluate(async (time) => {
      // Showing an element starts the animations inside it, so seek until no new animation appears.
      const seeked = new Set<Animation>();
      for (let pass = 0; pass < 5; pass++) {
        const animations = document.getAnimations().filter(animation => !seeked.has(animation));
        if (animations.length === 0) {
          break;
        }
        for (const animation of animations) {
          animation.pause();
          // currentTime counts from the (negative) delay; the active time is what the keyframes see.
          animation.currentTime = time + Number(animation.effect!.getTiming().delay ?? 0);
          seeked.add(animation);
        }
        await Promise.all(animations.map(animation => animation.ready));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    }, ((frame + 0.5) / FPS) * 1000);
  };

  /** Shows the SVG as an <img> and waits for its animation to end. */
  const showAsImage = async (svg: string, settleMs: number) => {
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(`<!doctype html><body style="margin:0"><img src="${src}" width="64" height="64" /></body>`);
    await page.locator('img').evaluate(img => (img as HTMLImageElement).decode());
    await page.waitForTimeout(settleMs);
  };

  const pixel = async (x: number, y: number) => {
    const file = join(OUT, `pixel-${x}-${y}.png`);
    await page.screenshot({ path: file, clip: { x, y, width: 1, height: 1 } });
    return centerPixel(file);
  };

  /** The frame number the label shows, or null while it is unmounted. */
  const visibleLabel = () => page.evaluate(() => {
    const label = document.querySelector('[data-testid="label"]');
    if (!label || getComputedStyle(label).display === 'none') {
      return null;
    }
    return [...label.querySelectorAll('span')].filter(span => getComputedStyle(span).display !== 'none').map(span => span.textContent).join('');
  });

  it('replays inline styles, SVG attributes, mounting and text, frame by frame', async () => {
    const { stdout, svg } = await render(['Motion', '--entry', 'src/motion.tsx'], 'motion.svg');
    expect(stdout).toContain('Motion · 10 frames');
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('@keyframes');
    expect(svg).toContain('step-end infinite');
    expect(svg).toContain('box-sizing: border-box');
    expect(await parserError(svg)).toBeNull();

    await showInlineAt(svg, 2);
    expect(await pixel(32, 24)).toEqual(RED); // the circle (r = 3)
    expect(await pixel(20, 56)).toEqual(GREEN); // the bar, at left 8
    expect(await pixel(40, 56)).toEqual(BLACK);
    expect(await visibleLabel()).toBeNull();

    await showInlineAt(svg, 7);
    expect(await pixel(32, 24)).toEqual(BLUE);
    expect(await pixel(40, 56)).toEqual(GREEN); // the bar, at left 28
    expect(await pixel(20, 56)).toEqual(BLACK);
    expect(await visibleLabel()).toBe('7');
  });

  it('plays as an <img>, once with --no-loop', async () => {
    const { svg } = await render(['Colors', '--no-loop'], 'colors.svg');
    expect(svg).toContain('step-end 1 forwards');
    expect(svg).not.toContain('infinite');
    // 10 frames at 30 fps last 333 ms; after that the last frame (blue) stays.
    await showAsImage(svg, 1000);
    expect(await pixel(32, 32)).toEqual(BLUE);
  });

  it('embeds images so the file stands alone', async () => {
    const { svg } = await render(['Asset'], 'asset.svg');
    expect(svg).toContain('src="data:image/svg+xml;base64,');
    expect(svg).not.toContain('square.svg');
    await showAsImage(svg, 100);
    expect(await pixel(32, 32)).toEqual(GREEN);
  });

  it('renders a still of one frame with --frame', async () => {
    const { stdout, svg } = await render(['Colors', '--frame', '7'], 'still.svg');
    expect(stdout).toContain('Colors · 1 frame');
    expect(svg).not.toContain('@keyframes');
    await showInlineAt(svg, 0);
    expect(await pixel(32, 32)).toEqual(BLUE);
  });

  it('honors --frames and --every-nth-frame', async () => {
    const { stdout, svg } = await render(['Colors', '--frames', '2-9', '--every-nth-frame', '2'], 'range.svg');
    expect(stdout).toContain('Colors · 4 frames');
    // 4 frames at 15 fps: 0.266667 s, red for the first two.
    expect(svg).toContain('0.266667s');
    await showInlineAt(svg, 0);
    expect(await pixel(32, 32)).toEqual(RED);
  });

  it('runs without page errors', () => {
    expect(errors).toEqual([]);
  });
});
