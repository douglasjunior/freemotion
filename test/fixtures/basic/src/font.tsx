import { AbsoluteFill, defineComposition, loadFont, staticFile } from 'freemotion';


void loadFont({
  family: 'InterCustom',
  url: staticFile('inter.woff2'),
});

const Text = ({ family }: { readonly family: string }) => (
  <AbsoluteFill style={{ background: '#ffffff', justifyContent: 'center', alignItems: 'flex-start' }}>
    <span style={{ fontFamily: family, fontSize: 32, color: '#000000', lineHeight: 1 }}>
      iiiiiiiiii
    </span>
  </AbsoluteFill>
);

export default [
  defineComposition({
    id: 'CustomFont',
    component: Text,
    defaultProps: { family: 'InterCustom, monospace' },
    fps: 30,
    width: 250,
    height: 64,
    durationInFrames: 1,
  }),
  defineComposition({
    id: 'FallbackFont',
    component: Text,
    defaultProps: { family: 'monospace' },
    fps: 30,
    width: 250,
    height: 64,
    durationInFrames: 1,
  }),
];
