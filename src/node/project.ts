import { existsSync } from 'node:fs';
import { resolve } from 'node:path';


/** Files tried, in order, when `--entry` is not given. */
export const ENTRY_CANDIDATES = [
  'src/compositions.tsx',
  'src/compositions.ts',
  'src/compositions.jsx',
  'src/compositions.js',
  'src/index.tsx',
  'src/index.ts',
];

/** Absolute path of the file that `export default`s the project's compositions. */
export function resolveEntry(root: string, entry?: string): string {
  if (entry) {
    const path = resolve(root, entry);
    if (!existsSync(path)) {
      throw new Error(`Entry file not found: ${path}`);
    }
    return path;
  }
  const found = ENTRY_CANDIDATES.map(candidate => resolve(root, candidate)).find(path => existsSync(path));
  if (!found) {
    throw new Error(`Could not find the compositions entry file. Create ${ENTRY_CANDIDATES[0]} or pass --entry <file>.`);
  }
  return found;
}
