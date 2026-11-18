import { renderToStaticMarkup } from 'react-dom/server';

import { defineComposition } from './composition.js';
import { easeTowards, ScrollPlayer, scrollProgress } from './scroll.js';


describe('scrollProgress', () => {
  describe('sticky', () => {
    // A 3000 px section in a 1000 px viewport: 2000 px of scrolling play the video.
    it('starts when the section reaches the top and ends when its bottom reaches the bottom', () => {
      expect(scrollProgress(500, 3000, 1000)).toBe(0);
      expect(scrollProgress(0, 3000, 1000)).toBe(0);
      expect(scrollProgress(-1000, 3000, 1000)).toBe(0.5);
      expect(scrollProgress(-2000, 3000, 1000)).toBe(1);
      expect(scrollProgress(-2500, 3000, 1000)).toBe(1);
    });

    it('jumps from start to end when the section is shorter than the viewport', () => {
      expect(scrollProgress(10, 800, 1000)).toBe(0);
      expect(scrollProgress(-10, 800, 1000)).toBe(1);
    });
  });

  describe('visible', () => {
    // A 400 px player in a 1000 px viewport: it plays over 1400 px, from entering to leaving.
    it('runs from entering the viewport to leaving it', () => {
      expect(scrollProgress(1000, 400, 1000, 'visible')).toBe(0);
      expect(scrollProgress(300, 400, 1000, 'visible')).toBe(0.5);
      expect(scrollProgress(-400, 400, 1000, 'visible')).toBe(1);
      expect(scrollProgress(1500, 400, 1000, 'visible')).toBe(0);
    });
  });
});

describe('easeTowards', () => {
  it('follows the target exactly without smoothing', () => {
    expect(easeTowards(0, 100, 16, 0)).toBe(100);
  });

  it('moves part of the way and settles on the target', () => {
    const step = easeTowards(0, 100, 16, 120);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(100);
    expect(easeTowards(99.995, 100, 16, 120)).toBe(100);
  });

  it('does not depend on the frame rate', () => {
    const at60 = easeTowards(0, 100, 16, 120);
    const at120 = easeTowards(easeTowards(0, 100, 8, 120), 100, 8, 120);
    expect(at120).toBeCloseTo(at60, 10);
  });
});

describe('ScrollPlayer', () => {
  const composition = defineComposition({
    id: 'Wide',
    component: () => <b>wide</b>,
    fps: 30,
    width: 1600,
    height: 900,
    durationInFrames: 60,
  });

  it('renders a tall section with a sticky, viewport-fitted player', () => {
    const html = renderToStaticMarkup(<ScrollPlayer composition={composition} scrollLength="600vh"><i>caption</i></ScrollPlayer>);
    expect(html).toContain('height:600vh');
    expect(html).toContain('position:sticky');
    expect(html).toContain('width:min(100%, 100vh * 1.7777777777777777)');
    expect(html).toContain('<b>wide</b>');
    expect(html).toContain('<i>caption</i>');
  });

  it('lets the caller size the player', () => {
    expect(renderToStaticMarkup(<ScrollPlayer composition={composition} width="50vw" />)).toContain('width:50vw');
  });
});
