// The page the renderer opens in headless Chromium: it draws one frame at a time, at native size.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import compositions from 'virtual:freemotion/entry';

import { validateCompositions, type AnyComposition } from '../runtime/composition.js';
import { waitForRenderHolds } from '../runtime/delay-render.js';
import { Stage } from '../runtime/stage.js';
import { RENDER_API_GLOBAL, type CompositionMeta, type SvgExportOptions, type SvgExportResult } from '../shared/render-api.js';

import { SvgRecorder } from './svg-recorder.js';


const list = validateCompositions(compositions);
// React 19 reports render errors instead of throwing them out of flushSync(); keep the last one so
// setFrame() can fail with it instead of capturing an empty frame.
let renderError: unknown = null;
const root = createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => {
    renderError = error;
  },
});
let mounted: { composition: AnyComposition; props: Record<string, unknown> } | null = null;

const meta = ({ id, fps, width, height, durationInFrames }: AnyComposition): CompositionMeta => ({ id, fps, width, height, durationInFrames });
const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function mount(id: string, props: Record<string, unknown> | null): CompositionMeta {
  const composition = list.find(item => item.id === id);
  if (!composition) {
    throw new Error(`Unknown composition "${id}". Available: ${list.map(item => item.id).join(', ') || '(none)'}.`);
  }
  mounted = { composition, props: { ...composition.defaultProps, ...props } };
  return meta(composition);
}

async function settle(): Promise<void> {
  await document.fonts.ready;
  await waitForRenderHolds();
  await Promise.all([...document.images].map(img => img.decode().catch(() => undefined)));
}

async function setFrame(frame: number): Promise<void> {
  if (!mounted) {
    throw new Error('mount() must be called before setFrame().');
  }
  const { composition, props } = mounted;
  const Component = composition.component;
  renderError = null;
  flushSync(() => {
    root.render(
      <Stage config={composition} frame={frame}>
        <Component {...props} />
      </Stage>,
    );
  });
  if (renderError) {
    throw renderError;
  }
  await settle();
  await nextPaint();
  // Layout during the paint can start loading a font face or an image that state updates asked for.
  // Settle again until a paint finishes with nothing left to wait for.
  for (let i = 0; i < 3 && document.fonts.status === 'loading'; i++) {
    await settle();
    await nextPaint();
  }
}

let recorder: SvgRecorder | null = null;

function beginSvg(): void {
  recorder = new SvgRecorder();
}

function recordSvgFrame(): void {
  const stage = document.querySelector('[data-freemotion-stage]');
  if (!recorder || !stage) {
    throw new Error('recordSvgFrame() must be called after beginSvg() and setFrame().');
  }
  recorder.record(stage);
}

function finishSvg(options: SvgExportOptions): Promise<SvgExportResult> {
  if (!recorder || !mounted) {
    throw new Error('finishSvg() must be called after beginSvg().');
  }
  const { width, height } = mounted.composition;
  const result = recorder.finish({ ...options, width, height });
  recorder = null;
  return result;
}

async function boot() {
  // With unicode-range, a face is only fetched on first use. Load all of them up front.
  await Promise.all([...document.fonts].map(face => face.load().catch(() => undefined)));
  window[RENDER_API_GLOBAL] = { compositions: list.map(meta), mount, setFrame, beginSvg, recordSvgFrame, finishSvg };
}

void boot();
