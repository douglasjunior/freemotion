import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { version as viteVersion, type Plugin } from 'vite';

import { packageVersion } from './paths.js';


export type CacheFs = {
  stat(path: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean }>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  existsSync(path: string): boolean;
};

export const defaultFs: CacheFs = {
  stat,
  readFile,
  writeFile,
  mkdir: async (p, opts) => {
    await mkdir(p, opts);
  },
  rename,
  rm,
  existsSync,
};

export function bundleCacheKey(root: string, entry: string): string {
  return createHash('sha256').update(`${resolve(root)}:${resolve(entry)}`).digest('hex').slice(0, 12);
}

export function resolveCacheBaseDir(root: string, exists: (p: string) => boolean = existsSync): string {
  const nodeModules = join(root, 'node_modules');
  if (exists(nodeModules)) {
    return join(nodeModules, '.cache', 'freemotion');
  }
  return join(tmpdir(), 'freemotion-cache');
}

export function resolveBundleCacheDir(root: string, entry: string, exists: (p: string) => boolean = existsSync): string {
  const base = resolveCacheBaseDir(root, exists);
  return join(base, `bundle-${bundleCacheKey(root, entry)}`);
}

export function resolvePackageLockMtime(
  root: string,
  fs: Pick<CacheFs, 'existsSync'> & { statSync?: (p: string) => { mtimeMs: number } } = { existsSync, statSync },
): number | null {
  const nodeModulesLock = join(root, 'node_modules', '.package-lock.json');
  if (fs.existsSync(nodeModulesLock)) {
    return fs.statSync ? fs.statSync(nodeModulesLock).mtimeMs : statSync(nodeModulesLock).mtimeMs;
  }
  const rootLock = join(root, 'package-lock.json');
  if (fs.existsSync(rootLock)) {
    return fs.statSync ? fs.statSync(rootLock).mtimeMs : statSync(rootLock).mtimeMs;
  }
  return null;
}

export type FileRecord = {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
};

export type BundleMeta = {
  readonly freemotionVersion: string;
  readonly viteVersion: string;
  readonly entry: string;
  readonly configFile: string | false | null;
  readonly packageLockMtime: number | null;
  readonly configFiles: readonly FileRecord[];
  readonly sourceFiles: readonly FileRecord[];
};

export type ValidateCacheOptions = {
  readonly root: string;
  readonly entry: string;
  readonly configFile?: string | false;
  readonly freemotionVersion?: string;
  readonly viteVersion?: string;
};

export async function isBundleCacheValid(
  bundleDir: string,
  options: ValidateCacheOptions,
  fs: CacheFs = defaultFs,
): Promise<boolean> {
  const metaPath = join(bundleDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return false;
  }
  const indexPath = join(bundleDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return false;
  }

  let meta: BundleMeta;
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    meta = JSON.parse(raw) as BundleMeta;
  } catch {
    return false;
  }

  const expectedFreemotionVersion = options.freemotionVersion ?? packageVersion();
  if (meta.freemotionVersion !== expectedFreemotionVersion) {
    return false;
  }

  const expectedViteVersion = options.viteVersion ?? viteVersion;
  if (meta.viteVersion !== expectedViteVersion) {
    return false;
  }

  if (meta.entry !== options.entry) {
    return false;
  }

  const expectedConfigFile = options.configFile === undefined ? null : options.configFile;
  if (meta.configFile !== expectedConfigFile) {
    return false;
  }

  const currentPackageLockMtime = resolvePackageLockMtime(options.root, fs);
  if (meta.packageLockMtime !== currentPackageLockMtime) {
    return false;
  }

  if (!Array.isArray(meta.sourceFiles) || meta.sourceFiles.length === 0) {
    return false;
  }

  for (const file of meta.sourceFiles) {
    if (!fs.existsSync(file.path)) {
      return false;
    }
    try {
      const stats = await fs.stat(file.path);
      if (stats.size !== file.size || stats.mtimeMs !== file.mtimeMs) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (Array.isArray(meta.configFiles)) {
    for (const file of meta.configFiles) {
      if (!fs.existsSync(file.path)) {
        return false;
      }
      try {
        const stats = await fs.stat(file.path);
        if (stats.size !== file.size || stats.mtimeMs !== file.mtimeMs) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }

  return true;
}

export async function createStagingDir(bundleDir: string, fs: CacheFs = defaultFs): Promise<string> {
  const baseDir = dirname(bundleDir);
  await fs.mkdir(baseDir, { recursive: true });
  const staging = join(baseDir, `.staging-${basename(bundleDir)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(staging, { recursive: true });
  return staging;
}

export async function publishBundle(stagingDir: string, bundleDir: string, fs: CacheFs = defaultFs): Promise<void> {
  const baseDir = dirname(bundleDir);
  await fs.mkdir(baseDir, { recursive: true });

  if (!fs.existsSync(bundleDir)) {
    await fs.rename(stagingDir, bundleDir);
    return;
  }

  const backupDir = join(baseDir, `.old-${basename(bundleDir)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.rename(bundleDir, backupDir);
  try {
    await fs.rename(stagingDir, bundleDir);
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  } catch (err) {
    if (!fs.existsSync(bundleDir) && fs.existsSync(backupDir)) {
      await fs.rename(backupDir, bundleDir).catch(() => undefined);
    }
    throw err;
  }
}

export type BundleCachePluginOptions = {
  readonly root: string;
  readonly entry: string;
  readonly configFile?: string | false;
  readonly onMeta?: (meta: BundleMeta) => void;
};

export function bundleCachePlugin(options: BundleCachePluginOptions): Plugin {
  let resolvedConfigFile: string | undefined;
  let resolvedConfigFileDependencies: string[] = [];

  return {
    name: 'freemotion:bundle-cache',
    apply: 'build',
    configResolved(config) {
      resolvedConfigFile = config.configFile;
      resolvedConfigFileDependencies = config.configFileDependencies ?? [];
    },
    async generateBundle(_, bundle) {
      const sourcePaths = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          for (const moduleId of Object.keys(item.modules)) {
            const clean = moduleId.split('?')[0] ?? '';
            if (clean && !clean.startsWith('\0') && !clean.startsWith('virtual:') && isAbsolute(clean)) {
              sourcePaths.add(clean);
            }
          }
        }
      }

      if (isAbsolute(options.entry)) {
        sourcePaths.add(options.entry);
      }

      const sourceFiles: FileRecord[] = [];
      for (const path of sourcePaths) {
        if (existsSync(path)) {
          const stats = statSync(path);
          sourceFiles.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
        }
      }
      sourceFiles.sort((a, b) => a.path.localeCompare(b.path));

      const configPaths = new Set<string>();
      if (resolvedConfigFile && existsSync(resolvedConfigFile)) {
        configPaths.add(resolvedConfigFile);
      }
      for (const dep of resolvedConfigFileDependencies) {
        if (existsSync(dep)) {
          configPaths.add(dep);
        }
      }

      const configFiles: FileRecord[] = [];
      for (const path of configPaths) {
        const stats = statSync(path);
        configFiles.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
      }
      configFiles.sort((a, b) => a.path.localeCompare(b.path));

      const meta: BundleMeta = {
        freemotionVersion: packageVersion(),
        viteVersion,
        entry: options.entry,
        configFile: options.configFile === undefined ? null : options.configFile,
        packageLockMtime: resolvePackageLockMtime(options.root),
        configFiles,
        sourceFiles,
      };

      this.emitFile({
        type: 'asset',
        fileName: 'meta.json',
        source: JSON.stringify(meta, null, 2),
      });

      options.onMeta?.(meta);
    },
  };
}
