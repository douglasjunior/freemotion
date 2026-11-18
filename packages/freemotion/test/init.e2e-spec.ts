import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { probe, REPO, run } from './helpers.js';


// Inside the repository, so the new project resolves react and the template's font from its node_modules.
const WORKSPACE = join(REPO, 'test/.tmp');
const PROJECT = join(WORKSPACE, 'init-e2e');

describe('freemotion init', () => {
  beforeAll(() => {
    rmSync(PROJECT, { recursive: true, force: true });
    mkdirSync(WORKSPACE, { recursive: true });
  });
  afterAll(() => rmSync(PROJECT, { recursive: true, force: true }));

  it('creates a project that renders out of the box', async () => {
    const created = await run(['init', 'init-e2e'], WORKSPACE);
    expect(created.code).toBe(0);
    expect(created.stdout).toContain('Next steps');
    expect(existsSync(join(PROJECT, 'src/compositions.tsx'))).toBe(true);

    const rendered = await run(['render', '--all', '--format', 'png', '--frame', '60'], PROJECT);
    expect(rendered.code).toBe(0);
    expect(probe(join(PROJECT, 'out/HelloWorld.png'))).toMatchObject({ width: 1920, height: 1080 });
    expect(probe(join(PROJECT, 'out/Story.png'))).toMatchObject({ width: 1280, height: 720 });
  });

  it('builds the scroll-driven page', () => {
    // What `npm install` would do: put the package in the project's node_modules.
    mkdirSync(join(PROJECT, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(PROJECT, 'node_modules/freemotion'), 'dir');
    execFileSync(process.execPath, [join(REPO, 'node_modules/vite/bin/vite.js'), 'build', 'page', '--logLevel', 'error'], { cwd: PROJECT });
    expect(existsSync(join(PROJECT, 'page/dist/index.html'))).toBe(true);
    expect(readdirSync(join(PROJECT, 'page/dist/assets')).some(file => file.endsWith('.js'))).toBe(true);
  });

  it('refuses to overwrite a project', async () => {
    const { code, stderr } = await run(['init', 'init-e2e'], WORKSPACE);
    expect(code).toBe(1);
    expect(stderr).toContain('not empty');
  });
});
