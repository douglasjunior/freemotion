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
      [
        'render', 'Intro',
        '-o', 'intro.gif',
        '--frames', '10-20',
        '--every-nth-frame', '2',
        '--props', '{"title":"Hi"}',
        '--scale', '2',
        '--crf', '20',
        '--concurrency', '3',
        '--video-cache-mb', '1024',
        '--quiet',
        '--image-format', 'jpeg',
        '--jpeg-quality', '85',
        '--no-overwrite',
      ],
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
        videoCacheMb: 1024,
        ffmpeg: '/opt/ffmpeg',
        imageFormat: 'jpeg',
        jpegQuality: 85,
        overwrite: false,
      },
    });
  });

  it('parses encoding flags for mp4, webm and mov', () => {
    expect(parse('render', 'Intro', '--codec', 'h265', '--pixel-format', 'yuv422p')).toMatchObject({
      options: { codec: 'h265', pixelFormat: 'yuv422p' },
    });
    expect(parse('render', 'Intro', '-o', 'out.webm', '--codec', 'vp9', '--pixel-format', 'yuva420p')).toMatchObject({
      options: { codec: 'vp9', pixelFormat: 'yuva420p' },
    });
    expect(parse('render', 'Intro', '-o', 'out.mov', '--codec', 'prores', '--prores-profile', '4444')).toMatchObject({
      options: { codec: 'prores', proresProfile: '4444' },
    });
    expect(parse('render', 'Intro', '-o', 'out.mov', '--codec', 'prores', '--prores-profile', '4444', '--pixel-format', 'yuva444p10le')).toMatchObject({
      options: { codec: 'prores', proresProfile: '4444', pixelFormat: 'yuva444p10le' },
    });
    expect(parse('render', 'Intro', '-o', 'out.mov', '--codec', 'prores', '--prores-profile', 'hq', '--pixel-format', 'yuv422p10le')).toMatchObject({
      options: { codec: 'prores', proresProfile: 'hq', pixelFormat: 'yuv422p10le' },
    });
    expect(parse('render', 'Intro', '-o', 'out.mov', '--codec', 'h264')).toMatchObject({
      options: { codec: 'h264' },
    });
    expect(parse('render', 'Intro', '--overwrite')).toMatchObject({
      options: { overwrite: true },
    });
  });

  it('parses audio flags for mp4, webm and mov', () => {
    expect(parse('render', 'Intro', '--muted')).toMatchObject({
      options: { muted: true },
    });
    expect(parse('render', 'Intro', '--silent-audio')).toMatchObject({
      options: { silentAudio: true },
    });
    expect(parse('render', 'Intro', '--audio-codec', 'aac')).toMatchObject({
      options: { audioCodec: 'aac' },
    });
    expect(parse('render', 'Intro', '-o', 'out.webm', '--audio-codec', 'opus')).toMatchObject({
      options: { audioCodec: 'opus' },
    });
  });

  it('renders every composition with --all', () => {
    expect(parse('render', '--all')).toMatchObject({ options: { compositions: 'all' } });
  });

  it('parses --progress json', () => {
    expect(parse('render', 'Intro', '--progress', 'json')).toMatchObject({
      name: 'render',
      options: { progress: 'json' },
    });
  });

  it('parses --recycle-tabs and --timeout with defaults', () => {
    expect(parse('render', 'Intro')).toMatchObject({
      options: { recycleTabs: 1000, timeout: undefined },
    });
    expect(parse('render', 'Intro', '--recycle-tabs', '0')).toMatchObject({
      options: { recycleTabs: 0 },
    });
    expect(parse('render', 'Intro', '--recycle-tabs', '50')).toMatchObject({
      options: { recycleTabs: 50 },
    });
    expect(parse('render', 'Intro', '--timeout', '5000')).toMatchObject({
      options: { timeout: 5000 },
    });
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
    [['render', 'A', '--video-cache-mb', '0'], /--video-cache-mb must be an integer of at least 1/],
    [['render', 'A', '--video-cache-mb=-5'], /--video-cache-mb must be an integer of at least 1/],
    [['render', 'A', '--video-cache-mb', 'abc'], /--video-cache-mb must be an integer of at least 1/],
    [['render', 'A', '--image-format', 'bmp'], /--image-format must be one of/],
    [['render', 'A', '--jpeg-quality', '0'], /--jpeg-quality must be an integer between 1 and 100/],
    [['render', 'A', '--jpeg-quality', '101'], /--jpeg-quality must be an integer between 1 and 100/],
    [['render', 'A', '--jpeg-quality', 'abc'], /--jpeg-quality must be an integer between 1 and 100/],
    [['render', 'A', '--codec', 'av1'], /--codec must be one of/],
    [['render', 'A', '--codec', 'vp9'], /Format "mp4" does not support codec "vp9"/],
    [['render', 'A', '--codec', 'prores'], /Format "mp4" does not support codec "prores"/],
    [['render', 'A', '-o', 'out.webm', '--codec', 'h264'], /Format "webm" does not support codec "h264"/],
    [['render', 'A', '-o', 'out.mov', '--codec', 'vp9'], /Format "mov" does not support codec "vp9"/],
    [['render', 'A', '-o', 'out.gif', '--codec', 'h264'], /Format "gif" does not support --codec/],
    [['render', 'A', '--frame', '0', '--codec', 'h264'], /Format "png" does not support --codec/],
    [['render', 'A', '-o', 'out.mov', '--crf', '18'], /--crf cannot be used with prores/],
    [['render', 'A', '--codec', 'h264', '--prores-profile', 'hq'], /--prores-profile is only valid with prores codec/],
    [['render', 'A', '-o', 'out.mov', '--prores-profile', 'lossless'], /--prores-profile must be one of/],
    [['render', 'A', '--pixel-format', 'rgb24'], /--pixel-format must be one of/],
    [['render', 'A', '--codec', 'h264', '--pixel-format', 'yuva420p'], /Codec "h264" does not support pixel format "yuva420p"/],
    [['render', 'A', '-o', 'out.webm', '--pixel-format', 'yuv422p'], /Codec "vp9" does not support pixel format "yuv422p"/],
    [['render', 'A', '-o', 'out.mov', '--pixel-format', 'yuv420p'], /Codec "prores" does not support pixel format "yuv420p"/],
    [['render', 'A', '-o', 'out.mov', '--prores-profile', '4444', '--pixel-format', 'yuv422p10le'], /ProRes 4444 profiles need --pixel-format yuva444p10le/],
    [['render', 'A', '-o', 'out.mov', '--prores-profile', 'hq', '--pixel-format', 'yuva444p10le'], /ProRes 4444 profiles need --pixel-format yuva444p10le/],
    [['render', 'A', '-o', 'out.mov', '--pixel-format', 'yuva444p10le'], /ProRes 4444 profiles need --pixel-format yuva444p10le/],
    [['render', 'A', '-o', 'out.gif', '--pixel-format', 'yuv420p'], /Format "gif" does not support --pixel-format/],
    [['render', 'A', '--audio-codec', 'flac'], /--audio-codec must be one of/],
    [['render', 'A', '--audio-codec', 'opus'], /Format "mp4" does not support audio codec "opus"/],
    [['render', 'A', '-o', 'out.mov', '--audio-codec', 'opus'], /Format "mov" does not support audio codec "opus"/],
    [['render', 'A', '-o', 'out.webm', '--audio-codec', 'aac'], /Format "webm" does not support audio codec "aac"/],
    [['render', 'A', '-o', 'out.gif', '--audio-codec', 'aac'], /Format "gif" does not support --audio-codec/],
    [['render', 'A', '--frame', '0', '--audio-codec', 'aac'], /Format "png" does not support --audio-codec/],
    [['render', 'A', '--recycle-tabs=-1'], /--recycle-tabs must be an integer of at least 0/],
    [['render', 'A', '--recycle-tabs', 'abc'], /--recycle-tabs must be an integer of at least 0/],
    [['render', 'A', '--recycle-tabs', '1.5'], /--recycle-tabs must be an integer of at least 0/],
    [['render', 'A', '--timeout', '0'], /--timeout must be an integer of at least 1000/],
    [['render', 'A', '--timeout', '999'], /--timeout must be an integer of at least 1000/],
    [['render', 'A', '--timeout=-10'], /--timeout must be an integer of at least 1000/],
    [['render', 'A', '--timeout', 'abc'], /--timeout must be an integer of at least 1000/],
    [['render', 'A', '--progress', 'invalid'], /--progress must be json/],
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
