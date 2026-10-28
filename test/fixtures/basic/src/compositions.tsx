// Small solid-color compositions: the e2e tests render them and read pixels back.
import { AbsoluteFill, continueRender, defineComposition, delayRender, Img, Series, staticFile } from 'freemotion';
import { useEffect, useState } from 'react';


const size = { fps: 30, width: 64, height: 64 };

const Fill = ({ color }: { readonly color: string }) => <AbsoluteFill style={{ background: color }} />;

/** Red for 5 frames, then blue. */
const Colors = () => (
  <Series>
    <Series.Sequence durationInFrames={5}><Fill color="#ff0000" /></Series.Sequence>
    <Series.Sequence durationInFrames={5}><Fill color="#0000ff" /></Series.Sequence>
  </Series>
);

/** Black until data "arrives" 300 ms later; the render must wait for it. */
const Held = () => {
  const [color, setColor] = useState('#000000');
  const [handle] = useState(() => delayRender('fixture data'));
  useEffect(() => {
    const timer = setTimeout(() => {
      setColor('#00ff00');
      continueRender(handle);
    }, 300);
    return () => clearTimeout(timer);
  }, [handle]);
  return <Fill color={color} />;
};

/** A green SVG from public/, through <Img> and staticFile(). */
const Asset = () => (
  <AbsoluteFill>
    <Img src={staticFile('square.svg')} style={{ width: '100%', height: '100%' }} />
  </AbsoluteFill>
);

export const colors = defineComposition({ ...size, id: 'Colors', component: Colors, durationInFrames: 10 });

export default [
  colors,
  defineComposition({ ...size, id: 'Props', component: Fill, defaultProps: { color: '#ff0000' }, durationInFrames: 1 }),
  defineComposition({ ...size, id: 'Held', component: Held, durationInFrames: 2 }),
  defineComposition({ ...size, id: 'Asset', component: Asset, durationInFrames: 1, folder: 'Assets' }),
];
