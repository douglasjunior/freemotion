import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { Composition } from './composition.js';
import { Stage } from './stage.js';


export type PlayerProps<Props extends object> = {
  readonly composition: Composition<Props>;
  /** Merged over the composition's `defaultProps`. */
  readonly inputProps?: Partial<Props>;
  /**
   * Controlled mode: the frame to show. Drive it from anything (a slider, the page scroll, a timer)
   * and the player only draws. Leave it out to let the player keep time itself.
   */
  readonly frame?: number;
  /** Uncontrolled mode: start playing on mount. Default `false`. */
  readonly autoPlay?: boolean;
  /** Uncontrolled mode: start over after the last frame. Default `true`. */
  readonly loop?: boolean;
  /** Uncontrolled mode: speed multiplier. Default `1`. */
  readonly playbackRate?: number;
  /** Called with every new frame while playing in uncontrolled mode. */
  readonly onFrameChange?: (frame: number) => void;
  readonly style?: CSSProperties;
  readonly className?: string;
};

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Fits the composition to the width of its container, keeping the aspect ratio. */
export function Player<Props extends object>({
  composition,
  inputProps,
  frame,
  autoPlay = false,
  loop = true,
  playbackRate = 1,
  onFrameChange,
  style,
  className,
}: PlayerProps<Props>) {
  const { width, height, fps, durationInFrames, component: Component } = composition;
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [ownFrame, setOwnFrame] = useState(0);
  const onFrameChangeRef = useRef(onFrameChange);

  useIsomorphicLayoutEffect(() => {
    onFrameChangeRef.current = onFrameChange;
  });

  useIsomorphicLayoutEffect(() => {
    const el = container.current;
    if (!el) {
      return;
    }
    const measure = () => setScale(el.clientWidth / width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  const controlled = frame !== undefined;
  useEffect(() => {
    if (controlled || !autoPlay) {
      return;
    }
    const startedAt = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const elapsed = Math.floor(((now - startedAt) / 1000) * fps * playbackRate);
      const next = loop ? elapsed % durationInFrames : Math.min(elapsed, durationInFrames - 1);
      setOwnFrame(next);
      onFrameChangeRef.current?.(next);
      if (loop || next < durationInFrames - 1) {
        raf = requestAnimationFrame(tick);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [controlled, autoPlay, loop, playbackRate, fps, durationInFrames]);

  const props = useMemo(() => ({ ...composition.defaultProps, ...inputProps }) as Props, [composition.defaultProps, inputProps]);
  const shown = Math.min(Math.max(0, Math.round(controlled ? frame : ownFrame)), durationInFrames - 1);

  return (
    <div
      ref={container}
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: `${width} / ${height}`, overflow: 'hidden', ...style }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          transform: `scale(${scale ?? 1})`,
          visibility: scale === null ? 'hidden' : undefined,
        }}
      >
        <Stage config={composition} frame={shown}>
          <Component {...props} />
        </Stage>
      </div>
    </div>
  );
}
