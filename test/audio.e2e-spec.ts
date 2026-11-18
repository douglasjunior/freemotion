import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  computeRms,
  FIXTURE,
  hasEncoder,
  probeAudioStreams,
  readPcmMono,
  run,
} from './helpers.js';


const OUT = join(FIXTURE, 'out');
const CLIPS_DIR = join(FIXTURE, 'public', 'clips');
const TONE_WAV = join(CLIPS_DIR, 'tone.wav');
const CLIP_AUDIO_MP4 = join(CLIPS_DIR, 'clip_audio.mp4');

function findOnsetSample(pcm: Float32Array, threshold = 0.05): number {
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]!) >= threshold) {
      return i;
    }
  }
  return -1;
}

describe('Audio rendering pipeline e2e', () => {
  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    mkdirSync(CLIPS_DIR, { recursive: true });

    // Generate 1 kHz sine tone WAV (4 seconds)
    const resTone = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=4',
      '-af',
      'volume=8',
      '-c:a',
      'pcm_s16le',
      TONE_WAV,
    ]);
    if (resTone.status !== 0) {
      throw new Error(`Failed to generate tone WAV: ${resTone.stderr?.toString()}`);
    }

    // Generate video clip with 440 Hz audio (2 seconds)
    const resClip = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:r=30:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-af',
      'volume=8',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-shortest',
      CLIP_AUDIO_MP4,
    ]);
    if (resClip.status !== 0) {
      throw new Error(`Failed to generate video with audio: ${resClip.stderr?.toString()}`);
    }
  });

  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(CLIPS_DIR, { recursive: true, force: true });
  });

  it('aligns narration track onset at expected frame (±1 frame threshold)', async () => {
    const output = join(OUT, 'NarrationAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'NarrationAudio', '--entry', 'src/audio.tsx', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const audioStreams = probeAudioStreams(output);
    expect(audioStreams).toHaveLength(1);
    expect(audioStreams[0]).toMatchObject({
      codec_name: 'aac',
      sample_rate: '48000',
      channels: 2,
    });

    const pcm = readPcmMono(output);
    // 60 frames at 30 fps = 2.0s = 96000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(96000, -3);

    // Frame 30 onset at 48 kHz is at sample 48000 (1 frame = 1600 samples)
    const onset = findOnsetSample(pcm);
    expect(onset).toBeGreaterThanOrEqual(0);
    expect(Math.abs(onset - 48000)).toBeLessThanOrEqual(1600);

    // Frame 30 onset: before frame 29 (sample 46400), should be near silent
    const preOnsetRms = computeRms(pcm, 0, 46400);
    expect(preOnsetRms).toBeLessThan(0.01);

    // Active tone between 1.05s and 1.8s (sample 50400 to 86400)
    const activeRms = computeRms(pcm, 50400, 86400);
    expect(activeRms).toBeGreaterThan(0.5);
  });

  it('tracks dynamic volume envelope (ducking and fade)', async () => {
    const output = join(OUT, 'MusicEnvelope.mp4');
    const { code, stderr } = await run(
      ['render', 'MusicEnvelope', '--entry', 'src/audio.tsx', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const pcm = readPcmMono(output);
    // 90 frames at 30 fps = 3.0s = 144000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(144000, -3);

    // Section 1: frames 0-29 (0.0 - 1.0s, test 0.2s - 0.8s) -> volume 1.0
    const rmsSec1 = computeRms(pcm, 9600, 38400);

    // Section 2: frames 30-59 (1.0 - 2.0s, test 1.2s - 1.8s) -> volume 0.2
    const rmsSec2 = computeRms(pcm, 57600, 86400);

    // Section 3: frames 60-89 (2.0 - 3.0s, test 2.2s - 2.8s) -> volume 0.8
    const rmsSec3 = computeRms(pcm, 105600, 134400);

    expect(rmsSec1).toBeGreaterThan(0.5);
    expect(rmsSec2 / rmsSec1).toBeCloseTo(0.2, 1);
    expect(rmsSec3 / rmsSec1).toBeCloseTo(0.8, 1);
  });

  it('renders SFX in Sequence layout="none" starting before 0', async () => {
    const output = join(OUT, 'SfxNegative.mp4');
    const { code, stderr } = await run(
      ['render', 'SfxNegative', '--entry', 'src/audio.tsx', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const pcm = readPcmMono(output);
    // 30 frames at 30 fps = 1.0s = 48000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(48000, -3);

    // Since audio starts at -15 frames and continues for 45 frames (until frame 30),
    // it must be active right from frame 0
    const startRms = computeRms(pcm, 4800, 38400);
    expect(startRms).toBeGreaterThan(0.5);
  });

  it('aligns audio to segment start with --frames 30-59', async () => {
    const output = join(OUT, 'SegmentAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'NarrationAudio', '--entry', 'src/audio.tsx', '--frames', '30-59', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const pcm = readPcmMono(output);
    // 30 frames rendered = 1.0s = 48000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(48000, -3);

    // Because frame 30 is now frame 0 of the segment, the tone starts immediately at 0 (within ±1 frame = 1600 samples)
    const onset = findOnsetSample(pcm);
    expect(onset).toBeGreaterThanOrEqual(0);
    expect(onset).toBeLessThanOrEqual(1600);

    const startRms = computeRms(pcm, 4800, 38400);
    expect(startRms).toBeGreaterThan(0.5);
  });

  it('fails with a fatal error when an audio file is missing', async () => {
    const output = join(OUT, 'MissingAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'MissingAudio', '--entry', 'src/audio.tsx', '-o', output],
      FIXTURE,
    );
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/audio file not found/i);
  });

  it('renders audio properly with --every-nth-frame without truncation', async () => {
    const output = join(OUT, 'EveryNthFrameAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'NarrationAudio', '--entry', 'src/audio.tsx', '--every-nth-frame', '2', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const pcm = readPcmMono(output);
    // 60 frames composition with --every-nth-frame 2 -> 30 frames at 15 fps = 2.0s = 96000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(96000, -3);

    // Narration onset at 1.0s (sample 48000, ±1600 samples)
    const onset = findOnsetSample(pcm);
    expect(onset).toBeGreaterThanOrEqual(0);
    expect(Math.abs(onset - 48000)).toBeLessThanOrEqual(1600);

    // Tone should play through to near the end without early truncation (sample 86400 to 93600: 1.8s to 1.95s)
    const endRms = computeRms(pcm, 86400, 93600);
    expect(endRms).toBeGreaterThan(0.5);
  });

  it('produces no audio stream when no assets are registered, and silent track with --silent-audio', async () => {
    // Without --silent-audio: no audio stream
    const noAudioOutput = join(OUT, 'NoAudio.mp4');
    const resNormal = await run(
      ['render', 'NoAudio', '--entry', 'src/audio.tsx', '-o', noAudioOutput],
      FIXTURE,
    );
    expect(resNormal.code).toBe(0);
    expect(probeAudioStreams(noAudioOutput)).toHaveLength(0);

    // With --silent-audio: 1 silent audio stream
    const silentOutput = join(OUT, 'SilentAudio.mp4');
    const resSilent = await run(
      ['render', 'NoAudio', '--entry', 'src/audio.tsx', '--silent-audio', '-o', silentOutput],
      FIXTURE,
    );
    expect(resSilent.code).toBe(0);
    const audioStreams = probeAudioStreams(silentOutput);
    expect(audioStreams).toHaveLength(1);
    expect(audioStreams[0]).toMatchObject({
      codec_name: 'aac',
      sample_rate: '48000',
      channels: 2,
    });

    const pcm = readPcmMono(silentOutput);
    expect(computeRms(pcm)).toBeLessThan(0.001);
  });

  it('removes audio when --muted is passed', async () => {
    const output = join(OUT, 'MutedAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'NarrationAudio', '--entry', 'src/audio.tsx', '--muted', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);
    expect(probeAudioStreams(output)).toHaveLength(0);
  });

  it('muxes silent audio track when both --muted and --silent-audio are passed', async () => {
    const output = join(OUT, 'MutedSilentAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'NarrationAudio', '--entry', 'src/audio.tsx', '--muted', '--silent-audio', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const audioStreams = probeAudioStreams(output);
    expect(audioStreams).toHaveLength(1);
    expect(audioStreams[0]).toMatchObject({
      codec_name: 'aac',
      sample_rate: '48000',
      channels: 2,
    });

    const pcm = readPcmMono(output);
    expect(computeRms(pcm)).toBeLessThan(0.001);
  });

  it.runIf(hasEncoder('libopus') && hasEncoder('libvpx-vp9'))('renders WebM container with Opus audio codec', async () => {
    const output = join(OUT, 'WebmOpus.webm');
    const { code, stderr } = await run(
      ['render', 'NarrationAudio', '--entry', 'src/audio.tsx', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const audioStreams = probeAudioStreams(output);
    expect(audioStreams).toHaveLength(1);
    expect(audioStreams[0]).toMatchObject({
      codec_name: 'opus',
      sample_rate: '48000',
      channels: 2,
    });
  });

  it('maintains audio sync for <Video> with original audio and playbackRate 2', async () => {
    const output = join(OUT, 'VideoWithAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'VideoWithAudio', '--entry', 'src/audio.tsx', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const audioStreams = probeAudioStreams(output);
    expect(audioStreams).toHaveLength(1);
    expect(audioStreams[0]?.codec_name).toBe('aac');

    const pcm = readPcmMono(output);
    expect(pcm.length).toBeCloseTo(48000, -3);

    // Audio should be active throughout the playback
    const activeRms = computeRms(pcm, 4800, 43200);
    expect(activeRms).toBeGreaterThan(0.2);
  });

  it('preserves all audio assets across tab lifecycles with --recycle-tabs', async () => {
    const output = join(OUT, 'RecycledAudio.mp4');
    const { code, stderr } = await run(
      ['render', 'NarrationAudio', '--entry', 'src/audio.tsx', '--recycle-tabs', '3', '-o', output],
      FIXTURE,
    );
    expect(code, stderr).toBe(0);

    const audioStreams = probeAudioStreams(output);
    expect(audioStreams).toHaveLength(1);
    expect(audioStreams[0]).toMatchObject({
      codec_name: 'aac',
      sample_rate: '48000',
      channels: 2,
    });

    const pcm = readPcmMono(output);
    expect(pcm.length).toBeCloseTo(96000, -3);

    const onset = findOnsetSample(pcm);
    expect(onset).toBeGreaterThanOrEqual(0);
    expect(Math.abs(onset - 48000)).toBeLessThanOrEqual(1600);

    const activeRms = computeRms(pcm, 50400, 86400);
    expect(activeRms).toBeGreaterThan(0.5);
  });
});
