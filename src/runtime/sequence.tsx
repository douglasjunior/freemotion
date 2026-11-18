import { Children, Fragment, createContext, isValidElement, useContext, useEffect, useId, type CSSProperties, type ReactNode } from 'react';

import { AbsoluteFill } from './absolute-fill.js';
import { getEnvironment } from './environment.js';
import { FrameProvider, useFrameState } from './frame.js';
import { addTimelineEntry } from './timeline-registry.js';


const DepthContext = createContext(0);

export type SequenceProps = {
  /** Frame of the parent timeline where this sequence starts. Default `0`. */
  readonly from?: number;
  /** How long it stays mounted. Default `Infinity`. */
  readonly durationInFrames?: number;
  /**
   * In preview/studio modes, mounts children this many frames before `from` with
   * frame 0, frozen and hidden, to preload assets (video, audio). Ignored during render.
   */
  readonly premountFor?: number;
  /** `'absolute-fill'` (default) wraps the children in an `<AbsoluteFill>`; `'none'` renders them as they are. */
  readonly layout?: 'absolute-fill' | 'none';
  readonly style?: CSSProperties;
  /** Shown in error messages. */
  readonly name?: string;
  readonly children?: ReactNode;
};

function assertFrames(value: number, what: string, name?: string) {
  if (Number.isNaN(value) || value === -Infinity) {
    throw new Error(`freemotion: <Sequence${name ? ` name="${name}"` : ''}> got an invalid ${what}: ${value}.`);
  }
}

/**
 * Shifts time for its children: inside it, `useCurrentFrame()` starts at 0 on frame `from`.
 * Outside `[from, from + durationInFrames)` the children are unmounted.
 */
export const Sequence = ({
  from = 0,
  durationInFrames = Infinity,
  premountFor = 0,
  layout = 'absolute-fill',
  style,
  name,
  children,
}: SequenceProps) => {
  assertFrames(from, '"from"', name);
  assertFrames(durationInFrames, '"durationInFrames"', name);
  if (durationInFrames <= 0) {
    throw new Error(`freemotion: <Sequence${name ? ` name="${name}"` : ''}> needs a positive "durationInFrames".`);
  }
  const { config, frame, offset: parentOffset, frozen: parentFrozen } = useFrameState();
  const local = frame - from;
  const id = useId();
  const depth = useContext(DepthContext);
  useEffect(() => {
    if (!name || !getEnvironment().isStudio) return;
    return addTimelineEntry({ id, name, from: parentOffset + from, durationInFrames, depth });
  }, [id, name, parentOffset, from, durationInFrames, depth]);

  const isPremounting = !getEnvironment().isRendering
    && premountFor > 0
    && local < 0
    && local >= -premountFor;

  if (!isPremounting && (local < 0 || local >= durationInFrames)) {
    return null;
  }

  const effectiveFrame = isPremounting ? 0 : local;
  const effectiveFrozen = isPremounting ? true : parentFrozen;

  const content = (
    <FrameProvider
      config={config}
      frame={effectiveFrame}
      offset={parentOffset + from}
      frozen={effectiveFrozen}
      premounting={isPremounting}
    >
      {getEnvironment().isStudio ? <DepthContext.Provider value={depth + 1}>{children}</DepthContext.Provider> : children}
    </FrameProvider>
  );

  if (isPremounting) {
    const hiddenStyle: CSSProperties = { ...style, visibility: 'hidden' };
    return layout === 'none'
      ? <div style={{ display: 'contents', visibility: 'hidden' }}>{content}</div>
      : <AbsoluteFill style={hiddenStyle}>{content}</AbsoluteFill>;
  }

  return layout === 'none' ? content : <AbsoluteFill style={style}>{content}</AbsoluteFill>;
};

export type SeriesSequenceProps = Omit<SequenceProps, 'from' | 'durationInFrames'> & {
  readonly durationInFrames: number;
  /** Shifts this item (and every item after it) by this many frames. Negative values overlap. */
  readonly offset?: number;
};

const SeriesSequence = ({ children }: SeriesSequenceProps) => <>{children}</>;

/** Plays its `<Series.Sequence>` children one after the other. */
export const Series = ({ children }: { readonly children?: ReactNode }) => {
  const items = Children.toArray(children);
  const sequences: ReactNode[] = [];
  let start = 0;
  for (const [index, child] of items.entries()) {
    if (!isValidElement<SeriesSequenceProps>(child) || child.type !== SeriesSequence) {
      throw new Error('freemotion: <Series> only accepts <Series.Sequence> children.');
    }
    const { durationInFrames, offset = 0, ...rest } = child.props;
    if (!Number.isFinite(durationInFrames) && index < items.length - 1) {
      throw new Error('freemotion: only the last <Series.Sequence> can have an infinite duration.');
    }
    const from = start + offset;
    start = from + durationInFrames;
    sequences.push(<Sequence key={child.key} {...rest} from={from} durationInFrames={durationInFrames} />);
  }
  return <Fragment>{sequences}</Fragment>;
};

Series.Sequence = SeriesSequence;
