import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';

import { CLI, FIXTURE } from './helpers.js';


function startStudio(): Promise<{ child: ChildProcess; url: string }> {
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
    expect(await select.locator('option').allTextContents()).toEqual(['Colors', 'Props', 'Held', 'Asset']);
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

  it('runs without page errors', () => {
    expect(errors).toEqual([]);
  });
});
