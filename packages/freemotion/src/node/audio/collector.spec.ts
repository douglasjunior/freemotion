import { describe, expect, it, vi } from 'vitest';

import type { AudioAsset } from '../../shared/render-api.js';
import { RENDER_API_GLOBAL } from '../../shared/render-api.js';

import { AudioCollector } from './collector.js';


describe('AudioCollector', () => {
  it('accumulates and merges partial collections across tabs', () => {
    const collector = new AudioCollector();

    const partialTab1: AudioAsset[] = [
      {
        id: 'voiceover',
        src: 'voice.wav',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [
          [0, 1],
          [1, 1],
          [2, 0.8],
        ],
      },
    ];

    const partialTab2: AudioAsset[] = [
      {
        id: 'voiceover',
        src: 'voice.wav',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [
          [3, 0.5],
          [4, 0.2],
        ],
      },
      {
        id: 'sfx',
        src: 'sfx.wav',
        startFrame: 10,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[10, 1]],
      },
    ];

    collector.add(partialTab1);
    collector.add(partialTab2);

    const merged = collector.getAssets();
    expect(merged).toHaveLength(2);

    const voiceover = merged.find(a => a.id === 'voiceover');
    expect(voiceover).toBeDefined();
    expect(voiceover?.volumes).toEqual([
      [0, 1],
      [1, 1],
      [2, 0.8],
      [3, 0.5],
      [4, 0.2],
    ]);

    const sfx = merged.find(a => a.id === 'sfx');
    expect(sfx).toBeDefined();
    expect(sfx?.volumes).toEqual([[10, 1]]);
  });

  it('throws on conflicting metadata across tabs', () => {
    const collector = new AudioCollector();

    collector.add([
      {
        id: 'track1',
        src: 'a.wav',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[0, 1]],
      },
    ]);

    collector.add([
      {
        id: 'track1',
        src: 'b.wav', // conflicting src
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[1, 1]],
      },
    ]);

    expect(() => collector.getAssets()).toThrow(/conflicting audio asset metadata/);
  });

  it('clears accumulated collections', () => {
    const collector = new AudioCollector();
    collector.add([
      {
        id: 'track',
        src: 'a.wav',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[0, 1]],
      },
    ]);
    expect(collector.getAssets()).toHaveLength(1);

    collector.clear();
    expect(collector.getAssets()).toEqual([]);
  });

  it('evaluates collectAudio on a mock page', async () => {
    const collector = new AudioCollector();
    const mockAssets: AudioAsset[] = [
      {
        id: 'track',
        src: 'a.wav',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[0, 1]],
      },
    ];

    const mockPage = {
      evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
        expect(arg).toBe(RENDER_API_GLOBAL);
        return mockAssets;
      }),
    };

    const result = await collector.collect(mockPage);
    expect(result).toEqual(mockAssets);
    expect(collector.getAssets()).toEqual(mockAssets);
  });
});
