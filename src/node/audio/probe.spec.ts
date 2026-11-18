import { describe, expect, it } from 'vitest';

import { parseAudioProbeInfo } from './probe.js';


describe('probeAudioMedia / parseAudioProbeInfo', () => {
  it('parses duration, audio stream existence and sample rate from ffmpeg stderr', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample.mp4':
  Duration: 00:01:23.45, start: 0.050000, bitrate: 1200 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
    `;

    const info = parseAudioProbeInfo(stderr);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeCloseTo(83.45);
    expect(info.sampleRate).toBe(48000);
  });

  it('reports hasAudio: false for media without audio stream', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'silent.mp4':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 500 kb/s
  Stream #0:0(eng): Video: hevc (Main), yuv420p(tv), 1280x720, 30 fps
    `;

    const info = parseAudioProbeInfo(stderr);
    expect(info.hasAudio).toBe(false);
    expect(info.duration).toBe(0);
  });

  it('parses audio-only media file like mp3 or wav', () => {
    const stderr = `
Input #0, mp3, from 'track.mp3':
  Duration: 00:03:15.50, start: 0.025000, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
    `;

    const info = parseAudioProbeInfo(stderr);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeCloseTo(195.5);
    expect(info.sampleRate).toBe(44100);
  });
});
