import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDomHarness } from '../../test/dom-harness.js';

import { beginAudioFrame, clearAudioRegistry, collectAudio } from './audio-registry.js';
import { Audio } from './audio.js';
import { resetEnvironment, setEnvironment } from './environment.js';
import { FrameProvider, useAbsoluteFrame, useCurrentFrame, useFrameState, type VideoConfig } from './frame.js';
import { Freeze } from './freeze.js';
import { PlaybackProvider } from './playback.js';
import { resetRenderContext, setRenderContext } from './render-context.js';
import { Sequence } from './sequence.js';
import { Video } from './video.js';


const config: VideoConfig = { fps: 30, width: 1920, height: 1080, durationInFrames: 300 };
const harness = createDomHarness();

describe('<Freeze>', () => {
  beforeEach(() => {
    resetEnvironment();
    resetRenderContext();
    clearAudioRegistry();
  });

  afterEach(() => {
    resetEnvironment();
    resetRenderContext();
    clearAudioRegistry();
  });

  it('throws an actionable error when used outside a FrameProvider', () => {
    const errorPattern = /inside a <Stage>, a <Player> or a composition rendered by the studio/;
    expect(() => renderToStaticMarkup(
      <Freeze frame={10}>
        <div />
      </Freeze>,
    )).toThrow(errorPattern);
  });

  it('throws a descriptive error when frame is not a finite number', () => {
    const TestComponent = ({ frame }: { frame: number }) => (
      <FrameProvider config={config} frame={0}>
        <Freeze frame={frame}>
          <div />
        </Freeze>
      </FrameProvider>
    );

    expect(() => renderToStaticMarkup(<TestComponent frame={NaN} />))
      .toThrow('freemotion: <Freeze> "frame" must be a finite number, received NaN.');

    expect(() => renderToStaticMarkup(<TestComponent frame={Infinity} />))
      .toThrow('freemotion: <Freeze> "frame" must be a finite number, received Infinity.');

    expect(() => renderToStaticMarkup(<TestComponent frame={-Infinity} />))
      .toThrow('freemotion: <Freeze> "frame" must be a finite number, received -Infinity.');
  });

  it('children observe the frozen frame at any parent frame when active={true} or omitted', () => {
    let observedFrame: number | null = null;
    let observedFrozen: boolean | null = null;

    const Probe = () => {
      observedFrame = useCurrentFrame();
      observedFrozen = useFrameState().frozen;
      return null;
    };

    // Frame 0 of parent
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Freeze frame={42}>
          <Probe />
        </Freeze>
      </FrameProvider>,
    );
    expect(observedFrame).toBe(42);
    expect(observedFrozen).toBe(true);

    // Frame 100 of parent
    renderToStaticMarkup(
      <FrameProvider config={config} frame={100}>
        <Freeze frame={42}>
          <Probe />
        </Freeze>
      </FrameProvider>,
    );
    expect(observedFrame).toBe(42);
    expect(observedFrozen).toBe(true);

    // Explicit active={true}
    renderToStaticMarkup(
      <FrameProvider config={config} frame={250}>
        <Freeze frame={42} active={true}>
          <Probe />
        </Freeze>
      </FrameProvider>,
    );
    expect(observedFrame).toBe(42);
    expect(observedFrozen).toBe(true);
  });

  it('passes the dynamic parent frame through when active={false}', () => {
    let observedFrame: number | null = null;
    let observedFrozen: boolean | null = null;

    const Probe = () => {
      observedFrame = useCurrentFrame();
      observedFrozen = useFrameState().frozen;
      return null;
    };

    renderToStaticMarkup(
      <FrameProvider config={config} frame={15}>
        <Freeze frame={42} active={false}>
          <Probe />
        </Freeze>
      </FrameProvider>,
    );
    expect(observedFrame).toBe(15);
    expect(observedFrozen).toBe(false);

    renderToStaticMarkup(
      <FrameProvider config={config} frame={75}>
        <Freeze frame={42} active={false}>
          <Probe />
        </Freeze>
      </FrameProvider>,
    );
    expect(observedFrame).toBe(75);
    expect(observedFrozen).toBe(false);
  });

  it('is relative to the parent Sequence and preserves sequence offset for absolute frame', () => {
    let currentFrame: number | null = null;
    let absFrame: number | null = null;

    const Probe = () => {
      currentFrame = useCurrentFrame();
      absFrame = useAbsoluteFrame();
      return null;
    };

    // Sequence starting at frame 30; parent at frame 50
    renderToStaticMarkup(
      <FrameProvider config={config} frame={50}>
        <Sequence from={30}>
          <Freeze frame={12}>
            <Probe />
          </Freeze>
        </Sequence>
      </FrameProvider>,
    );

    // useCurrentFrame inside Freeze is the specified frame (12)
    expect(currentFrame).toBe(12);
    // useAbsoluteFrame accounts for the sequence from=30 offset: 12 + 30 = 42
    expect(absFrame).toBe(42);
  });

  it('ensures nested Sequence inherits frozen: true and derives local frame from frozen parent', () => {
    let nestedFrame: number | null = null;
    let nestedAbsFrame: number | null = null;
    let nestedFrozen: boolean | null = null;

    const Probe = () => {
      nestedFrame = useCurrentFrame();
      nestedAbsFrame = useAbsoluteFrame();
      nestedFrozen = useFrameState().frozen;
      return null;
    };

    // Parent at frame 0, Freeze at 40. Nested sequence starts at 10.
    // Local frame in nested sequence is 40 - 10 = 30.
    // Offset in nested sequence is 0 + 10 = 10.
    // Absolute frame is 30 + 10 = 40.
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Freeze frame={40}>
          <Sequence from={10}>
            <Probe />
          </Sequence>
        </Freeze>
      </FrameProvider>,
    );

    expect(nestedFrame).toBe(30);
    expect(nestedAbsFrame).toBe(40);
    expect(nestedFrozen).toBe(true);
  });

  it('locks Video to the specified frame and requests the same time in render mode', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    // frame 45 at 30 fps = 1.500000s
    const htmlAtParentFrame0 = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Freeze frame={45}>
          <Video src="clip.mp4" />
        </Freeze>
      </FrameProvider>,
    );
    expect(htmlAtParentFrame0).toContain('time=1.500000');

    const htmlAtParentFrame100 = renderToStaticMarkup(
      <FrameProvider config={config} frame={100}>
        <Freeze frame={45}>
          <Video src="clip.mp4" />
        </Freeze>
      </FrameProvider>,
    );
    expect(htmlAtParentFrame100).toContain('time=1.500000');
  });

  it('allows Video to request dynamic time when active={false}', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    const htmlAt0 = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Freeze frame={45} active={false}>
          <Video src="clip.mp4" />
        </Freeze>
      </FrameProvider>,
    );
    expect(htmlAt0).toContain('time=0.000000');

    const htmlAt30 = renderToStaticMarkup(
      <FrameProvider config={config} frame={30}>
        <Freeze frame={45} active={false}>
          <Video src="clip.mp4" />
        </Freeze>
      </FrameProvider>,
    );
    expect(htmlAt30).toContain('time=1.000000');
  });

  it('does not register Audio track when frozen, but registers when active={false}', () => {
    setEnvironment({ isRendering: true, isPlayer: false });

    // Frozen: Audio is suppressed
    beginAudioFrame();
    harness.render(
      <FrameProvider config={config} frame={10}>
        <Freeze frame={42}>
          <Audio src="sound.mp3" />
        </Freeze>
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);

    // Active=false: Audio registers normally
    beginAudioFrame();
    harness.render(
      <FrameProvider config={config} frame={10}>
        <Freeze frame={42} active={false}>
          <Audio src="sound.mp3" />
        </Freeze>
      </FrameProvider>,
    );
    const assets = collectAudio();
    expect(assets).toHaveLength(1);
    expect(assets[0]?.src).toBe('sound.mp3');
  });

  it('does not register Video audio track in render mode when frozen', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    beginAudioFrame();
    harness.render(
      <FrameProvider config={config} frame={10}>
        <Freeze frame={42}>
          <Video src="clip.mp4" />
        </Freeze>
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);
  });

  it('keeps Video muted and unplaying in preview mode when frozen', () => {
    setEnvironment({ isRendering: false, isPlayer: true });

    // Inside PlaybackProvider with playing=true, muted=false
    const htmlFrozen = renderToStaticMarkup(
      <PlaybackProvider playing={true} muted={false}>
        <FrameProvider config={config} frame={10}>
          <Freeze frame={42}>
            <Video src="clip.mp4" />
          </Freeze>
        </FrameProvider>
      </PlaybackProvider>,
    );
    // When frozen, Video is muted because isPlaying is false
    expect(htmlFrozen).toContain('muted');

    const htmlActiveFalse = renderToStaticMarkup(
      <PlaybackProvider playing={true} muted={false}>
        <FrameProvider config={config} frame={10}>
          <Freeze frame={42} active={false}>
            <Video src="clip.mp4" />
          </Freeze>
        </FrameProvider>
      </PlaybackProvider>,
    );
    // When active=false, not frozen, so isPlaying is true and it is unmuted
    expect(htmlActiveFalse).not.toContain('muted');
  });
});
