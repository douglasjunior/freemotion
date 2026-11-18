import { AbsoluteFill, defineComposition } from 'freemotion';


const AlphaBox = () => (
  <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ width: 32, height: 32, background: '#ff0000' }} />
  </AbsoluteFill>
);

export default [defineComposition({ id: 'AlphaBox', component: AlphaBox, fps: 30, width: 64, height: 64, durationInFrames: 5 })];
