type RenderContextState = {
  videoServerUrl: string | null;
};

const state: RenderContextState = {
  videoServerUrl: null,
};

/** Sets render-time context injected into the render page. */
export function setRenderContext(options: { readonly videoServerUrl?: string | null }): void {
  state.videoServerUrl = options.videoServerUrl ?? null;
}

/** Gets the video frame server URL, or null if not set. */
export function getVideoServerUrl(): string | null {
  return state.videoServerUrl;
}

/** Resets the render context state (for tests). */
export function resetRenderContext(): void {
  state.videoServerUrl = null;
}
