import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';


/** Root of the installed package (this file lives in `dist/node/` or `src/node/`). */
export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const DIST = join(PACKAGE_ROOT, 'dist');

/** What `import 'freemotion'` resolves to inside a project, so the studio and the project share one runtime. */
export const RUNTIME_ENTRY = join(DIST, 'index.js');
export const STUDIO_ENTRY = join(DIST, 'studio', 'main.js');
export const RENDER_ENTRY = join(DIST, 'studio', 'render-page.js');
export const TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates');

export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string };
  return manifest.version;
}
