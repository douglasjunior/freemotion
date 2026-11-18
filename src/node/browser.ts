import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

import { glArgs, type GlBackend } from './gl.js';


export const BROWSER = 'chromium-headless-shell';

export function installHeadlessShell(): Promise<void> {
  const cli = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', BROWSER], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`Installing ${BROWSER} failed (exit code ${code}).`))));
  });
}

export type BrowserLauncher = (options?: LaunchOptions) => Promise<Browser>;
export type BrowserInstaller = () => Promise<void>;

const defaultLauncher: BrowserLauncher = options => chromium.launch(options);

/**
 * Launches headless Chromium. On the first run the browser is not there yet: it is downloaded once
 * (to the shared Playwright cache) and the launch is retried.
 */
export async function launchBrowser({
  executablePath,
  gl,
  download = true,
  log,
  launcher = defaultLauncher,
  installer = installHeadlessShell,
}: {
  readonly executablePath?: string;
  readonly gl?: GlBackend;
  readonly download?: boolean;
  readonly log: (message: string) => void;
  readonly launcher?: BrowserLauncher;
  readonly installer?: BrowserInstaller;
}): Promise<Browser> {
  const args = gl ? glArgs(gl) : undefined;
  try {
    return await launcher({ executablePath, args });
  } catch (error) {
    const missing = error instanceof Error && /Executable doesn't exist|playwright install/i.test(error.message);
    if (executablePath || !missing) {
      throw error;
    }
    if (!download) {
      throw new Error('O navegador não está instalado. Rode freemotion browser ensure ou passe --browser-executable.');
    }
    log(`Downloading ${BROWSER} for rendering (first run only)…`);
    await installer();
    return launcher({ args });
  }
}

/**
 * Verifies that the headless Chromium browser is installed and can launch.
 * If missing and no custom executable is specified, it installs it.
 * Prints the resolved path to stdout.
 */
export async function ensureBrowser({
  executablePath,
  log,
  launcher = defaultLauncher,
  installer = installHeadlessShell,
}: {
  readonly executablePath?: string;
  readonly log?: (message: string) => void;
  readonly launcher?: BrowserLauncher;
  readonly installer?: BrowserInstaller;
}): Promise<string> {
  let browser: Browser | null = null;
  try {
    browser = await launcher({ executablePath });
  } catch (error) {
    const missing = error instanceof Error && /Executable doesn't exist|playwright install/i.test(error.message);
    if (executablePath || !missing) {
      throw error;
    }
    log?.(`Downloading ${BROWSER}…`);
    await installer();
    browser = await launcher();
  } finally {
    await browser?.close();
  }
  const resolvedPath = executablePath ?? chromium.executablePath();
  console.log(`freemotion: browser ready at ${resolvedPath}`);
  return resolvedPath;
}
