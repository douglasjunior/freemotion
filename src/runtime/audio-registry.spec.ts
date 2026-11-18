import { beforeEach, describe, expect, it } from 'vitest';

import {
  audioAssetId,
  beginAudioFrame,
  cleanAudioSrc,
  clearAudioRegistry,
  collectAudio,
  registerAudio,
} from './audio-registry.js';


describe('audio-registry', () => {
  beforeEach(() => {
    clearAudioRegistry();
  });

  describe('cleanAudioSrc', () => {
    it('normalizes paths, decodes percent-encoded characters, strips query/hash, and preserves host for remote URLs', () => {
      expect(cleanAudioSrc('/music/song.mp3')).toBe('music/song.mp3');
      expect(cleanAudioSrc('sound.wav?v=2#t=10')).toBe('sound.wav');
      expect(cleanAudioSrc('my%20song.mp3')).toBe('my song.mp3');
      expect(cleanAudioSrc('folder%2Fsub%20track.wav?test=1')).toBe('folder/sub track.wav');
      expect(cleanAudioSrc('https://a.com/assets/sound%201.mp3?v=1')).toBe('https://a.com/assets/sound 1.mp3');
      expect(cleanAudioSrc('https://b.com/assets/sound%201.mp3')).toBe('https://b.com/assets/sound 1.mp3');
    });
  });

  describe('audioAssetId', () => {
    it('is stable for identical inputs', () => {
      const id1 = audioAssetId({ src: 'music.mp3', startFrame: 0, trimBefore: 15, playbackRate: 1 });
      const id2 = audioAssetId({ src: 'music.mp3', startFrame: 0, trimBefore: 15, playbackRate: 1 });
      expect(id1).toBe(id2);
    });

    it('differs when startFrame, src, playbackRate or trim change', () => {
      const base = { src: 'music.mp3', startFrame: 0, trimBefore: 0, playbackRate: 1 };
      expect(audioAssetId({ ...base, src: 'other.mp3' })).not.toBe(audioAssetId(base));
      expect(audioAssetId({ ...base, startFrame: 10 })).not.toBe(audioAssetId(base));
      expect(audioAssetId({ ...base, playbackRate: 2 })).not.toBe(audioAssetId(base));
      expect(audioAssetId({ ...base, trimBefore: 30 })).not.toBe(audioAssetId(base));
      expect(audioAssetId({ ...base, trimAfter: 60 })).not.toBe(audioAssetId(base));
      expect(audioAssetId({ ...base, loop: true })).not.toBe(audioAssetId(base));
    });

    it('separates duplicates using ordinal', () => {
      const id0 = audioAssetId({ src: 'music.mp3', startFrame: 0, ordinal: 0 });
      const id1 = audioAssetId({ src: 'music.mp3', startFrame: 0, ordinal: 1 });
      expect(id0).not.toBe(id1);
    });
  });

  describe('registerAudio & collectAudio', () => {
    it('generates 1 asset with volumes sorted when frames are recorded out of order', () => {
      // Record frame 5, then frame 1, then frame 3
      beginAudioFrame();
      registerAudio({ src: 'voice.mp3', offset: 10, frame: 5, volume: 0.5 });

      beginAudioFrame();
      registerAudio({ src: 'voice.mp3', offset: 10, frame: 1, volume: 0.1 });

      beginAudioFrame();
      registerAudio({ src: 'voice.mp3', offset: 10, frame: 3, volume: 0.3 });

      const assets = collectAudio();
      expect(assets).toHaveLength(1);
      expect(assets[0]!.src).toBe('voice.mp3');
      expect(assets[0]!.startFrame).toBe(10);
      expect(assets[0]!.volumes).toEqual([
        [11, 0.1],
        [13, 0.3],
        [15, 0.5],
      ]);
    });

    it('separates two identical audio assets in the same frame and preserves identity across frames', () => {
      // Frame 0: two identical audio tracks
      beginAudioFrame();
      registerAudio({ src: 'bg.mp3', offset: 0, frame: 0, volume: 0.8 });
      registerAudio({ src: 'bg.mp3', offset: 0, frame: 0, volume: 0.4 });

      // Frame 1: same two audio tracks
      beginAudioFrame();
      registerAudio({ src: 'bg.mp3', offset: 0, frame: 1, volume: 0.9 });
      registerAudio({ src: 'bg.mp3', offset: 0, frame: 1, volume: 0.5 });

      const assets = collectAudio();
      expect(assets).toHaveLength(2);

      const [first, second] = assets;
      expect(first!.id).not.toBe(second!.id);
      expect(first!.volumes).toEqual([[0, 0.8], [1, 0.9]]);
      expect(second!.volumes).toEqual([[0, 0.4], [1, 0.5]]);
    });

    it('clears the registry upon calling collectAudio()', () => {
      beginAudioFrame();
      registerAudio({ src: 'test.mp3', offset: 0, frame: 0, volume: 1 });

      const firstCollection = collectAudio();
      expect(firstCollection).toHaveLength(1);

      const secondCollection = collectAudio();
      expect(secondCollection).toHaveLength(0);
    });

    it('safely coerces non-finite or negative volumes to 0', () => {
      beginAudioFrame();
      registerAudio({ src: 'safe.mp3', offset: 0, frame: 0, volume: Number.NaN });

      beginAudioFrame();
      registerAudio({ src: 'safe.mp3', offset: 0, frame: 1, volume: -5 });

      beginAudioFrame();
      registerAudio({ src: 'safe.mp3', offset: 0, frame: 2, volume: Number.POSITIVE_INFINITY });

      const assets = collectAudio();
      expect(assets).toHaveLength(1);
      expect(assets[0]!.volumes).toEqual([
        [0, 0],
        [1, 0],
        [2, 0],
      ]);
    });

    it('updates volume in-place on same-frame re-render when ordinal is passed', () => {
      beginAudioFrame();
      const first = registerAudio({ src: 'track.mp3', offset: 0, frame: 0, volume: 0.2 });
      expect(first.ordinal).toBe(0);

      // Re-render in the same frame passing existing ordinal
      const updated = registerAudio({
        src: 'track.mp3',
        offset: 0,
        frame: 0,
        volume: 0.8,
        ordinal: first.ordinal,
      });

      expect(updated.id).toBe(first.id);
      const assets = collectAudio();
      expect(assets).toHaveLength(1);
      expect(assets[0]!.volumes).toEqual([[0, 0.8]]);
    });
  });
});
