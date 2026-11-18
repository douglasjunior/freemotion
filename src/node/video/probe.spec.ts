import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearProbeCache, parseFfmpegInfo, probeMedia } from './probe.js';


const hasFfmpeg = (() => {
  try {
    const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
})();


describe('parseFfmpegInfo', () => {
  it('parses standard 30 fps video with audio', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample.mp4':
  Duration: 00:01:23.45, start: 0.050000, bitrate: 1200 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 1100 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
    `;

    const info = parseFfmpegInfo(stderr);
    expect(info.fps).toBe(30);
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.duration).toBeCloseTo(83.45);
    expect(info.start).toBeCloseTo(0.05);
    expect(info.codec).toBe('h264');
    expect(info.pixFmt).toBe('yuv420p');
    expect(info.hasAlpha).toBe(false);
    expect(info.hasAudio).toBe(true);
  });

  it('parses 29.97 fps video without audio', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 500 kb/s
  Stream #0:0(eng): Video: hevc (Main), yuv420p(tv), 1280x720, 29.97 fps, 29.97 tbr, 30k tbn
    `;

    const info = parseFfmpegInfo(stderr);
    expect(info.fps).toBe(29.97);
    expect(info.width).toBe(1280);
    expect(info.height).toBe(720);
    expect(info.duration).toBe(10);
    expect(info.start).toBe(0);
    expect(info.codec).toBe('hevc');
    expect(info.hasAlpha).toBe(false);
    expect(info.hasAudio).toBe(false);
  });

  it('parses 60 fps from tbr fallback when fps is omitted', () => {
    const stderr = `
Input #0, lavfi, from 'testsrc2':
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0: Video: rawvideo (I420 / 0x30323449), yuv420p, 64x64 [SAR 1:1 DAR 1:1], 60 tbr, 60 tbn
    `;

    const info = parseFfmpegInfo(stderr);
    expect(info.fps).toBe(60);
    expect(info.width).toBe(64);
    expect(info.height).toBe(64);
    expect(info.duration).toBe(0);
    expect(info.hasAlpha).toBe(false);
    expect(info.hasAudio).toBe(false);
  });

  it('detects alpha channel for yuva420p and rgba', () => {
    const vp9Yuva = `
Input #0, matroska,webm, from 'trans.webm':
  Duration: 00:00:05.00, start: 0.000000, bitrate: 800 kb/s
  Stream #0:0: Video: vp9 (Profile 0), yuva420p(tv), 1280x720, 30 fps, 30 tbr, 1k tbn (default)
    `;
    expect(parseFfmpegInfo(vp9Yuva).hasAlpha).toBe(true);

    const movRgba = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'alpha.mov':
  Duration: 00:00:03.00, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0(und): Video: qtrle, rgba, 640x480, 24 fps, 24 tbr, 24 tbn
    `;
    expect(parseFfmpegInfo(movRgba).hasAlpha).toBe(true);

    const vp9AlphaMode = `
Input #0, matroska,webm, from 'vp9alpha.webm':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 400 kb/s
  Stream #0:0(eng): Video: vp9, yuv420p(tv), 640x360, 30 fps, 30 tbr, 1k tbn (default)
    Metadata:
      alpha_mode      : 1
    `;
    expect(parseFfmpegInfo(vp9AlphaMode).hasAlpha).toBe(true);
  });

  it('throws an error when no video stream is present', () => {
    const audioOnly = `
Input #0, mp3, from 'audio.mp3':
  Duration: 00:03:00.00, start: 0.000000, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
    `;
    expect(() => parseFfmpegInfo(audioOnly)).toThrow(/no video stream/);
  });
});

describe('probeMedia', () => {
  let tmpDir: string;
  let sampleVideo: string;

  beforeAll(() => {
    if (!hasFfmpeg) {
      return;
    }
    tmpDir = mkdtempSync(join(tmpdir(), 'probe-test-'));
    sampleVideo = join(tmpDir, 'test_probe.mp4');
    spawnSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=64x64:rate=30',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      sampleVideo,
    ], { stdio: 'ignore' });
  });

  afterAll(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    clearProbeCache();
  });

  it.runIf(hasFfmpeg)('reads metadata using real ffmpeg and caches the result', async () => {
    const info = await probeMedia(sampleVideo);
    expect(info.fps).toBe(30);
    expect(info.width).toBe(64);
    expect(info.height).toBe(64);
    expect(info.duration).toBeCloseTo(2.0, 1);
    expect(info.codec).toBe('h264');

    // Calling again returns cached object without re-spawning
    const cached = await probeMedia(sampleVideo);
    expect(cached).toBe(info);
  });
});
