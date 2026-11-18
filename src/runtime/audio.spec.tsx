import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAudioRegistry, collectAudio } from './audio-registry.js';
import { Audio } from './audio.js';
import { resetEnvironment, setEnvironment } from './environment.js';
import { FrameProvider, type VideoConfig } from './frame.js';
import { Sequence } from './sequence.js';


const config: VideoConfig = { fps: 30, width: 1920, height: 1080, durationInFrames: 300 };

describe('<Audio>', () => {
  beforeEach(() => {
    resetEnvironment();
    clearAudioRegistry();
  });

  afterEach(() => {
    resetEnvironment();
    clearAudioRegistry();
  });

  it('renders nothing and records no audio outside render mode', () => {
    setEnvironment({ isRendering: false, isPlayer: true });

    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Audio src="track.mp3" />
      </FrameProvider>,
    );

    expect(collectAudio()).toHaveLength(0);
  });

  it('throws when playbackRate is outside 0.25 to 16 or NaN', () => {
    expect(() => renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Audio src="track.mp3" playbackRate={0.1} />
      </FrameProvider>,
    )).toThrow(/playbackRate must be between 0.25 and 16/);

    expect(() => renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Audio src="track.mp3" playbackRate={20} />
      </FrameProvider>,
    )).toThrow(/playbackRate must be between 0.25 and 16/);
  });

  it('records audio asset with constant and function volume evaluated with local frame', () => {
    setEnvironment({ isRendering: true, isPlayer: false });

    // Function volume receives local frame
    let receivedFrame: number | null = null;
    renderToStaticMarkup(
      <FrameProvider config={config} frame={5} offset={10}>
        <Audio
          src="track.mp3"
          volume={(f) => {
            receivedFrame = f;
            return f === 5 ? 0.5 : 1;
          }}
        />
      </FrameProvider>,
    );

    expect(receivedFrame).toBe(5);
    const assets = collectAudio();
    expect(assets).toHaveLength(1);
    expect(assets[0]!.src).toBe('track.mp3');
    expect(assets[0]!.startFrame).toBe(10);
    // Absolute frame is offset (10) + frame (5) = 15
    expect(assets[0]!.volumes).toEqual([[15, 0.5]]);
  });

  it('accumulates startFrame across nested sequences, including negative from', () => {
    setEnvironment({ isRendering: true, isPlayer: false });

    renderToStaticMarkup(
      <FrameProvider config={config} frame={40}>
        <Sequence from={20} durationInFrames={30}>
          <Sequence from={15} durationInFrames={10}>
            <Audio src="nested.mp3" />
          </Sequence>
        </Sequence>
      </FrameProvider>,
    );

    let assets = collectAudio();
    expect(assets).toHaveLength(1);
    expect(assets[0]!.startFrame).toBe(35); // 20 + 15

    // Negative from creates negative startFrame
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Sequence from={-10} durationInFrames={20}>
          <Audio src="negative.mp3" />
        </Sequence>
      </FrameProvider>,
    );

    assets = collectAudio();
    expect(assets).toHaveLength(1);
    expect(assets[0]!.startFrame).toBe(-10);
  });

  it('does not register audio when muted, frozen, or premounting', () => {
    setEnvironment({ isRendering: true, isPlayer: false });

    // Muted prop
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0}>
        <Audio src="muted.mp3" muted />
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);

    // Frozen state
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0} frozen>
        <Audio src="frozen.mp3" />
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);

    // Premounting state
    renderToStaticMarkup(
      <FrameProvider config={config} frame={0} premounting>
        <Audio src="premount.mp3" />
      </FrameProvider>,
    );
    expect(collectAudio()).toHaveLength(0);
  });
});
