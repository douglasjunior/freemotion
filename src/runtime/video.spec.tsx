import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAudioRegistry, collectAudio } from './audio-registry.js';
import { resetEnvironment, setEnvironment } from './environment.js';
import { FrameProvider, type VideoConfig } from './frame.js';
import { resetRenderContext, setRenderContext } from './render-context.js';
import { Video } from './video.js';


const config: VideoConfig = { fps: 30, width: 1920, height: 1080, durationInFrames: 300 };

describe('<Video>', () => {
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

  it('renders a <video> element outside render mode with preload="auto" and without frame server URL', () => {
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });
    const html = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="clips/sample.mp4" className="my-video" style={{ opacity: 0.8 }} />
      </FrameProvider>,
    );
    expect(html).toContain('<video src="clips/sample.mp4"');
    expect(html).toContain('preload="auto"');
    expect(html.toLowerCase()).toContain('playsinline=""');
    expect(html).toContain('class="my-video"');
    expect(html).toContain('opacity:0.8');
    expect(html).not.toContain('__freemotion/video-frame');
  });

  it('throws in render mode if video server URL is not configured', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    expect(() => renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="clips/sample.mp4" />
      </FrameProvider>,
    )).toThrow('freemotion: <Video> in render mode needs a video frame server URL, but none was provided.');
  });

  it('renders <Img> pointing to the frame server in render mode', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    const html = renderToStaticMarkup(
      <FrameProvider config={config} frame={30}>
        <Video src="/clips/sample.mp4" className="player-clip" style={{ width: 100 }} />
      </FrameProvider>,
    );

    expect(html).toContain('<img');
    expect(html).toContain('src="http://127.0.0.1:9999/__freemotion/video-frame?src=clips%2Fsample.mp4&amp;time=1.000000&amp;transparent=0"');
    expect(html).toContain('crossorigin="anonymous"');
    expect(html).toContain('class="player-clip"');
    expect(html).toContain('width:100px');
  });

  it('accounts for trimBefore and playbackRate in frame query', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    // frame 15 at 30 fps with trimBefore 30 (1s) and playbackRate 2:
    // (30 + 15 * 2) / 30 = 60 / 30 = 2.0s
    const html = renderToStaticMarkup(
      <FrameProvider config={config} frame={15}>
        <Video src="video.mp4" trimBefore={30} playbackRate={2} />
      </FrameProvider>,
    );

    expect(html).toContain('time=2.000000');
  });

  it('sets transparent=1 when transparent prop is true', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999/' });

    const html = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="overlay.webm" transparent />
      </FrameProvider>,
    );

    expect(html).toContain('http://127.0.0.1:9999/__freemotion/video-frame?src=overlay.webm&amp;time=0.000000&amp;transparent=1');
  });

  it('strips video-only props from the rendered <img> in render mode', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    const html = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video
          src="test.mp4"
          muted
          autoPlay
          playsInline
          controls
          loop
          id="hero-video"
        />
      </FrameProvider>,
    );

    expect(html).toContain('id="hero-video"');
    expect(html).not.toContain('muted');
    expect(html).not.toContain('autoplay');
    expect(html).not.toContain('playsinline');
    expect(html).not.toContain('controls');
    expect(html).not.toContain('loop');
  });

  it('accepts volume as a number or a function of the frame', () => {
    const htmlNumber = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="test.mp4" volume={0.5} />
      </FrameProvider>,
    );
    expect(htmlNumber).toContain('<video src="test.mp4"');

    const htmlFn = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="test.mp4" volume={f => (f > 10 ? 1 : 0)} />
      </FrameProvider>,
    );
    expect(htmlFn).toContain('<video src="test.mp4"');
  });

  it('renders muted when premounting or muted prop is set', () => {
    const htmlPremount = renderToStaticMarkup(
      <FrameProvider config={config} frame={0} premounting>
        <Video src="test.mp4" />
      </FrameProvider>,
    );
    expect(htmlPremount).toContain('muted');

    const htmlMuted = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="test.mp4" muted />
      </FrameProvider>,
    );
    expect(htmlMuted).toContain('muted');
  });

  it('logs an error with src and calls onError callback on error event', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockReturnValue(undefined);
    const onError = vi.fn();
    let capturedOnError: ((e: unknown) => void) | undefined;

    const TestComponent = () => {
      const v = Video({ src: 'missing.mp4', onError });
      capturedOnError = v.props.onError;
      return v;
    };

    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <TestComponent />
      </FrameProvider>,
    );

    expect(capturedOnError).toBeDefined();
    capturedOnError?.({} as unknown);
    expect(consoleSpy).toHaveBeenCalledWith(
      'freemotion: <Video src="missing.mp4"> failed to load video element in preview mode.',
    );
    expect(onError).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('registers audio track in render mode with volume envelope', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    renderToStaticMarkup(
      <FrameProvider config={config} frame={5} offset={20}>
        <Video src="clip.mp4" volume={f => (f === 5 ? 0.7 : 1)} trimBefore={10} />
      </FrameProvider>,
    );

    const assets = collectAudio();
    expect(assets).toHaveLength(1);
    expect(assets[0]!.src).toBe('clip.mp4');
    expect(assets[0]!.startFrame).toBe(20);
    expect(assets[0]!.trimBefore).toBe(10);
    expect(assets[0]!.volumes).toEqual([[25, 0.7]]);
  });

  it('does not register audio track when muted, volume is constant 0, frozen, or premounting', () => {
    setEnvironment({ isRendering: true, isPlayer: false });
    setRenderContext({ videoServerUrl: 'http://127.0.0.1:9999' });

    // Muted
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="clip.mp4" muted />
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);

    // Constant volume 0
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="clip.mp4" volume={0} />
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);

    // Frozen
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0} frozen>
        <Video src="clip.mp4" />
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);

    // Premounting
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0} premounting>
        <Video src="clip.mp4" />
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);
  });
});
