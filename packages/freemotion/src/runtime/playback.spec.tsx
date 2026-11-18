import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PlaybackProvider, usePlayback } from './playback.js';


const Consumer = () => {
  const { playing, muted } = usePlayback();
  return <div data-playing={String(playing)} data-muted={String(muted)} />;
};

describe('Playback context', () => {
  it('defaults to playing: false and muted: false outside provider', () => {
    const html = renderToStaticMarkup(<Consumer />);
    expect(html).toContain('data-playing="false"');
    expect(html).toContain('data-muted="false"');
  });

  it('provides playing and muted values from PlaybackProvider', () => {
    const html = renderToStaticMarkup(
      <PlaybackProvider playing muted>
        <Consumer />
      </PlaybackProvider>,
    );
    expect(html).toContain('data-playing="true"');
    expect(html).toContain('data-muted="true"');
  });
});
