import { join, resolve } from 'node:path';

import { planJobs, resolveAssetSrc } from './render.js';


const available = ['Intro', 'Outro'];
const base = { compositions: ['Intro'], outDir: 'out' } as const;

describe('planJobs', () => {
  it('writes <out-dir>/<id>.mp4 by default', () => {
    expect(planJobs(base, available)).toEqual([{ id: 'Intro', output: join('out', 'Intro.mp4'), format: 'mp4' }]);
  });

  it('writes a png when a frame is given', () => {
    expect(planJobs({ ...base, frame: 10 }, available)).toEqual([{ id: 'Intro', output: join('out', 'Intro.png'), format: 'png' }]);
  });

  it('takes the format from --output', () => {
    expect(planJobs({ ...base, output: 'promo.gif' }, available)).toEqual([{ id: 'Intro', output: 'promo.gif', format: 'gif' }]);
  });

  it('lets --format win', () => {
    expect(planJobs({ ...base, compositions: 'all', format: 'webm' }, available)).toEqual([
      { id: 'Intro', output: join('out', 'Intro.webm'), format: 'webm' },
      { id: 'Outro', output: join('out', 'Outro.webm'), format: 'webm' },
    ]);
  });

  it('lists the available compositions for unknown ids', () => {
    expect(() => planJobs({ ...base, compositions: ['Nope'] }, available)).toThrow('Unknown composition: Nope. Available: Intro, Outro.');
  });

  it('needs a single composition for --output', () => {
    expect(() => planJobs({ ...base, compositions: 'all', output: 'x.mp4' }, available)).toThrow(/single composition/);
  });

  it('plans a mov file', () => {
    expect(planJobs({ ...base, output: 'x.mov' }, available)).toEqual([{ id: 'Intro', output: 'x.mov', format: 'mov' }]);
  });

  it('needs a known extension', () => {
    expect(() => planJobs({ ...base, output: 'x.avi' }, available)).toThrow(/Can't tell the format/);
  });

  it('fails when there is nothing to render', () => {
    expect(() => planJobs({ ...base, compositions: 'all' }, [])).toThrow(/no compositions/);
  });
});

describe('resolveAssetSrc', () => {
  const publicDir = resolve('/my/project/public');

  it('preserves http and https URLs', () => {
    expect(resolveAssetSrc('http://example.com/audio.mp3', publicDir)).toBe('http://example.com/audio.mp3');
    expect(resolveAssetSrc('https://example.com/audio.wav', publicDir)).toBe('https://example.com/audio.wav');
  });

  it('preserves absolute filesystem paths even if nonexistent', () => {
    expect(resolveAssetSrc('/non/existent/audio.mp3', publicDir)).toBe('/non/existent/audio.mp3');
  });

  it('resolves relative paths against publicDir', () => {
    expect(resolveAssetSrc('clips/tone.wav', publicDir)).toBe(join(publicDir, 'clips/tone.wav'));
    expect(resolveAssetSrc('sound.mp3', publicDir)).toBe(join(publicDir, 'sound.mp3'));
  });

  it('strips leading slashes for web paths and resolves against publicDir', () => {
    // If not absolute (e.g. on Windows where /path without drive is not absolute), or when stripped
    expect(resolveAssetSrc('clips/tone.wav', publicDir)).toBe(join(publicDir, 'clips/tone.wav'));
  });
});
