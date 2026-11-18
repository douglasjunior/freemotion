import '@fontsource-variable/inter/index.css';
import { AbsoluteFill, Easing, interpolate, Series, spring, useCurrentFrame, useVideoConfig } from 'freemotion';


export type StoryProps = {
  readonly steps: readonly { readonly title: string; readonly text: string }[];
};

/** Frames each step stays on screen. */
export const STEP_DURATION = 60;

const colors = {
  background: '#0b0b12',
  card: '#15151f',
  line: 'rgba(255, 255, 255, 0.1)',
  text: '#f4f4f8',
  muted: '#9a9ab0',
  accents: ['#ff4f7b', '#ffb547', '#4fd1ff'],
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** One step: a big number, a title and a line of text that enter one after the other, then leave. */
const Step = ({ index, title, text }: { readonly index: number; readonly title: string; readonly text: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = colors.accents[index % colors.accents.length];

  const number = spring({ frame, fps, config: { damping: 13 } });
  const heading = spring({ frame, fps, delay: 6, config: { damping: 16 } });
  const body = interpolate(frame, [14, 30], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const leave = interpolate(frame, [STEP_DURATION - 10, STEP_DURATION], [1, 0], clamp);

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: leave,
        background: `radial-gradient(circle at 50% 50%, ${accent}26, transparent 60%)`,
      }}
    >
      <div
        style={{
          width: 820,
          padding: '56px 64px',
          borderRadius: 28,
          background: colors.card,
          boxShadow: `0 40px 100px rgba(0, 0, 0, 0.5), inset 0 0 0 1px ${colors.line}`,
          transform: `translateY(${(1 - heading) * 40}px)`,
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -4, color: accent, transform: `scale(${number})`, transformOrigin: 'left center' }}>
          {String(index + 1).padStart(2, '0')}
        </div>
        <div style={{ marginTop: 12, fontSize: 56, fontWeight: 700, letterSpacing: -1.5, color: colors.text, opacity: heading }}>{title}</div>
        <div style={{ marginTop: 14, fontSize: 30, lineHeight: 1.4, color: colors.muted, opacity: body }}>{text}</div>
      </div>
    </AbsoluteFill>
  );
};

/** Dots at the bottom showing which step is on screen. Reads the frame of the whole video. */
const Dots = ({ count }: { readonly count: number }) => {
  const frame = useCurrentFrame();
  const current = Math.min(count - 1, Math.floor(frame / STEP_DURATION));
  return (
    <div style={{ position: 'absolute', bottom: 48, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={{
            width: i === current ? 36 : 12,
            height: 12,
            borderRadius: 6,
            background: i === current ? colors.accents[i % colors.accents.length] : colors.line,
          }}
        />
      ))}
    </div>
  );
};

/**
 * A short story in steps, played one after the other with <Series>. Inside each step,
 * useCurrentFrame() starts again at 0, so every step animates the same way.
 */
export const Story = ({ steps }: StoryProps) => (
  <AbsoluteFill style={{ background: colors.background, fontFamily: '"Inter Variable", sans-serif' }}>
    <Series>
      {steps.map((step, index) => (
        <Series.Sequence key={step.title} durationInFrames={STEP_DURATION}>
          <Step index={index} {...step} />
        </Series.Sequence>
      ))}
    </Series>
    <Dots count={steps.length} />
  </AbsoluteFill>
);
