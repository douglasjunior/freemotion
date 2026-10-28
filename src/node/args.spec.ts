import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HELP, parseCommand, parseFrames, parseProps } from './args.js';


const context = { cwd: '/project', env: {} };
const parse = (...argv: string[]) => parseCommand(argv, context);

describe('parseCommand', () => {
  it('shows help without a command', () => {
    expect(parse()).toEqual({ name: 'help', topic: 'main' });
    expect(parse('--help')).toEqual({ name: 'help', topic: 'main' });
    expect(parse('help', 'render')).toEqual({ name: 'help', topic: 'render' });
    expect(parse('render', '--help')).toEqual({ name: 'help', topic: 'render' });
  });

  it('shows the version', () => {
    expect(parse('-v')).toEqual({ name: 'version' });
  });

  it('parses init', () => {
    expect(parse('init')).toEqual({ name: 'init', directory: undefined });
    expect(parse('init', 'promo')).toEqual({ name: 'init', directory: 'promo' });
    expect(() => parse('init', 'a', 'b')).toThrow(/single directory/);
  });

  it('parses studio', () => {
    expect(parse('studio', '--port', '4000', '--open', '--no-config')).toEqual({
      name: 'studio',
      options: { root: '/project', entry: undefined, configFile: false, port: 4000, host: undefined, open: true },
    });
    expect(() => parse('studio', '--port', 'abc')).toThrow(/--port/);
  });

  it('parses render with defaults', () => {
    const command = parse('render', 'Intro');
    expect(command).toMatchObject({
      name: 'render',
      quiet: false,
      options: { root: '/project', compositions: ['Intro'], outDir: 'out', scale: 1, ffmpeg: undefined },
    });
    expect(command.name === 'render' && command.options.concurrency).toBeGreaterThanOrEqual(1);
  });

  it('parses every render option', () => {
    const command = parseCommand(
      ['render', 'Intro', '-o', 'intro.gif', '--frames', '10-20', '--every-nth-frame', '2', '--props', '{"title":"Hi"}', '--scale', '2', '--crf', '20', '--concurrency', '3', '--quiet'],
      { cwd: '/project', env: { FREEMOTION_FFMPEG: '/opt/ffmpeg' } },
    );
    expect(command).toMatchObject({
      name: 'render',
      quiet: true,
      options: {
        output: 'intro.gif',
        frames: [10, 20],
        everyNthFrame: 2,
        props: { title: 'Hi' },
        scale: 2,
        crf: 20,
        concurrency: 3,
        ffmpeg: '/opt/ffmpeg',
      },
    });
  });

  it('renders every composition with --all', () => {
    expect(parse('render', '--all')).toMatchObject({ options: { compositions: 'all' } });
  });

  it.each([
    [['render'], /Which composition/],
    [['render', 'A', '--all'], /not both/],
    [['render', 'A', '--format', 'avi'], /--format must be one of/],
    [['render', 'A', '--frame', '1', '--frames', '1-2'], /--frame for a still/],
    [['render', 'A', '--frame=-1'], /--frame must be an integer/],
    [['render', 'A', '--scale', '0'], /--scale must be a positive/],
    [['render', 'A', '--concurrency', '0'], /--concurrency must be an integer of at least 1/],
    [['render', 'A', '--every-nth-frame', '0'], /--every-nth-frame must be an integer of at least 1/],
    [['render', 'A', '--bogus'], /Unknown option/],
    [['publish'], /Unknown command "publish"/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCommand(argv, context)).toThrow(message);
  });

  it('has help for every command', () => {
    expect(Object.keys(HELP)).toEqual(['main', 'init', 'studio', 'render']);
  });
});

describe('parseFrames', () => {
  it('reads ranges and single frames', () => {
    expect(parseFrames('0-89')).toEqual([0, 89]);
    expect(parseFrames('30')).toEqual([30, 30]);
  });

  it('rejects malformed or reversed ranges', () => {
    expect(() => parseFrames('a-b')).toThrow(/look like/);
    expect(() => parseFrames('20-10')).toThrow(/ends before/);
  });
});

describe('parseProps', () => {
  it('reads inline JSON', () => {
    expect(parseProps('{"a":1}', '/')).toEqual({ a: 1 });
  });

  it('reads a JSON file relative to the project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'freemotion-args-'));
    writeFileSync(join(dir, 'props.json'), '{"title":"From file"}');
    expect(parseProps('props.json', dir)).toEqual({ title: 'From file' });
  });

  it('needs a JSON object', () => {
    expect(() => parseProps('{nope', '/')).toThrow(/not valid JSON/);
    expect(() => parseProps('[1]', '/')).toThrow(/ENOENT|JSON object/);
  });
});
