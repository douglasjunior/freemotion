import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { Player, type PlayerProps } from './player.js';


/**
 * Which stretch of scrolling plays the video, from frame 0 to the last one:
 * - `sticky`: from the target's start reaching the start of the viewport until its end reaches the
 *   end of the viewport. Made for a tall section holding a `position: sticky` player.
 * - `visible`: from the target entering the viewport until it has left it. Made for a player in the
 *   flow of the page that should advance while it crosses the screen.
 */
export type ScrollRange = 'sticky' | 'visible';

export type ScrollFrameOptions = {
  /** Default `'sticky'`. */
  readonly range?: ScrollRange;
  /** Scroll axis. Default `'y'`. */
  readonly axis?: 'x' | 'y';
  /** Element that scrolls, when it isn't the page itself. */
  readonly container?: RefObject<HTMLElement | null>;
  /**
   * Time constant, in milliseconds, of the easing from the shown frame to the scrolled one, so wheel
   * steps glide instead of jumping. `0` follows the scroll exactly. Default `120`; always `0` when
   * the user prefers reduced motion.
   */
  readonly smoothing?: number;
};

/**
 * Scroll progress in [0, 1] of a target, given where it starts relative to the start of the
 * viewport (negative once scrolled past), its size and the viewport size, along the scroll axis.
 */
export function scrollProgress(start: number, size: number, viewport: number, range: ScrollRange = 'sticky'): number {
  const [traveled, total] = range === 'sticky' ? [-start, size - viewport] : [viewport - start, size + viewport];
  if (total <= 0) {
    return traveled >= 0 ? 1 : 0;
  }
  return Math.min(1, Math.max(0, traveled / total));
}

/**
 * One step of the exponential easing from `shown` to `target` after `elapsed` milliseconds.
 * Frame-rate independent: two 8 ms steps land where one 16 ms step does.
 */
export function easeTowards(shown: number, target: number, elapsed: number, smoothing: number): number {
  if (smoothing <= 0) {
    return target;
  }
  const next = shown + (target - shown) * (1 - Math.exp(-elapsed / smoothing));
  return Math.abs(target - next) < 0.01 ? target : next;
}

/**
 * The frame a scroll position points at, for a `<Player frame={…}>`. The value is fractional while
 * easing; the player rounds it.
 */
export function useScrollFrame(
  target: RefObject<HTMLElement | null>,
  durationInFrames: number,
  { range = 'sticky', axis = 'y', container, smoothing = 120 }: ScrollFrameOptions = {},
): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const scroller: HTMLElement | Window = container?.current ?? window;
    const ease = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : smoothing;
    let goal = 0;
    let shown: number | null = null;
    let last = 0;
    let raf = 0;

    const measure = () => {
      const el = target.current;
      if (!el) {
        return;
      }
      const box = el.getBoundingClientRect();
      const vertical = axis === 'y';
      let viewStart = 0;
      let viewSize = vertical ? innerHeight : innerWidth;
      if (!(scroller instanceof Window)) {
        const rect = scroller.getBoundingClientRect();
        viewStart = vertical ? rect.top : rect.left;
        viewSize = vertical ? rect.height : rect.width;
      }
      const start = (vertical ? box.top : box.left) - viewStart;
      const size = vertical ? box.height : box.width;
      goal = scrollProgress(start, size, viewSize, range) * (durationInFrames - 1);
    };

    const tick = (now: number) => {
      // The first measurement jumps straight to the scroll position (e.g. after a reload mid-page).
      shown = shown === null ? goal : easeTowards(shown, goal, Math.min(64, now - last), ease);
      last = now;
      setFrame(shown);
      raf = shown === goal ? 0 : requestAnimationFrame(tick);
    };

    const update = () => {
      measure();
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    update();
    scroller.addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    return () => {
      scroller.removeEventListener('scroll', update);
      removeEventListener('resize', update);
      cancelAnimationFrame(raf);
    };
  }, [target, durationInFrames, range, axis, container, smoothing]);

  return frame;
}

export type ScrollPlayerProps<Props extends object> = Omit<PlayerProps<Props>, 'frame' | 'autoPlay' | 'loop' | 'playbackRate' | 'onFrameChange' | 'style' | 'className'> & {
  /** Height of the scrolling section: the longer, the slower the video advances. Default `'400vh'`. */
  readonly scrollLength?: CSSProperties['height'];
  readonly smoothing?: number;
  /** Called with the frame shown, e.g. to sync captions outside the video. */
  readonly onFrameChange?: (frame: number) => void;
  /** Style of the sticky box that holds the player (centered in the viewport by default). */
  readonly stickyStyle?: CSSProperties;
  /** Width of the player. Default: as large as fits the viewport, keeping the aspect ratio. */
  readonly width?: CSSProperties['width'];
  /** Style of the player itself (e.g. rounded corners, a shadow). */
  readonly playerStyle?: CSSProperties;
  readonly className?: string;
  /** Rendered in the sticky box, next to the player. */
  readonly children?: ReactNode;
};

/**
 * A section that plays a composition as the page scrolls: the player sticks to the viewport while
 * the section scrolls by, then leaves with the page.
 */
export function ScrollPlayer<Props extends object>({
  composition,
  inputProps,
  scrollLength = '400vh',
  smoothing,
  onFrameChange,
  stickyStyle,
  width,
  playerStyle,
  className,
  children,
}: ScrollPlayerProps<Props>) {
  const section = useRef<HTMLElement>(null);
  const frame = useScrollFrame(section, composition.durationInFrames, { smoothing });
  const onFrameChangeRef = useRef(onFrameChange);

  useEffect(() => {
    onFrameChangeRef.current = onFrameChange;
  });
  useEffect(() => {
    onFrameChangeRef.current?.(Math.round(frame));
  }, [frame]);

  const ratio = composition.width / composition.height;
  return (
    <section ref={section} className={className} style={{ position: 'relative', height: scrollLength }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          ...stickyStyle,
        }}
      >
        <div style={{ width: width ?? `min(100%, 100vh * ${ratio})` }}>
          <Player composition={composition} inputProps={inputProps} frame={frame} style={playerStyle} />
        </div>
        {children}
      </div>
    </section>
  );
}
