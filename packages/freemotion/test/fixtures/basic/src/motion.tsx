// Composition for the animated SVG export, loaded with --entry src/motion.tsx. Each part changes in
// a different way: an inline style, SVG attributes, an element that mounts late, a text that counts.
import { AbsoluteFill, defineComposition, Sequence, useCurrentFrame } from 'freemotion';


/** A green bar sliding right, a circle that grows and turns blue at frame 5, the frame number from frame 5. */
const Motion = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#000000' }}>
      <div style={{ position: 'absolute', left: frame * 4, top: 48, width: 24, height: 16, background: '#00ff00' }} />
      <svg width={64} height={48} style={{ position: 'absolute', left: 0, top: 0 }}>
        <circle cx={32} cy={24} r={frame + 1} fill={frame < 5 ? '#ff0000' : '#0000ff'} />
      </svg>
      <Sequence from={5} layout="none">
        <span data-testid="label" style={{ position: 'absolute', left: 0, top: 0, color: '#ffffff', fontSize: 8 }}>{frame}</span>
      </Sequence>
    </AbsoluteFill>
  );
};

export default [defineComposition({ id: 'Motion', component: Motion, fps: 30, width: 64, height: 64, durationInFrames: 10 })];
