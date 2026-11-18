import { Canvas, useThree, type CanvasProps } from '@react-three/fiber';
import { cancelRender, continueRender, delayRender, getEnvironment, useContextBridge, useCurrentFrame, useVideoConfig } from 'freemotion';
import { Component, Suspense, useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { WebGLRenderer, type WebGLRendererParameters } from 'three';


export type ThreeCanvasProps = Omit<CanvasProps, 'frameloop' | 'gl'> & {
  readonly gl?: Partial<WebGLRendererParameters>;
  readonly width: number;
  readonly height: number;
  readonly children?: ReactNode;
};

export const frameToSeconds = (frame: number, fps: number) => frame / fps;

export function HoldFallback() {
  useLayoutEffect(() => {
    if (!getEnvironment().isRendering) return;
    const handle = delayRender('ThreeCanvas Suspense');
    return () => {
      continueRender(handle);
    };
  }, []);
  return null;
}

class ErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { cancelRender(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

function FrameDriver({ release }: { readonly release: (frame: number) => void }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const advance = useThree(state => state.advance);
  useLayoutEffect(() => {
    advance(frameToSeconds(frame, fps));
    release(frame);
  }, [advance, frame, fps, release]);
  return null;
}

export function ThreeCanvas({ width, height, children, style, gl, ...props }: ThreeCanvasProps) {
  const frame = useCurrentFrame();
  const pending = useRef(new Map<number, number>());
  const release = useCallback((completed: number) => {
    for (const [number, handle] of pending.current) {
      if (number <= completed) {
        continueRender(handle);
        pending.current.delete(number);
      }
    }
  }, []);
  useLayoutEffect(() => {
    if (!getEnvironment().isRendering) return;
    const handle = delayRender(`ThreeCanvas frame ${frame}`);
    const holds = pending.current;
    holds.set(frame, handle);
    return () => {
      continueRender(handle);
      holds.delete(frame);
    };
  }, [frame]);
  const Bridge = useContextBridge();
  return (
    <ErrorBoundary>
      <Canvas
        {...props}
        frameloop="never"
        gl={(defaults) => {
          try {
            return new WebGLRenderer({ ...defaults, preserveDrawingBuffer: true, ...gl });
          } catch (cause) {
            throw new Error('freemotion: Failed to initialize WebGL context for <ThreeCanvas>. If you are running in a headless or CI environment without a GPU, pass the \'--gl swangle\' flag to freemotion render.', { cause });
          }
        }}
        style={{ width, height, ...style }}
        resize={{ offsetSize: true, scroll: false, debounce: 0 }}
      >
        {/* The bridge hook returns a stable component. */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Bridge>
          <Suspense fallback={<HoldFallback />}>
            {children}
            <FrameDriver release={release} />
          </Suspense>
        </Bridge>
      </Canvas>
    </ErrorBoundary>
  );
}
