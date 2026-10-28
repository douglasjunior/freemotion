import { join } from 'node:path';

import { planJobs } from './render.js';


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

  it('needs a known extension', () => {
    expect(() => planJobs({ ...base, output: 'x.mov' }, available)).toThrow(/Can't tell the format/);
  });

  it('fails when there is nothing to render', () => {
    expect(() => planJobs({ ...base, compositions: 'all' }, [])).toThrow(/no compositions/);
  });
});
