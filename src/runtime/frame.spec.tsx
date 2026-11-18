import { renderToStaticMarkup } from 'react-dom/server';

import { FrameProvider, useAbsoluteFrame, useCurrentFrame, useFrameState, useVideoConfig } from './frame.js';
import { Sequence } from './sequence.js';
import { Stage } from './stage.js';


const config = { fps: 30, width: 1920, height: 1080, durationInFrames: 300 };

describe('frame context', () => {
  it('throws when hooks are used outside a FrameProvider', () => {
    const errorPattern = /inside a <Stage>, a <Player> or a composition rendered by the studio/;
    const ProbeFrameState = () => {
      useFrameState();
      return null;
    };
    const ProbeCurrentFrame = () => {
      useCurrentFrame();
      return null;
    };
    const ProbeVideoConfig = () => {
      useVideoConfig();
      return null;
    };
    const ProbeAbsoluteFrame = () => {
      useAbsoluteFrame();
      return null;
    };

    expect(() => renderToStaticMarkup(<ProbeFrameState />)).toThrow(errorPattern);
    expect(() => renderToStaticMarkup(<ProbeCurrentFrame />)).toThrow(errorPattern);
    expect(() => renderToStaticMarkup(<ProbeVideoConfig />)).toThrow(errorPattern);
    expect(() => renderToStaticMarkup(<ProbeAbsoluteFrame />)).toThrow(errorPattern);
  });

  it('provides default offset (0) and frozen (false)', () => {
    let capturedState: ReturnType<typeof useFrameState> | null = null;
    const Probe = () => {
      capturedState = useFrameState();
      return null;
    };

    renderToStaticMarkup(
      <FrameProvider config={config} frame={42}>
        <Probe />
      </FrameProvider>,
    );

    expect(capturedState).toEqual({
      config,
      frame: 42,
      offset: 0,
      frozen: false,
    });
  });

  it('computes useAbsoluteFrame as frame + offset', () => {
    let absFrame: number | null = null;
    const Probe = () => {
      absFrame = useAbsoluteFrame();
      return null;
    };

    renderToStaticMarkup(
      <FrameProvider config={config} frame={5} offset={10}>
        <Probe />
      </FrameProvider>,
    );

    expect(absFrame).toBe(15);
  });

  it('calculates offset and relative frame for nested sequences', () => {
    let capturedState: ReturnType<typeof useFrameState> | null = null;
    let absFrame: number | null = null;
    const Probe = () => {
      capturedState = useFrameState();
      absFrame = useAbsoluteFrame();
      return null;
    };

    renderToStaticMarkup(
      <Stage config={config} frame={20}>
        <Sequence from={5}>
          <Sequence from={10}>
            <Probe />
          </Sequence>
        </Sequence>
      </Stage>,
    );

    expect(capturedState).toEqual({
      config,
      frame: 5,
      offset: 15,
      frozen: false,
    });
    expect(absFrame).toBe(20);
  });

  it('supports negative from generating negative offset', () => {
    let capturedState: ReturnType<typeof useFrameState> | null = null;
    let absFrame: number | null = null;
    const Probe = () => {
      capturedState = useFrameState();
      absFrame = useAbsoluteFrame();
      return null;
    };

    renderToStaticMarkup(
      <Stage config={config} frame={0}>
        <Sequence from={-10}>
          <Probe />
        </Sequence>
      </Stage>,
    );

    expect(capturedState).toEqual({
      config,
      frame: 10,
      offset: -10,
      frozen: false,
    });
    expect(absFrame).toBe(0);
  });

  it('inherits frozen in nested sequences', () => {
    let capturedState: ReturnType<typeof useFrameState> | null = null;
    const Probe = () => {
      capturedState = useFrameState();
      return null;
    };

    renderToStaticMarkup(
      <FrameProvider config={config} frame={20} frozen={true}>
        <Sequence from={5}>
          <Sequence from={10}>
            <Probe />
          </Sequence>
        </Sequence>
      </FrameProvider>,
    );

    expect(capturedState).toEqual({
      config,
      frame: 5,
      offset: 15,
      frozen: true,
    });
  });
});
