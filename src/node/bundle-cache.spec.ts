import { join } from 'node:path';

import {
  bundleCacheKey,
  createStagingDir,
  isBundleCacheValid,
  publishBundle,
  resolveBundleCacheDir,
  resolveCacheBaseDir,
  type BundleMeta,
  type CacheFs,
} from './bundle-cache.js';


function createMockFs(initialFiles: Record<string, string | { size: number; mtimeMs: number; content?: string }>): CacheFs {
  const store = new Map<string, { size: number; mtimeMs: number; content: string }>();

  for (const [filePath, data] of Object.entries(initialFiles)) {
    if (typeof data === 'string') {
      store.set(filePath, { size: Buffer.byteLength(data), mtimeMs: 1000, content: data });
    } else {
      store.set(filePath, {
        size: data.size,
        mtimeMs: data.mtimeMs,
        content: data.content ?? '',
      });
    }
  }

  return {
    async stat(path: string) {
      const entry = store.get(path);
      if (!entry) {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
      return {
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        isFile: () => true,
        isDirectory: () => false,
      };
    },
    async readFile(path: string) {
      const entry = store.get(path);
      if (!entry) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return entry.content;
    },
    async writeFile(path: string, content: string) {
      store.set(path, { size: Buffer.byteLength(content), mtimeMs: 1000, content });
    },
    async mkdir() {
      return undefined;
    },
    async rename(oldPath: string, newPath: string) {
      // In memory rename
      const keysToMove: [string, { size: number; mtimeMs: number; content: string }][] = [];
      for (const [key, val] of store.entries()) {
        if (key === oldPath || key.startsWith(oldPath + '/')) {
          const suffix = key.slice(oldPath.length);
          keysToMove.push([newPath + suffix, val]);
          store.delete(key);
        }
      }
      for (const [newKey, val] of keysToMove) {
        store.set(newKey, val);
      }
    },
    async rm(path: string) {
      for (const key of Array.from(store.keys())) {
        if (key === path || key.startsWith(path + '/')) {
          store.delete(key);
        }
      }
    },
    existsSync(path: string) {
      for (const key of store.keys()) {
        if (key === path || key.startsWith(path + '/')) {
          return true;
        }
      }
      return false;
    },
  };
}

describe('bundle-cache', () => {
  const root = '/project';
  const entry = '/project/src/compositions.tsx';
  const bundleDir = '/project/node_modules/.cache/freemotion/bundle-123';

  const baseMeta: BundleMeta = {
    freemotionVersion: '0.1.1',
    viteVersion: '8.3.5',
    entry,
    configFile: null,
    packageLockMtime: null,
    configFiles: [],
    sourceFiles: [
      { path: entry, size: 100, mtimeMs: 2000 },
      { path: '/project/src/App.tsx', size: 50, mtimeMs: 2000 },
    ],
  };

  const validOptions = {
    root,
    entry,
    configFile: undefined,
    freemotionVersion: '0.1.1',
    viteVersion: '8.3.5',
  };

  describe('isBundleCacheValid', () => {
    it('returns true on valid meta and matching files (cache hit)', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2000 },
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
      });

      const valid = await isBundleCacheValid(bundleDir, validOptions, fs);
      expect(valid).toBe(true);
    });

    it('returns false when meta.json does not exist', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'index.html')]: '<html></html>',
      });
      const valid = await isBundleCacheValid(bundleDir, validOptions, fs);
      expect(valid).toBe(false);
    });

    it('returns false when index.html is missing in cache', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
      });
      const valid = await isBundleCacheValid(bundleDir, validOptions, fs);
      expect(valid).toBe(false);
    });

    it('returns false when source file mtime changed', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2500 }, // mtime changed
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
      });
      const valid = await isBundleCacheValid(bundleDir, validOptions, fs);
      expect(valid).toBe(false);
    });

    it('returns false when source file size changed', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 120, mtimeMs: 2000 }, // size changed
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
      });
      const valid = await isBundleCacheValid(bundleDir, validOptions, fs);
      expect(valid).toBe(false);
    });

    it('returns false when a source file is removed/missing', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2000 },
        // App.tsx is missing
      });
      const valid = await isBundleCacheValid(bundleDir, validOptions, fs);
      expect(valid).toBe(false);
    });

    it('returns false when freemotion version changes', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2000 },
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
      });
      const valid = await isBundleCacheValid(bundleDir, { ...validOptions, freemotionVersion: '0.2.0' }, fs);
      expect(valid).toBe(false);
    });

    it('returns false when vite version changes', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2000 },
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
      });
      const valid = await isBundleCacheValid(bundleDir, { ...validOptions, viteVersion: '9.0.0' }, fs);
      expect(valid).toBe(false);
    });

    it('returns false when entry changes', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2000 },
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
      });
      const valid = await isBundleCacheValid(bundleDir, { ...validOptions, entry: '/project/src/other.tsx' }, fs);
      expect(valid).toBe(false);
    });

    it('returns false when configFile flag changes', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(baseMeta),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2000 },
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
      });
      const valid = await isBundleCacheValid(bundleDir, { ...validOptions, configFile: false }, fs);
      expect(valid).toBe(false);
    });

    it('returns false when config dependency changes', async () => {
      const metaWithConfig: BundleMeta = {
        ...baseMeta,
        configFile: '/project/vite.config.ts',
        configFiles: [{ path: '/project/vite.config.ts', size: 200, mtimeMs: 3000 }],
      };
      const fs = createMockFs({
        [join(bundleDir, 'meta.json')]: JSON.stringify(metaWithConfig),
        [join(bundleDir, 'index.html')]: '<html></html>',
        [entry]: { size: 100, mtimeMs: 2000 },
        ['/project/src/App.tsx']: { size: 50, mtimeMs: 2000 },
        ['/project/vite.config.ts']: { size: 200, mtimeMs: 3500 }, // mtime changed
      });
      const valid = await isBundleCacheValid(bundleDir, { ...validOptions, configFile: '/project/vite.config.ts' }, fs);
      expect(valid).toBe(false);
    });
  });

  describe('atomic publication', () => {
    it('publishes staging directory atomically to bundleDir', async () => {
      const fs = createMockFs({
        ['/project/.staging-bundle/index.html']: '<html>staged</html>',
        ['/project/.staging-bundle/meta.json']: '{"ok":true}',
      });

      await publishBundle('/project/.staging-bundle', bundleDir, fs);

      expect(fs.existsSync(bundleDir)).toBe(true);
      expect(fs.existsSync(join(bundleDir, 'index.html'))).toBe(true);
      expect(fs.existsSync('/project/.staging-bundle')).toBe(false);
    });

    it('replaces existing bundleDir atomically', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'index.html')]: '<html>old</html>',
        ['/project/.staging-bundle/index.html']: '<html>new</html>',
      });

      await publishBundle('/project/.staging-bundle', bundleDir, fs);

      expect(fs.existsSync(bundleDir)).toBe(true);
      expect(await fs.readFile(join(bundleDir, 'index.html'), 'utf8')).toBe('<html>new</html>');
      expect(fs.existsSync('/project/.staging-bundle')).toBe(false);
    });

    it('an interrupted build does not leave invalid cache in bundleDir', async () => {
      const fs = createMockFs({
        [join(bundleDir, 'index.html')]: '<html>previous-good</html>',
      });

      // Simulation: create staging dir, throw error before publishing
      const staging = await createStagingDir(bundleDir, fs);
      await fs.writeFile(join(staging, 'incomplete.js'), 'bad');

      // Build failed, remove staging dir
      await fs.rm(staging, { recursive: true, force: true });

      // bundleDir is still intact with the previous good content
      expect(fs.existsSync(bundleDir)).toBe(true);
      expect(await fs.readFile(join(bundleDir, 'index.html'), 'utf8')).toBe('<html>previous-good</html>');
      expect(fs.existsSync(staging)).toBe(false);
    });
  });

  describe('directory and key resolution', () => {
    it('computes deterministic cache key for root and entry', () => {
      const key1 = bundleCacheKey('/root', '/root/src/compositions.tsx');
      const key2 = bundleCacheKey('/root', '/root/src/compositions.tsx');
      const key3 = bundleCacheKey('/root', '/root/src/other.tsx');

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toHaveLength(12);
    });

    it('resolves cache dir in node_modules/.cache when node_modules exists', () => {
      const base = resolveCacheBaseDir('/proj', p => p === '/proj/node_modules');
      expect(base).toBe('/proj/node_modules/.cache/freemotion');
      const dir = resolveBundleCacheDir('/proj', '/proj/src/comp.tsx', p => p === '/proj/node_modules');
      expect(dir).toContain('/proj/node_modules/.cache/freemotion/bundle-');
    });

    it('falls back to tmpdir when node_modules does not exist', () => {
      const dir = resolveBundleCacheDir('/proj', '/proj/src/comp.tsx', () => false);
      expect(dir).toContain('freemotion-cache/bundle-');
      expect(dir).not.toContain('node_modules');
    });
  });
});
