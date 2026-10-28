import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectPackageManager, init, packageName } from './init.js';
import { packageVersion } from './paths.js';


describe('init', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'freemotion-init-'));
  });

  it('copies the template and fills in the package.json', async () => {
    const { path, name } = await init({ cwd, directory: 'My Promo' });
    expect(name).toBe('my-promo');
    expect(existsSync(join(path, 'src/compositions.tsx'))).toBe(true);
    expect(existsSync(join(path, '.gitignore'))).toBe(true);
    expect(existsSync(join(path, '_gitignore'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('my-promo');
    expect(manifest.dependencies.freemotion).toBe(`^${packageVersion()}`);
  });

  it('accepts an empty folder', async () => {
    mkdirSync(join(cwd, 'empty'));
    await expect(init({ cwd, directory: 'empty' })).resolves.toMatchObject({ name: 'empty' });
  });

  it('refuses a folder with files', async () => {
    mkdirSync(join(cwd, 'busy'));
    writeFileSync(join(cwd, 'busy', 'notes.txt'), '');
    await expect(init({ cwd, directory: 'busy' })).rejects.toThrow(/not empty/);
  });

  it('refuses unknown templates', async () => {
    await expect(init({ cwd, template: 'nope' })).rejects.toThrow(/Unknown template/);
  });
});

describe('packageName', () => {
  it('turns a folder name into a valid npm name', () => {
    expect(packageName('/a/My Video!')).toBe('my-video');
    expect(packageName('/a/___')).toBe('my-video');
    expect(packageName('product-launch_2026')).toBe('product-launch_2026');
  });
});

describe('detectPackageManager', () => {
  it('reads npm_config_user_agent', () => {
    expect(detectPackageManager('yarn/4.18.1 npm/? node/v24.0.0')).toBe('yarn');
    expect(detectPackageManager('pnpm/10.0.0 npm/? node/v24.0.0')).toBe('pnpm');
    expect(detectPackageManager('bun/1.2.0')).toBe('bun');
    expect(detectPackageManager('npm/11.0.0 node/v24.0.0')).toBe('npm');
    expect(detectPackageManager('')).toBe('npm');
  });
});
