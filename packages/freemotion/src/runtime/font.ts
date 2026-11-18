import { cancelRender, continueRender, delayRender } from './delay-render.js';


export type LoadFontOptions = {
  readonly family: string;
  readonly url: string;
  readonly weight?: string | number;
  readonly style?: string;
  readonly display?: FontDisplay;
};

const cache = new Map<string, Promise<void>>();

/**
 * Loads a font via `FontFace`, adds it to `document.fonts`, and holds rendering
 * until it has loaded.
 *
 * Calls with the same parameters are deduplicated. In non-browser environments
 * (SSR or Node without DOM), this resolves immediately.
 */
export function loadFont({ family, url, weight, style, display }: LoadFontOptions): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') {
    return Promise.resolve();
  }

  const key = `${family}|${url}|${weight ?? ''}|${style ?? ''}`;
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const handle = delayRender(`Loading font "${family}" from "${url}"`);

  const promise = (async () => {
    try {
      const descriptors: FontFaceDescriptors = {
        ...(weight !== undefined && { weight: String(weight) }),
        ...(style !== undefined && { style }),
        ...(display !== undefined && { display }),
      };
      const face = new FontFace(family, `url(${url})`, descriptors);
      document.fonts.add(face);
      await face.load();
      continueRender(handle);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error = new Error(`Failed to load font "${family}" from "${url}": ${message}`);
      cancelRender(error);
      continueRender(handle);
      throw error;
    }
  })();

  cache.set(key, promise);
  return promise;
}

/** Clears the cache of loaded fonts. For tests. */
export function resetFontCache(): void {
  cache.clear();
}
