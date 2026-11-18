import type { AnyComposition } from '../runtime/composition.js';

import { readUrl, timecode } from './studio.js';


describe('timecode', () => {
  it('formats minutes, seconds and frames', () => {
    expect(timecode(0, 30)).toBe('0:00.00');
    expect(timecode(29, 30)).toBe('0:00.29');
    expect(timecode(30, 30)).toBe('0:01.00');
    expect(timecode(30 * 75 + 4, 30)).toBe('1:15.04');
  });
});

describe('readUrl', () => {
  const dummyComp = (id: string, durationInFrames = 100): AnyComposition => ({
    id,
    component: () => null,
    defaultProps: {},
    durationInFrames,
    fps: 30,
    width: 1920,
    height: 1080,
  });

  const comps = [dummyComp('Intro', 60), dummyComp('Outro', 90)];

  it('falls back to first composition and frame 0 when no query params present', () => {
    expect(readUrl(comps, '')).toEqual({ composition: comps[0], frame: 0 });
  });

  it('reads requested composition and frame within bounds', () => {
    expect(readUrl(comps, '?composition=Outro&frame=45')).toEqual({ composition: comps[1], frame: 45 });
  });

  it('clamps frame to 0 when negative and to durationInFrames - 1 when exceeding', () => {
    expect(readUrl(comps, '?composition=Intro&frame=-10')).toEqual({ composition: comps[0], frame: 0 });
    expect(readUrl(comps, '?composition=Intro&frame=999')).toEqual({ composition: comps[0], frame: 59 });
  });
});
