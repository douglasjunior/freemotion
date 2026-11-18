import { describe, expect, it } from 'vitest';

import { mergeAudioAssets } from './audio-merge.js';
import type { AudioAsset } from './render-api.js';


describe('mergeAudioAssets', () => {
  const asset1TabA: AudioAsset = {
    id: 'asset1',
    src: 'bg.mp3',
    startFrame: 0,
    trimBefore: 0,
    playbackRate: 1,
    loop: false,
    volumes: [[0, 0.5], [2, 0.7]],
  };

  const asset1TabB: AudioAsset = {
    id: 'asset1',
    src: 'bg.mp3',
    startFrame: 0,
    trimBefore: 0,
    playbackRate: 1,
    loop: false,
    volumes: [[1, 0.6], [3, 0.8]],
  };

  it('merges interleaved frames from multiple tabs into ordered volume list', () => {
    const merged = mergeAudioAssets([[asset1TabA], [asset1TabB]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('asset1');
    expect(merged[0]!.volumes).toEqual([
      [0, 0.5],
      [1, 0.6],
      [2, 0.7],
      [3, 0.8],
    ]);
  });

  it('deduplicates duplicate frames across tabs with matching volumes', () => {
    const tabA: AudioAsset = { ...asset1TabA, volumes: [[0, 0.5], [1, 0.6]] };
    const tabB: AudioAsset = { ...asset1TabA, volumes: [[1, 0.6], [2, 0.7]] };

    const merged = mergeAudioAssets([[tabA], [tabB]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.volumes).toEqual([
      [0, 0.5],
      [1, 0.6],
      [2, 0.7],
    ]);
  });

  it('throws an error if the same asset id has conflicting metadata', () => {
    const conflictingTabB: AudioAsset = {
      ...asset1TabB,
      playbackRate: 2, // Conflict!
    };

    expect(() => mergeAudioAssets([[asset1TabA], [conflictingTabB]])).toThrow(
      /conflicting audio asset metadata for id "asset1"/,
    );
  });

  it('throws an error if the same asset id has conflicting volume for the same frame', () => {
    const conflictingTabB: AudioAsset = {
      ...asset1TabB,
      volumes: [[0, 0.9]], // Frame 0 has volume 0.5 in Tab A and 0.9 in Tab B
    };

    expect(() => mergeAudioAssets([[asset1TabA], [conflictingTabB]])).toThrow(
      /conflicting volume values for audio asset "asset1" at frame 0/,
    );
  });
});
