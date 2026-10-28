import '@fontsource-variable/inter/index.css';
import { ScrollPlayer } from 'freemotion';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { story } from '../src/compositions';
import './style.css';


// The player, its progress bar and the space below them share this width.
const PLAYER_WIDTH = 'min(1000px, 100% - 40px, (100vh - 100px) * 16 / 9)';

const Page = () => {
  const [frame, setFrame] = useState(0);
  const progress = frame / (story.durationInFrames - 1);

  return (
    <main style={{ ['--player-width' as string]: PLAYER_WIDTH }}>
      <header className="text hero">
        <h1>This video plays as you scroll.</h1>
        <p>
          It is the <code>Story</code> composition from <code>src/</code>, the same one you can render to MP4.
          Scroll down to play it, scroll up to rewind.
        </p>
        <p className="cue">Scroll ↓</p>
      </header>

      {/* A tall section: while it scrolls by, the player stays on screen and the scroll picks the frame. */}
      <ScrollPlayer
        composition={story}
        scrollLength="400vh"
        width={PLAYER_WIDTH}
        onFrameChange={setFrame}
        stickyStyle={{ gap: 16 }}
        playerStyle={{ borderRadius: 16, boxShadow: '0 0 0 1px var(--line)' }}
      >
        <div className="progress"><span style={{ transform: `scaleX(${progress})` }} /></div>
      </ScrollPlayer>

      <section className="text after">
        <h1>That&apos;s it.</h1>
        <p>
          Change the steps in <code>src/compositions.tsx</code> and this page follows. To publish it, run{' '}
          <code>npm run page:build</code> and upload <code>page/dist</code> to any static host.
        </p>
      </section>
    </main>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
