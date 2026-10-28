import { createServer, mergeConfig, type InlineConfig, type ViteDevServer } from 'vite';

import type { Logger } from './logger.js';
import { resolveEntry } from './project.js';
import { createViteConfig } from './vite-config.js';


export type StudioOptions = {
  readonly root: string;
  readonly entry?: string;
  readonly configFile?: string | false;
  readonly port?: number;
  readonly host?: string | boolean;
  readonly open?: boolean;
  readonly log: Logger;
};

/** Starts the studio: a Vite dev server whose `/` is the preview app, with hot reload. */
export async function startStudio({ root, entry, configFile, port = 3000, host, open = false, log }: StudioOptions): Promise<ViteDevServer> {
  const base = await createViteConfig({ root, entry: resolveEntry(root, entry), command: 'serve', configFile });
  const server = await createServer(mergeConfig(base, {
    server: { port, host, open, strictPort: false },
  } satisfies InlineConfig));
  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? `http://localhost:${port}/`;
  log.info(`\n  freemotion studio running at ${url}\n`);
  return server;
}
