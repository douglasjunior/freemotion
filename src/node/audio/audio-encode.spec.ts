import { describe, expect, it } from 'vitest';

import { audioEncodeArgs, muxArgs } from './audio-encode.js';


describe('audio-encode', () => {
  describe('audioEncodeArgs', () => {
    it('defaults to aac 192k 48000 Hz stereo', () => {
      expect(audioEncodeArgs()).toEqual([
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
      ]);
    });

    it('supports libopus with 128k', () => {
      expect(audioEncodeArgs({ codec: 'libopus' })).toEqual([
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
      ]);
    });

    it('supports pcm_s16le', () => {
      expect(audioEncodeArgs({ codec: 'pcm' })).toEqual([
        '-c:a', 'pcm_s16le',
        '-ar', '48000',
        '-ac', '2',
      ]);
    });
  });

  describe('muxArgs', () => {
    it('adds +faststart for mp4', () => {
      expect(muxArgs({ format: 'mp4' })).toEqual(['-c', 'copy', '-movflags', '+faststart']);
    });

    it('omits +faststart for webm', () => {
      expect(muxArgs({ format: 'webm' })).toEqual(['-c', 'copy']);
    });
  });
});
