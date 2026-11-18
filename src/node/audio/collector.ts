import { mergeAudioAssets } from '../../shared/audio-merge.js';
import type { AudioAsset } from '../../shared/render-api.js';
import { RENDER_API_GLOBAL } from '../../shared/render-api.js';


export interface AudioCollectorPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate(pageFunction: any, arg?: any): Promise<any>;
}

/**
 * Accumulates audio assets collected across browser tabs or tab recycling batches,
 * and merges them via `mergeAudioAssets`.
 */
export class AudioCollector {
  private readonly collections: (readonly AudioAsset[])[] = [];

  /** Adds a batch of audio assets collected from a render page or tab. */
  add(assets: readonly AudioAsset[]): void {
    if (assets.length > 0) {
      this.collections.push(assets);
    }
  }

  /**
   * Evaluates `collectAudio()` on a Playwright page or CDP session, records the assets
   * in this collector, and returns them.
   */
  async collect(page: AudioCollectorPage): Promise<AudioAsset[]> {
    const assets = (await page.evaluate(
      (name: string) => (window as unknown as Record<string, { collectAudio: () => AudioAsset[] }>)[name]!.collectAudio(),
      RENDER_API_GLOBAL,
    )) as AudioAsset[];
    this.add(assets);
    return assets;
  }

  /** Merges all accumulated partial collections across tabs and batches. */
  getAssets(): AudioAsset[] {
    return mergeAudioAssets(this.collections);
  }

  /** Clears all accumulated collections. */
  clear(): void {
    this.collections.length = 0;
  }
}
