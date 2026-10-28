import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { useCurrentFrame, useVideoConfig } from './frame.js';
import { Sequence, Series } from './sequence.js';
import { Stage } from './stage.js';


const config = { fps: 30, width: 320, height: 180, durationInFrames: 100 };

const Probe = ({ name }: { readonly name: string }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <i>{`${name}@${frame}/${durationInFrames}`}</i>;
};

const draw = (frame: number, children: ReactNode) => renderToStaticMarkup(<Stage config={config} frame={frame}>{children}</Stage>);
const probes = (html: string) => [...html.matchAll(/<i>([^<]+)<\/i>/g)].map(match => match[1]);

describe('Stage', () => {
  it('draws at native size with border-box scoped to the stage', () => {
    const html = draw(0, null);
    expect(html).toContain('width:320px;height:180px');
    expect(html).toContain('[data-freemotion-stage] *');
  });
});

describe('Sequence', () => {
  it('shifts time for its children', () => {
    const tree = <Sequence from={10}><Probe name="a" /></Sequence>;
    expect(probes(draw(10, tree))).toEqual(['a@0/100']);
    expect(probes(draw(25, tree))).toEqual(['a@15/100']);
  });

  it('unmounts outside its window', () => {
    const tree = <Sequence from={10} durationInFrames={5}><Probe name="a" /></Sequence>;
    expect(probes(draw(9, tree))).toEqual([]);
    expect(probes(draw(14, tree))).toEqual(['a@4/100']);
    expect(probes(draw(15, tree))).toEqual([]);
  });

  it('nests', () => {
    const tree = (
      <Sequence from={10}>
        <Sequence from={5}><Probe name="inner" /></Sequence>
      </Sequence>
    );
    expect(probes(draw(20, tree))).toEqual(['inner@5/100']);
  });

  it('wraps in an absolute fill unless layout is none', () => {
    expect(draw(0, <Sequence><b /></Sequence>)).toContain('position:absolute');
    expect(draw(0, <Sequence layout="none"><b /></Sequence>)).not.toContain('position:absolute');
  });

  it('rejects invalid timing', () => {
    expect(() => draw(0, <Sequence from={Number.NaN} />)).toThrow(/"from"/);
    expect(() => draw(0, <Sequence durationInFrames={0} />)).toThrow(/positive/);
  });
});

describe('Series', () => {
  const tree = (
    <Series>
      <Series.Sequence durationInFrames={10}><Probe name="a" /></Series.Sequence>
      <Series.Sequence durationInFrames={20}><Probe name="b" /></Series.Sequence>
      <Series.Sequence durationInFrames={10} offset={-5}><Probe name="c" /></Series.Sequence>
    </Series>
  );

  it('plays items one after the other', () => {
    expect(probes(draw(0, tree))).toEqual(['a@0/100']);
    expect(probes(draw(10, tree))).toEqual(['b@0/100']);
    expect(probes(draw(24, tree))).toEqual(['b@14/100']);
  });

  it('overlaps with a negative offset', () => {
    expect(probes(draw(25, tree))).toEqual(['b@15/100', 'c@0/100']);
    expect(probes(draw(34, tree))).toEqual(['c@9/100']);
  });

  it('only accepts Series.Sequence children', () => {
    expect(() => draw(0, <Series><div /></Series>)).toThrow(/only accepts/);
  });

  it('only allows an infinite duration on the last item', () => {
    const invalid = (
      <Series>
        <Series.Sequence durationInFrames={Infinity}><b /></Series.Sequence>
        <Series.Sequence durationInFrames={10}><b /></Series.Sequence>
      </Series>
    );
    expect(() => draw(0, invalid)).toThrow(/only the last/);
  });
});

describe('useCurrentFrame', () => {
  it('explains where it can be used', () => {
    expect(() => renderToStaticMarkup(<Probe name="x" />)).toThrow(/inside a <Stage>/);
  });
});
