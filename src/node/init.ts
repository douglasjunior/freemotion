import { existsSync } from 'node:fs';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { packageVersion, TEMPLATES_DIR } from './paths.js';


export type InitOptions = {
  readonly cwd: string;
  readonly directory?: string;
  readonly template?: string;
};

export type InitResult = {
  readonly path: string;
  readonly name: string;
};

/** A valid npm package name derived from a folder name. */
export function packageName(directory: string): string {
  const name = basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^[._-]+|-+$/g, '');
  return name || 'my-video';
}

/** The package manager that launched us (`npx`, `yarn dlx`, `pnpm dlx`, `bunx`), for the next-steps hint. */
export function detectPackageManager(userAgent = process.env.npm_config_user_agent ?? ''): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  const name = userAgent.split('/')[0];
  return name === 'yarn' || name === 'pnpm' || name === 'bun' ? name : 'npm';
}

/** Copies a project template into a new (or empty) folder. */
export async function init({ cwd, directory = 'my-video', template = 'default' }: InitOptions): Promise<InitResult> {
  const source = join(TEMPLATES_DIR, template);
  if (!existsSync(source)) {
    throw new Error(`Unknown template "${template}".`);
  }
  const path = resolve(cwd, directory);
  if (existsSync(path) && (await readdir(path)).length > 0) {
    throw new Error(`${path} already exists and is not empty.`);
  }
  await cp(source, path, { recursive: true });
  // npm drops .gitignore files from published packages, so the template ships it renamed.
  if (existsSync(join(path, '_gitignore'))) {
    await rename(join(path, '_gitignore'), join(path, '.gitignore'));
  }
  const name = packageName(path);
  const manifestPath = join(path, 'package.json');
  const manifest = (await readFile(manifestPath, 'utf8'))
    .replaceAll('{{name}}', name)
    .replaceAll('{{version}}', packageVersion());
  await writeFile(manifestPath, manifest);
  return { path, name };
}
