import { renderToStaticMarkup } from 'react-dom/server';

import { defineComposition } from './composition.js';
import { useCurrentFrame } from './frame.js';
import { Player } from './player.js';
import { staticFile } from './static-file.js';


const Counter = ({ label }: { label: string }) => <b>{`${label} ${useCurrentFrame()}`}</b>;
const composition = defineComposition({
  id: 'Counter',
  component: Counter,
  defaultProps: { label: 'frame' },
  fps: 30,
  width: 640,
  height: 360,
  durationInFrames: 60,
});

describe('Player', () => {
  it('keeps the aspect ratio of the composition', () => {
    expect(renderToStaticMarkup(<Player composition={composition} />)).toContain('aspect-ratio:640 / 360');
  });

  it('draws the controlled frame, rounded and clamped', () => {
    expect(renderToStaticMarkup(<Player composition={composition} frame={12.4} />)).toContain('frame 12');
    expect(renderToStaticMarkup(<Player composition={composition} frame={500} />)).toContain('frame 59');
    expect(renderToStaticMarkup(<Player composition={composition} frame={-3} />)).toContain('frame 0');
  });

  it('merges inputProps over defaultProps', () => {
    expect(renderToStaticMarkup(<Player composition={composition} frame={3} inputProps={{ label: 'tick' }} />)).toContain('tick 3');
  });

  it('stays hidden until it has measured its container', () => {
    expect(renderToStaticMarkup(<Player composition={composition} />)).toContain('visibility:hidden');
  });
});

describe('staticFile', () => {
  it('points at the public folder', () => {
    expect(staticFile('logo.svg')).toBe('/logo.svg');
    expect(staticFile('/images/a.png')).toBe('/images/a.png');
  });
});
