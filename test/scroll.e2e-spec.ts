import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';

import { CLI, FIXTURE } from './helpers.js';


function startServer(): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'studio', '--port', '0'], { cwd: FIXTURE });
    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk;
      const match = /running at (http:\/\/\S+)/.exec(output);
      if (match) {
        resolve({ child, url: match[1]! });
      }
    });
    child.on('error', reject);
    child.on('close', code => reject(new Error(`studio exited with code ${code}:\n${output}`)));
  });
}

// The page is served by the studio's Vite server, like any other HTML file of the project.
describe('scroll-driven playback', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];

  const pageFrame = () => page.evaluate(() => Number(document.body.dataset.frame));
  const scrollPageTo = async (y: number) => {
    await page.evaluate(top => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  };

  beforeAll(async () => {
    server = await startServer();
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.url}scroll.html`);
    await page.locator('[data-freemotion-stage]').first().waitFor();
  });

  afterAll(async () => {
    await browser?.close();
    server?.child.kill();
  });

  it('maps the page scroll through a ScrollPlayer section to frames', async () => {
    // Layout: the 200 px box, 600 px of spacer, then the 1800 px section (1200 px of travel).
    const sectionTop = 800;
    await scrollPageTo(0);
    expect(await pageFrame()).toBe(0);
    await scrollPageTo(sectionTop + 600);
    expect(await pageFrame()).toBe(5);
    await scrollPageTo(sectionTop + 1200);
    expect(await pageFrame()).toBe(9);
  });

  it('keeps the player stuck to the viewport while the section scrolls', async () => {
    await scrollPageTo(800 + 600);
    const top = await page.locator('[data-freemotion-stage]').nth(1).evaluate(el => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(600);
  });

  it('follows a scrolling container with the visible range', async () => {
    await scrollPageTo(0);
    const box = page.getByTestId('box');
    // The 200×200 player enters the 200 px box at scrollTop 0 and has left it at scrollTop 400.
    await box.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(150);
    expect(await box.getAttribute('data-frame')).toBe('0');
    await box.evaluate((el) => {
      el.scrollTop = 200;
    });
    await page.waitForTimeout(150);
    expect(await box.getAttribute('data-frame')).toBe('5');
    await box.evaluate((el) => {
      el.scrollTop = 400;
    });
    await page.waitForTimeout(150);
    expect(await box.getAttribute('data-frame')).toBe('9');
  });

  it('runs without page errors', () => {
    expect(errors).toEqual([]);
  });
});
