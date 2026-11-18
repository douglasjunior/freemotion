import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { FIXTURE, probe, run } from './helpers.js';


const OUT = join(FIXTURE, 'out');

describe('freemotion browser and flags', () => {
  beforeAll(() => rmSync(OUT, { recursive: true, force: true }));
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));

  it('browser ensure prints the ready path and exits with 0', async () => {
    const { code, stdout } = await run(['browser', 'ensure'], FIXTURE);
    expect(code).toBe(0);
    const match = stdout.match(/freemotion: browser ready at (.+)/);
    expect(match).not.toBeNull();
    const binaryPath = match![1]!.trim();
    expect(existsSync(binaryPath)).toBe(true);
  });

  it('fails fast when browser ensure is given a nonexistent executable', async () => {
    const { code, stderr } = await run(['browser', 'ensure', '--browser-executable', '/nonexistent/browser'], FIXTURE);
    expect(code).toBe(1);
    expect(stderr).toContain('doesn\'t exist');
  });

  it('fails fast with --no-download when browser is missing from cache', async () => {
    const { code, stderr } = await run(
      ['render', 'Colors', '--no-download'],
      FIXTURE,
      { PLAYWRIGHT_BROWSERS_PATH: '/tmp/nonexistent-playwright-browsers' },
    );
    expect(code).toBe(1);
    expect(stderr).toContain('Browser is not installed. Run freemotion browser ensure or pass --browser-executable.');
  });

  it('fails fast with --no-download when custom browser-executable is nonexistent', async () => {
    const { code, stderr } = await run(
      ['render', 'Colors', '--browser-executable', '/nonexistent/browser', '--no-download'],
      FIXTURE,
    );
    expect(code).toBe(1);
    expect(stderr).toContain('doesn\'t exist');
  });

  it('renders successfully with --gl swangle', async () => {
    const output = join(OUT, 'swangle.png');
    const { code, stdout } = await run(['render', 'Colors', '--gl', 'swangle', '--frame', '0', '-o', output], FIXTURE);
    expect(code).toBe(0);
    expect(stdout).toContain('Colors · 1 frame');
    expect(existsSync(output)).toBe(true);
    expect(probe(output)).toMatchObject({ width: 64, height: 64 });
  });
});
