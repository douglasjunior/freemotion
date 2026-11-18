import type { Browser } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import { ensureBrowser, launchBrowser } from './browser.js';


function mockBrowser(): Browser {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Browser;
}

describe('launchBrowser', () => {
  it('passes glArgs when gl backend is specified', async () => {
    const launcher = vi.fn().mockResolvedValue(mockBrowser());
    await launchBrowser({ gl: 'swangle', log: vi.fn(), launcher });
    expect(launcher).toHaveBeenCalledWith({
      executablePath: undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
  });

  it('throws the expected error when download is false and browser is missing', async () => {
    const launcher = vi.fn().mockRejectedValue(new Error('Executable doesn\'t exist at /fake/path'));
    const installer = vi.fn();
    await expect(
      launchBrowser({ download: false, log: vi.fn(), launcher, installer }),
    ).rejects.toThrow('O navegador não está instalado. Rode freemotion browser ensure ou passe --browser-executable.');
    expect(installer).not.toHaveBeenCalled();
  });

  it('downloads and retries when browser is missing and download is true', async () => {
    const browser = mockBrowser();
    const launcher = vi.fn()
      .mockRejectedValueOnce(new Error('Executable doesn\'t exist at /fake/path'))
      .mockResolvedValueOnce(browser);
    const installer = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const result = await launchBrowser({ download: true, log, launcher, installer });
    expect(installer).toHaveBeenCalledOnce();
    expect(launcher).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Downloading chromium-headless-shell'));
    expect(result).toBe(browser);
  });
});

describe('ensureBrowser', () => {
  it('closes browser and does not download when already installed', async () => {
    const browser = mockBrowser();
    const launcher = vi.fn().mockResolvedValue(browser);
    const installer = vi.fn();

    const path = await ensureBrowser({ log: vi.fn(), launcher, installer });
    expect(launcher).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(installer).not.toHaveBeenCalled();
    expect(typeof path).toBe('string');
  });

  it('downloads and retries when browser is missing', async () => {
    const browser = mockBrowser();
    const launcher = vi.fn()
      .mockRejectedValueOnce(new Error('Executable doesn\'t exist'))
      .mockResolvedValueOnce(browser);
    const installer = vi.fn().mockResolvedValue(undefined);

    await ensureBrowser({ log: vi.fn(), launcher, installer });
    expect(installer).toHaveBeenCalledTimes(1);
    expect(launcher).toHaveBeenCalledTimes(2);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('fails without downloading when executablePath is provided and nonexistent', async () => {
    const launcher = vi.fn().mockRejectedValue(new Error('Executable doesn\'t exist at /custom/bin'));
    const installer = vi.fn();

    await expect(
      ensureBrowser({ executablePath: '/custom/bin', log: vi.fn(), launcher, installer }),
    ).rejects.toThrow('Executable doesn\'t exist at /custom/bin');
    expect(installer).not.toHaveBeenCalled();
  });
});
