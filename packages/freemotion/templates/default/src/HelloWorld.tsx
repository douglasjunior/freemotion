import '@fontsource-variable/inter/index.css';
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'freemotion';


export type HelloWorldProps = {
  readonly title: string;
  readonly subtitle: string;
};

const colors = {
  background: '#0b0b12',
  text: '#f4f4f8',
  muted: '#9a9ab0',
  pink: '#ff4f7b',
  amber: '#ffb547',
};

/** Two soft glows drifting slowly behind the text. Everything is a function of the frame. */
const Background = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 40) * 60;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(circle at ${30 + drift / 20}% ${35 - drift / 30}%, ${colors.pink}4d, transparent 45%)`,
          `radial-gradient(circle at ${70 - drift / 20}% ${65 + drift / 30}%, ${colors.amber}38, transparent 45%)`,
          colors.background,
        ].join(', '),
      }}
    />
  );
};

/** Each word springs up, a few frames after the previous one. */
const Title = ({ text }: { readonly text: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <h1 style={{ margin: 0, fontSize: 140, fontWeight: 700, letterSpacing: -5, color: colors.text, display: 'flex', gap: 36 }}>
      {text.split(' ').map((word, i) => {
        const progress = spring({ frame, fps, delay: i * 5, config: { damping: 14 } });
        return (
          <span key={i} style={{ display: 'inline-block', opacity: progress, transform: `translateY(${(1 - progress) * 80}px)` }}>
            {word}
          </span>
        );
      })}
    </h1>
  );
};

const Subtitle = ({ text }: { readonly text: string }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(frame, [0, 20], [24, 0], { easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp' });
  return (
    <p style={{ margin: '28px 0 0', fontSize: 48, fontWeight: 400, color: colors.muted, opacity, transform: `translateY(${y}px)` }}>
      {text}
    </p>
  );
};

/** A gradient bar that fills up over the whole video. */
const Progress = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const width = interpolate(frame, [0, durationInFrames - 1], [0, 100]);
  return (
    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 8, width: `${width}%`, background: `linear-gradient(90deg, ${colors.amber}, ${colors.pink})` }} />
  );
};

export const HelloWorld = ({ title, subtitle }: HelloWorldProps) => (
  <AbsoluteFill style={{ fontFamily: '"Inter Variable", sans-serif' }}>
    <Background />
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Title text={title} />
      {/* The box keeps its height before the subtitle mounts, so the title doesn't move. */}
      <div style={{ height: 86 }}>
        <Sequence from={25} layout="none">
          <Subtitle text={subtitle} />
        </Sequence>
      </div>
    </AbsoluteFill>
    <Progress />
  </AbsoluteFill>
);
