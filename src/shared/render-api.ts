// Contract between the render page (running in Chromium) and the renderer (running in Node).

export type CompositionMeta = {
  readonly id: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly durationInFrames: number;
};

export type SvgExportOptions = {
  /** Frames per second of the output (already divided by `--every-nth-frame`). */
  readonly fps: number;
  readonly loop: boolean;
};

export type SvgExportResult = {
  readonly svg: string;
  /** Things the SVG can't carry (a resource that couldn't be embedded, a stylesheet that couldn't be read). */
  readonly warnings: readonly string[];
};

export type RenderPageApi = {
  readonly compositions: readonly CompositionMeta[];
  /** Selects the composition (props merged over its defaults) for the next `setFrame()` calls. */
  readonly mount: (id: string, props: Record<string, unknown> | null) => CompositionMeta;
  /** Draws the frame and resolves once fonts, images, render holds and the paint are done. */
  readonly setFrame: (frame: number) => Promise<void>;
  /** Animated SVG: `beginSvg()` once, `recordSvgFrame()` after each `setFrame()`, then `finishSvg()` builds the file. */
  readonly beginSvg: () => void;
  readonly recordSvgFrame: () => void;
  readonly finishSvg: (options: SvgExportOptions) => Promise<SvgExportResult>;
};

export const RENDER_API_GLOBAL = '__freemotion';

declare global {
  interface Window {
    [RENDER_API_GLOBAL]?: RenderPageApi;
  }
}
