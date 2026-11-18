import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';

import { CLI, FIXTURE } from './helpers.js';


function startStudio(): Promise<{ child: ChildProcess; url: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'studio', '--port', '0', '--no-open'], { cwd: FIXTURE });
    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk;
      const runningMatch = /freemotion studio running at (http:\/\/\S+)/.exec(output);
      const readyMatch = /Studio ready at (http:\/\/\S+)/.exec(output);
      if (runningMatch && readyMatch) {
        resolve({ child, url: runningMatch[1]!, stdout: output });
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk));
    child.on('error', reject);
    child.on('close', code => reject(new Error(`studio exited with code ${code}:\n${output}`)));
  });
}

const stageBackground = (page: Page) =>
  page.locator('[data-freemotion-stage] > div').first().evaluate(el => getComputedStyle(el.firstElementChild ?? el).backgroundColor);

describe('freemotion studio', () => {
  let studio: Awaited<ReturnType<typeof startStudio>>;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];

  beforeAll(async () => {
    studio = await startStudio();
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
  });

  afterAll(async () => {
    await browser?.close();
    studio?.child.kill();
  });

  it('lists every composition, grouped by folder', async () => {
    await page.goto(studio.url);
    const select = page.getByLabel('Composition');
    await select.waitFor();
    expect(await select.locator('option').allTextContents()).toEqual(['Colors', 'Props', 'Held', 'ShotMix', 'Asset']);
    expect(await select.locator('optgroup').getAttribute('label')).toBe('Assets');
  });

  it('draws the frame from the URL', async () => {
    await page.goto(`${studio.url}?composition=Colors&frame=7`);
    await page.locator('[data-freemotion-stage]').waitFor();
    expect(await stageBackground(page)).toBe('rgb(0, 0, 255)');
    expect(await page.getByText('frame 7 / 9').count()).toBe(1);
  });

  it('steps through frames with the keyboard and keeps them in the URL', async () => {
    await page.goto(`${studio.url}?composition=Colors&frame=4`);
    await page.locator('[data-freemotion-stage]').waitFor();
    expect(await stageBackground(page)).toBe('rgb(255, 0, 0)');
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(/frame=5/);
    expect(await stageBackground(page)).toBe('rgb(0, 0, 255)');
  });

  it('switches compositions', async () => {
    await page.getByLabel('Composition').selectOption('Props');
    await page.waitForURL(/composition=Props/);
    expect(await stageBackground(page)).toBe('rgb(255, 0, 0)');
  });

  it('toggles mute with button and m shortcut', async () => {
    await page.goto(`${studio.url}?composition=Colors&frame=0`);
    const muteButton = page.getByRole('button', { name: 'Mute (M)' });
    await muteButton.waitFor();

    // Click button to mute
    await muteButton.click();
    const unmuteButton = page.getByRole('button', { name: 'Unmute (M)' });
    await unmuteButton.waitFor();

    // Press 'm' to unmute
    await page.keyboard.press('m');
    await page.getByRole('button', { name: 'Mute (M)' }).waitFor();
  });

  it('emits the ready signal to stdout on startup', () => {
    expect(studio.stdout).toMatch(/freemotion studio running at http:\/\/\S+/);
    expect(studio.stdout).toMatch(/Studio ready at http:\/\/\S+/);
  });

  it('does not send X-Frame-Options or frame-ancestors headers on GET /', async () => {
    const res = await fetch(studio.url);
    expect(res.headers.get('x-frame-options')).toBeNull();
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).not.toContain('frame-ancestors');
  });

  it('opens at deep link query parameters ?composition=Colors&frame=5', async () => {
    await page.goto(`${studio.url}?composition=Colors&frame=5`);
    await page.locator('[data-freemotion-stage]').waitFor();
    expect(await page.getByText('frame 5 / 9').count()).toBe(1);
    expect(await stageBackground(page)).toBe('rgb(0, 0, 255)');
  });

  it('embeds studio in an iframe from another origin/port and supports shortcuts on hover', async () => {
    const parentServer = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body><input id="outside-input" /><iframe id="studio-frame" src="${studio.url}?composition=Colors&frame=4" width="1000" height="800"></iframe></body></html>`);
    });
    await new Promise<void>(resolve => parentServer.listen(0, resolve));
    const parentPort = (parentServer.address() as AddressInfo).port;
    const parentUrl = `http://localhost:${parentPort}/`;

    try {
      const parentPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await parentPage.goto(parentUrl);

      // Focus an input outside the iframe first to ensure the iframe is not focused initially
      await parentPage.locator('#outside-input').focus();

      const frame = parentPage.frameLocator('#studio-frame');
      const stage = frame.locator('[data-freemotion-stage]');
      await stage.waitFor();

      // Check that frame 4 loaded in iframe
      expect(await frame.getByText('frame 4 / 9').count()).toBe(1);

      // Hover over the iframe stage (without clicking) to trigger pointerenter capture focus
      await stage.hover();
      await parentPage.keyboard.press('ArrowRight');
      await frame.getByText('frame 5 / 9').waitFor();
      expect(await frame.getByText('frame 5 / 9').count()).toBe(1);
      await parentPage.close();
    } finally {
      parentServer.close();
    }
  });

  it('runs without page errors', () => {
    expect(errors).toEqual([]);
  });
});
