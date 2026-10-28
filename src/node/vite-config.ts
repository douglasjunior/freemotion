import react from '@vitejs/plugin-react';
import {
  loadConfigFromFile,
  mergeConfig,
  normalizePath,
  searchForWorkspaceRoot,
  type InlineConfig,
  type Plugin,
  type PluginOption,
} from 'vite';

import { PACKAGE_ROOT, RUNTIME_ENTRY, STUDIO_ENTRY } from './paths.js';


export const ENTRY_MODULE = 'virtual:freemotion/entry';

const fsUrl = (path: string) => `/@fs/${normalizePath(path).replace(/^\//, '')}`;

const page = (title: string, head: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>${title}</title>
    ${head}
  </head>
  <body style="margin: 0">
    <div id="root"></div>
    ${body}
  </body>
</html>
`;

/**
 * Wires a project into freemotion: `virtual:freemotion/entry` points at the project's entry file,
 * `freemotion` resolves to the same runtime the studio uses (one React context, one render-hold
 * registry), and the dev server answers `/` with the studio.
 */
export function freemotionPlugin(entry: string): Plugin {
  return {
    name: 'freemotion',
    enforce: 'pre',
    config(config) {
      const root = config.root ?? process.cwd();
      return {
        resolve: {
          alias: [{ find: /^freemotion$/, replacement: RUNTIME_ENTRY }],
          dedupe: ['react', 'react-dom'],
        },
        optimizeDeps: {
          entries: [entry],
          include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'],
          exclude: ['freemotion'],
        },
        server: {
          fs: { allow: [searchForWorkspaceRoot(root), PACKAGE_ROOT] },
        },
      };
    },
    resolveId(id) {
      return id === ENTRY_MODULE ? entry : undefined;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (req.method !== 'GET' || (path !== '/' && path !== '/index.html')) {
          next();
          return;
        }
        try {
          const html = page('freemotion studio', '', `<script type="module" src="${fsUrl(STUDIO_ENTRY)}"></script>`);
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml(req.url!, html));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

/** Emits `index.html` for the render build, pointing at the entry chunk and every stylesheet. */
export function renderHtmlPlugin(): Plugin {
  return {
    name: 'freemotion:render-html',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.values(bundle);
      const entry = files.find(file => file.type === 'chunk' && file.isEntry);
      if (!entry) {
        this.error('freemotion: the render build produced no entry chunk.');
      }
      const styles = files
        .filter(file => file.fileName.endsWith('.css'))
        .map(file => `<link rel="stylesheet" href="/${file.fileName}" />`)
        .join('\n    ');
      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: page('freemotion render', styles, `<script type="module" src="/${entry.fileName}"></script>`),
      });
    },
  };
}

function pluginNames(plugins: readonly PluginOption[] | undefined): string[] {
  return (plugins ?? []).flatMap((plugin): string[] => {
    if (Array.isArray(plugin)) {
      return pluginNames(plugin);
    }
    return plugin && typeof plugin === 'object' && 'name' in plugin ? [plugin.name] : [];
  });
}

export type ViteConfigOptions = {
  readonly root: string;
  readonly entry: string;
  readonly command: 'serve' | 'build';
  /** A Vite config file to merge, `false` to ignore it. Default: the project's `vite.config.*`, if any. */
  readonly configFile?: string | false;
};

/**
 * The Vite config for a project: its own `vite.config.*` (for aliases, CSS tooling, extra plugins),
 * plus React and the freemotion plugin. React is only added when the project didn't add it.
 */
export async function createViteConfig({ root, entry, command, configFile }: ViteConfigOptions): Promise<InlineConfig> {
  const loaded = configFile === false
    ? null
    : await loadConfigFromFile({ command, mode: command === 'build' ? 'production' : 'development' }, configFile, root, 'silent');
  const user = loaded?.config ?? {};
  const hasReact = pluginNames(user.plugins).some(name => name.startsWith('vite:react'));
  return mergeConfig(user, {
    root,
    configFile: false,
    clearScreen: false,
    plugins: [...(hasReact ? [] : [react()]), freemotionPlugin(entry)],
  } satisfies InlineConfig);
}
