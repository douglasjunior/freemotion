import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { centerPixel, FIXTURE, run } from './helpers.js';


const OUT = join(FIXTURE, 'out/cache-test');
const COMPOSITIONS_FILE = join(FIXTURE, 'src/compositions.tsx');
const SVG_FILE = join(FIXTURE, 'public/square.svg');
const VITE_CONFIG_FILE = join(FIXTURE, 'vite.config.ts');
const TMP_CACHE = join(tmpdir(), 'freemotion-cache');
const FIXTURE_CACHE = join(FIXTURE, 'node_modules/.cache/freemotion');

const GREEN = [0, 255, 0];
const RED = [255, 0, 0];

function cleanAllCaches() {
  rmSync(OUT, { recursive: true, force: true });
  rmSync(TMP_CACHE, { recursive: true, force: true });
  rmSync(FIXTURE_CACHE, { recursive: true, force: true });
}

function findBundleDirs(): string[] {
  const dirs: string[] = [];
  for (const base of [TMP_CACHE, FIXTURE_CACHE]) {
    if (existsSync(base)) {
      for (const entry of readdirSync(base)) {
        if (entry.startsWith('bundle-')) {
          dirs.push(join(base, entry));
        }
      }
    }
  }
  return dirs;
}

describe('bundle cache and public serving', () => {
  let originalCompositions: string;
  let originalSvg: string;

  beforeAll(() => {
    originalCompositions = readFileSync(COMPOSITIONS_FILE, 'utf8');
    originalSvg = readFileSync(SVG_FILE, 'utf8');
    cleanAllCaches();
    rmSync(VITE_CONFIG_FILE, { force: true });
  });

  afterAll(() => {
    writeFileSync(COMPOSITIONS_FILE, originalCompositions);
    writeFileSync(SVG_FILE, originalSvg);
    rmSync(VITE_CONFIG_FILE, { force: true });
    cleanAllCaches();
  });

  it('first render bundles compositions, second render uses cached bundle', async () => {
    const out1 = join(OUT, 'first.png');
    const first = await run(['render', 'Colors', '--frame', '0', '-o', out1], FIXTURE);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('Bundling compositions…');

    const out2 = join(OUT, 'second.png');
    const second = await run(['render', 'Colors', '--frame', '0', '-o', out2], FIXTURE);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('Using cached bundle');
    expect(second.stdout).not.toContain('Bundling compositions…');

    expect(centerPixel(out1)).toEqual(centerPixel(out2));
  });

  it('editing a source file forces a new build', async () => {
    writeFileSync(COMPOSITIONS_FILE, originalCompositions + '\n// touch comment\n');

    const out3 = join(OUT, 'third.png');
    const third = await run(['render', 'Colors', '--frame', '0', '-o', out3], FIXTURE);
    expect(third.code).toBe(0);
    expect(third.stdout).toContain('Bundling compositions…');
    expect(third.stdout).not.toContain('Using cached bundle');

    // Restore for subsequent tests
    writeFileSync(COMPOSITIONS_FILE, originalCompositions);
  });

  it('editing vite.config.* invalidates the cache and forces a rebuild', async () => {
    try {
      // 1. Create vite.config.ts
      writeFileSync(VITE_CONFIG_FILE, 'export default {};\n');

      const outCfg1 = join(OUT, 'config1.png');
      const res1 = await run(['render', 'Colors', '--frame', '0', '-o', outCfg1], FIXTURE);
      expect(res1.code).toBe(0);
      expect(res1.stdout).toContain('Bundling compositions…');

      // 2. Next render reuses cache
      const outCfg2 = join(OUT, 'config2.png');
      const res2 = await run(['render', 'Colors', '--frame', '0', '-o', outCfg2], FIXTURE);
      expect(res2.code).toBe(0);
      expect(res2.stdout).toContain('Using cached bundle');

      // 3. Edit vite.config.ts (change content / mtime)
      writeFileSync(VITE_CONFIG_FILE, 'export default { /* updated */ };\n');

      const outCfg3 = join(OUT, 'config3.png');
      const res3 = await run(['render', 'Colors', '--frame', '0', '-o', outCfg3], FIXTURE);
      expect(res3.code).toBe(0);
      expect(res3.stdout).toContain('Bundling compositions…');
      expect(res3.stdout).not.toContain('Using cached bundle');
    } finally {
      rmSync(VITE_CONFIG_FILE, { force: true });
    }
  });

  it('--no-build-cache always builds without using or writing cache', async () => {
    const out4 = join(OUT, 'nocache.png');
    const result = await run(['render', 'Colors', '--no-build-cache', '--frame', '0', '-o', out4], FIXTURE);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Bundling compositions…');
    expect(result.stdout).not.toContain('Using cached bundle');
  });

  it('altering a public/ file does not invalidate the cache and uses the new content', async () => {
    // 1. Initial render of Asset
    const assetOut1 = join(OUT, 'asset1.png');
    const res1 = await run(['render', 'Asset', '--frame', '0', '-o', assetOut1], FIXTURE);
    expect(res1.code).toBe(0);
    expect(centerPixel(assetOut1)).toEqual(GREEN);

    // 2. Second render of Asset uses cached bundle
    const assetOut2 = join(OUT, 'asset2.png');
    const res2 = await run(['render', 'Asset', '--frame', '0', '-o', assetOut2], FIXTURE);
    expect(res2.code).toBe(0);
    expect(res2.stdout).toContain('Using cached bundle');
    expect(centerPixel(assetOut2)).toEqual(GREEN);

    // 3. Alter square.svg in public/ to be red
    const redSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ff0000"/></svg>';
    writeFileSync(SVG_FILE, redSvg);

    // 4. Render Asset again: cache is NOT invalidated, but the rendered pixel is red!
    const assetOut3 = join(OUT, 'asset3.png');
    const res3 = await run(['render', 'Asset', '--frame', '0', '-o', assetOut3], FIXTURE);
    expect(res3.code).toBe(0);
    expect(res3.stdout).toContain('Using cached bundle');
    expect(centerPixel(assetOut3)).toEqual(RED);

    // 5. Verify no files from public/ were copied into the bundle cache dir
    const bundleDirs = findBundleDirs();
    expect(bundleDirs.length).toBeGreaterThan(0);
    for (const dir of bundleDirs) {
      expect(existsSync(join(dir, 'square.svg'))).toBe(false);
    }
  });
});
