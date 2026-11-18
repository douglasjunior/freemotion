import type { ReactNode } from 'react';

import { FrameProvider, type VideoConfig } from './frame.js';


// Every element inside the stage uses border-box, so layouts measure the same in the studio, the
// renderer and any page that embeds a <Player>. The rule is scoped to the stage and never leaks.
const STAGE_CSS = '[data-freemotion-stage],[data-freemotion-stage] *,[data-freemotion-stage] *::before,[data-freemotion-stage] *::after{box-sizing:border-box}';

export type StageProps = {
  readonly config: VideoConfig;
  readonly frame: number;
  readonly children: ReactNode;
};

/** Draws one frame of a composition at its native size. Whoever displays it decides the scale. */
export const Stage = ({ config, frame, children }: StageProps) => (
  <FrameProvider config={config} frame={frame}>
    <style href="freemotion-stage" precedence="freemotion">{STAGE_CSS}</style>
    <div
      data-freemotion-stage=""
      style={{ position: 'relative', width: config.width, height: config.height, overflow: 'hidden' }}
    >
      {children}
    </div>
  </FrameProvider>
);
