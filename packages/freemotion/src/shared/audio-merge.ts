import type { AudioAsset, AudioVolumeEntry } from './render-api.js';


/**
 * Merges lists of audio assets collected across multiple render page tabs or chunks.
 * Groups assets by their stable `id`, merges and sorts observed volume entries by frame,
 * and throws if conflicting metadata is detected for the same asset id.
 */
export function mergeAudioAssets(lists: readonly (readonly AudioAsset[])[]): AudioAsset[] {
  const merged = new Map<string, AudioAsset>();

  for (const list of lists) {
    for (const asset of list) {
      const existing = merged.get(asset.id);
      if (!existing) {
        merged.set(asset.id, {
          ...asset,
          volumes: [...asset.volumes],
        });
        continue;
      }

      // Check for metadata conflicts
      if (
        existing.src !== asset.src
        || existing.startFrame !== asset.startFrame
        || existing.trimBefore !== asset.trimBefore
        || existing.trimAfter !== asset.trimAfter
        || existing.playbackRate !== asset.playbackRate
        || existing.loop !== asset.loop
      ) {
        throw new Error(
          `freemotion: conflicting audio asset metadata for id "${asset.id}". `
          + `Existing: ${JSON.stringify({ src: existing.src, startFrame: existing.startFrame, trimBefore: existing.trimBefore, trimAfter: existing.trimAfter, playbackRate: existing.playbackRate, loop: existing.loop })}; `
          + `Incoming: ${JSON.stringify({ src: asset.src, startFrame: asset.startFrame, trimBefore: asset.trimBefore, trimAfter: asset.trimAfter, playbackRate: asset.playbackRate, loop: asset.loop })}`,
        );
      }

      // Merge volume entries deduplicating by frame
      const volumeMap = new Map<number, number>();
      for (const [f, v] of existing.volumes) {
        volumeMap.set(f, v);
      }
      for (const [f, v] of asset.volumes) {
        const prevVol = volumeMap.get(f);
        if (prevVol !== undefined && Math.abs(prevVol - v) > 1e-5) {
          throw new Error(
            `freemotion: conflicting volume values for audio asset "${asset.id}" at frame ${f}: ${prevVol} vs ${v}.`,
          );
        }
        volumeMap.set(f, v);
      }

      const mergedVolumes: AudioVolumeEntry[] = Array.from(volumeMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([f, v]) => [f, v]);

      merged.set(asset.id, {
        ...existing,
        volumes: mergedVolumes,
      });
    }
  }

  return Array.from(merged.values());
}
