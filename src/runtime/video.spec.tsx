import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvironment, setEnvironment } from './environment.js';
import { FrameProvider, type VideoConfig } from './frame.js';
import { resetRenderContext, setRenderContext } from './render-context.js';
import { Video } from './video.js';


const config: VideoConfig = { fps: 30, width: 1920, height: 1080, durationInFrames: 300 };

describe('<Video>', () => {
  beforeEach(() => {
    resetEnvironment();
    resetRenderContext();
  });

  afterEach(() => {
    resetEnvironment();
    resetRenderContext();
  });

  it('renders a <video> element outside render mode', () => {
    const html = renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Video src="clips/sample.mp4" className="my-video" style={{ opacity: 0.8 }} />
      </FrameProvider>,
    );
    expect(html).toContain('<video src="clips/sample.mp4"');
    expect(html).toContain('class="my-video"');
    expect(html).toContain('opacity:0.8');
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
});
