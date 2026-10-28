import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';

import type { AnyComposition } from '../runtime/composition.js';
import { Player } from '../runtime/player.js';


const ui = {
  bg: '#09090d',
  panel: '#111117',
  raised: '#1a1a22',
  line: 'rgba(255, 255, 255, 0.08)',
  text: '#ececf1',
  muted: '#8b8b9a',
  accent: '#ff4f7b',
  accent2: '#ffb547',
  error: '#ff6b6b',
};

const font: CSSProperties = {
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 13,
  color: ui.text,
};
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function timecode(frame: number, fps: number): string {
  const seconds = Math.floor(frame / fps);
  const rest = String(Math.floor(frame % fps)).padStart(2, '0');
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${rest}`;
}

function readUrl(list: readonly AnyComposition[]): { composition: AnyComposition | undefined; frame: number } {
  const params = new URLSearchParams(location.search);
  const composition = list.find(item => item.id === params.get('composition')) ?? list[0];
  const frame = Number(params.get('frame')) || 0;
  return { composition, frame: composition ? Math.min(Math.max(0, frame), composition.durationInFrames - 1) : 0 };
}

/** Largest width that fits the available box without going past the native size. */
function useFitWidth(width: number, height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry!.contentRect;
      setFit(Math.max(0, Math.min(width, w, (h * width) / height)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height]);
  return { ref, fit };
}

class ErrorBoundary extends Component<{ readonly children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    return this.state.error ? <ErrorPanel error={this.state.error} /> : this.props.children;
  }
}

export const ErrorPanel = ({ error }: { readonly error: Error }) => (
  <div style={{ ...font, maxWidth: 760, padding: 24, borderRadius: 12, background: ui.raised, boxShadow: `inset 0 0 0 1px ${ui.error}55` }}>
    <div style={{ color: ui.error, fontWeight: 600, marginBottom: 10 }}>{error.message}</div>
    <pre style={{ margin: 0, fontFamily: mono, fontSize: 12, color: ui.muted, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>
      {error.stack}
    </pre>
  </div>
);

const Logo = () => (
  <svg width={22} height={22} viewBox="0 0 32 32" aria-hidden>
    <defs>
      <linearGradient id="fm-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={ui.accent2} />
        <stop offset="1" stopColor={ui.accent} />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#fm-logo)" />
    <path d="M12 10.5v11l9-5.5z" fill="#fff" />
  </svg>
);

const IconButton = ({ label, active, onClick, children }: {
  readonly label: string;
  readonly active?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active}
    onClick={onClick}
    style={{
      width: 34,
      height: 34,
      display: 'grid',
      placeItems: 'center',
      border: 0,
      borderRadius: 8,
      cursor: 'pointer',
      color: active ? ui.accent : ui.text,
      background: active ? `${ui.accent}1f` : ui.raised,
    }}
  >
    {children}
  </button>
);

export const Studio = ({ compositions }: { readonly compositions: readonly AnyComposition[] }) => {
  const [initial] = useState(() => readUrl(compositions));
  const [current, setCurrent] = useState(initial.composition);
  const [frame, setFrame] = useState(initial.frame);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const folders = useMemo(() => [...new Set(compositions.map(item => item.folder ?? ''))], [compositions]);

  const frameRef = useRef(frame);
  useLayoutEffect(() => {
    frameRef.current = frame;
  });

  const last = current ? current.durationInFrames - 1 : 0;
  const { ref, fit } = useFitWidth(current?.width ?? 16, current?.height ?? 9);

  useEffect(() => {
    if (current) {
      history.replaceState(null, '', `?composition=${encodeURIComponent(current.id)}&frame=${frame}`);
    }
  }, [current, frame]);

  useEffect(() => {
    if (!playing || !current) {
      return;
    }
    const startedAt = performance.now();
    // Playing from the last frame starts over.
    const startFrame = frameRef.current >= current.durationInFrames - 1 ? 0 : frameRef.current;
    let raf = requestAnimationFrame(function tick(now) {
      const next = startFrame + Math.floor(((now - startedAt) / 1000) * current.fps);
      if (next > current.durationInFrames - 1 && !loop) {
        setFrame(current.durationInFrames - 1);
        setPlaying(false);
        return;
      }
      setFrame(next % current.durationInFrames);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, current]);

  const seek = useCallback((value: number) => {
    setPlaying(false);
    setFrame(Math.min(Math.max(0, value), last));
  }, [last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!current || event.target instanceof HTMLSelectElement || event.metaKey || event.ctrlKey) {
        return;
      }
      const step = event.shiftKey ? current.fps : 1;
      const actions: Record<string, () => void> = {
        ' ': () => setPlaying(value => !value),
        ArrowLeft: () => seek(frame - step),
        ArrowRight: () => seek(frame + step),
        Home: () => seek(0),
        End: () => seek(last),
        l: () => setLoop(value => !value),
      };
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, frame, last, seek]);

  const choose = (id: string) => {
    const next = compositions.find(item => item.id === id);
    if (next) {
      setCurrent(next);
      setFrame(value => Math.min(value, next.durationInFrames - 1));
    }
  };

  return (
    <div style={{ ...font, height: '100vh', display: 'flex', flexDirection: 'column', background: ui.bg }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', background: ui.panel, borderBottom: `1px solid ${ui.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo />
          <strong style={{ fontSize: 15, letterSpacing: -0.2 }}>freemotion</strong>
          <span style={{ color: ui.muted }}>studio</span>
        </div>
        {current && (
          <select
            aria-label="Composition"
            value={current.id}
            onChange={event => choose(event.target.value)}
            style={{ ...font, background: ui.raised, border: `1px solid ${ui.line}`, borderRadius: 8, padding: '6px 10px' }}
          >
            {folders.map((folder) => {
              const options = compositions.filter(item => (item.folder ?? '') === folder).map(item => (
                <option key={item.id} value={item.id}>{item.id}</option>
              ));
              return folder ? <optgroup key={folder} label={folder}>{options}</optgroup> : options;
            })}
          </select>
        )}
        {current && (
          <span style={{ marginLeft: 'auto', color: ui.muted, fontVariantNumeric: 'tabular-nums' }}>
            {current.width}×{current.height} · {current.fps} fps · {timecode(current.durationInFrames, current.fps)}
            {fit > 0 && ` · ${Math.round((fit / current.width) * 100)}%`}
          </span>
        )}
      </header>

      <main ref={ref} style={{ flex: 1, minHeight: 0, margin: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!current && (
          <div style={{ color: ui.muted, textAlign: 'center', lineHeight: 1.6 }}>
            No compositions yet.<br />
            Export them from your entry file: <code style={{ fontFamily: mono, color: ui.text }}>export default [defineComposition({'{ … }'})]</code>
          </div>
        )}
        {current && fit > 0 && (
          <div style={{ width: fit, boxShadow: '0 24px 70px rgba(0, 0, 0, 0.55)', borderRadius: 4, overflow: 'hidden' }}>
            <ErrorBoundary key={current.id}>
              <Player composition={current} frame={frame} />
            </ErrorBoundary>
          </div>
        )}
      </main>

      {current && (
        <footer style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: ui.panel, borderTop: `1px solid ${ui.line}` }}>
          <IconButton label={playing ? 'Pause (space)' : 'Play (space)'} onClick={() => setPlaying(value => !value)}>
            {playing
              ? <svg width={14} height={14} viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
              : <svg width={14} height={14} viewBox="0 0 14 14"><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>}
          </IconButton>
          <IconButton label="Loop (L)" active={loop} onClick={() => setLoop(value => !value)}>
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V6a2 2 0 0 1 2-2h8m-2-2 2 2-2 2M13 9v1a2 2 0 0 1-2 2H3m2 2-2-2 2-2" />
            </svg>
          </IconButton>
          <input
            type="range"
            aria-label="Timeline"
            min={0}
            max={last}
            value={frame}
            onChange={event => seek(Number(event.target.value))}
            style={{ flex: 1, margin: '0 8px', accentColor: ui.accent }}
          />
          <span style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 200, textAlign: 'right' }}>
            {timecode(frame, current.fps)}
            <span style={{ color: ui.muted }}> · frame {frame} / {last}</span>
          </span>
        </footer>
      )}
    </div>
  );
};
