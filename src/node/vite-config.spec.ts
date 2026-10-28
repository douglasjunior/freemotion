import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, PluginOption } from 'vite';

import { RUNTIME_ENTRY } from './paths.js';
import { createViteConfig, ENTRY_MODULE, freemotionPlugin, renderHtmlPlugin } from './vite-config.js';


const names = (plugins: PluginOption[] | undefined): string[] =>
  (plugins ?? []).flat(Infinity as 1).flatMap(plugin => (plugin && typeof plugin === 'object' && 'name' in plugin ? [plugin.name] : []));

describe('freemotionPlugin', () => {
  const plugin = freemotionPlugin('/project/src/compositions.tsx');

  it('points the virtual entry at the project file', () => {
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    expect(resolveId(ENTRY_MODULE)).toBe('/project/src/compositions.tsx');
    expect(resolveId('react')).toBeUndefined();
  });

  it('aliases freemotion to the shared runtime and dedupes React', () => {
    const config = (plugin.config as (config: object) => { resolve: { alias: { find: RegExp; replacement: string }[]; dedupe: string[] } })({ root: '/project' });
    expect(config.resolve.alias[0]).toEqual({ find: /^freemotion$/, replacement: RUNTIME_ENTRY });
    expect(config.resolve.dedupe).toEqual(['react', 'react-dom']);
  });
});

describe('renderHtmlPlugin', () => {
  it('emits an index.html for the entry chunk and its styles', () => {
    const emitted: { fileName: string; source: string }[] = [];
    const generateBundle = renderHtmlPlugin().generateBundle as (this: unknown, options: unknown, bundle: object) => void;
    const context = {
      emitFile: (file: { fileName: string; source: string }) => emitted.push(file),
      error: (message: string) => {
        throw new Error(message);
      },
    };
    generateBundle.call(context, {}, {
      'assets/render-page-abc.js': { type: 'chunk', isEntry: true, fileName: 'assets/render-page-abc.js' },
      'assets/vendor-def.js': { type: 'chunk', isEntry: false, fileName: 'assets/vendor-def.js' },
      'assets/style-123.css': { type: 'asset', fileName: 'assets/style-123.css' },
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.fileName).toBe('index.html');
    expect(emitted[0]!.source).toContain('<script type="module" src="/assets/render-page-abc.js"></script>');
    expect(emitted[0]!.source).toContain('<link rel="stylesheet" href="/assets/style-123.css" />');
  });
});

describe('createViteConfig', () => {
  it('adds React and freemotion', async () => {
    const config = await createViteConfig({ root: '/project', entry: '/project/src/compositions.tsx', command: 'serve', configFile: false });
    const plugins = names(config.plugins);
    expect(plugins.some(name => name.startsWith('vite:react'))).toBe(true);
    expect(plugins).toContain('freemotion');
    expect(config.configFile).toBe(false);
  });

  it('merges the project config without adding React twice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'freemotion-vite-'));
    writeFileSync(join(root, 'vite.config.mjs'), `
      export default {
        resolve: { alias: { '@': '/src' } },
        plugins: [{ name: 'vite:react-babel' }, { name: 'custom' }],
      };
    `);
    const config = await createViteConfig({ root, entry: join(root, 'src/compositions.tsx'), command: 'build' });
    const plugins = names(config.plugins);
    expect(plugins.filter(name => name.startsWith('vite:react'))).toEqual(['vite:react-babel']);
    expect(plugins).toEqual(expect.arrayContaining(['custom', 'freemotion']));
    expect(config.resolve?.alias).toMatchObject({ '@': '/src' });
  });

  it('keeps a plugin object shape', () => {
    const plugin: Plugin = freemotionPlugin('/x');
    expect(plugin.enforce).toBe('pre');
  });
});
