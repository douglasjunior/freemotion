// Contract between the render page (running in Chromium) and the renderer (running in Node).

export type CompositionMeta = {
  readonly id: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly durationInFrames: number;
};

export type RenderPageApi = {
  readonly compositions: readonly CompositionMeta[];
  /** Selects the composition (props merged over its defaults) for the next `setFrame()` calls. */
  readonly mount: (id: string, props: Record<string, unknown> | null) => CompositionMeta;
  /** Draws the frame and resolves once fonts, images, render holds and the paint are done. */
  readonly setFrame: (frame: number) => Promise<void>;
};

export const RENDER_API_GLOBAL = '__freemotion';

declare global {
  interface Window {
    [RENDER_API_GLOBAL]?: RenderPageApi;
  }
}
