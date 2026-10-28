import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';


const BROWSER = 'chromium-headless-shell';

function installHeadlessShell(): Promise<void> {
  const cli = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', BROWSER], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`Installing ${BROWSER} failed (exit code ${code}).`))));
  });
}

/**
 * Launches headless Chromium. On the first run the browser is not there yet: it is downloaded once
 * (to the shared Playwright cache) and the launch is retried.
 */
export async function launchBrowser({ executablePath, log }: {
  readonly executablePath?: string;
  readonly log: (message: string) => void;
}): Promise<Browser> {
  try {
    return await chromium.launch({ executablePath });
  } catch (error) {
    const missing = error instanceof Error && /Executable doesn't exist|playwright install/i.test(error.message);
    if (executablePath || !missing) {
      throw error;
    }
    log(`Downloading ${BROWSER} for rendering (first run only)…`);
    await installHeadlessShell();
    return chromium.launch();
  }
}
