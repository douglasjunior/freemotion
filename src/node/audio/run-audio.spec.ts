import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AudioAsset } from '../../shared/render-api.js';

import { planAudio } from './audio-plan.js';
import { probeAudioMedia } from './probe.js';
import { mixAudio } from './run-audio.js';


function generateSine(path: string, durationSec = 2, freq = 1000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'lavfi',
      '-i', `sine=frequency=${freq}:duration=${durationSec}`,
      '-af', 'volume=8',
      '-c:a', 'pcm_s16le',
      path,
    ]);
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`Failed with code ${code}`))));
  });
}

function generateSilenceThenTone(path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=stereo:d=0.5',
      '-f', 'lavfi',
      '-i', 'sine=frequency=1000:duration=0.5',
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1,volume=8',
      '-c:a', 'pcm_s16le',
      path,
    ]);
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`Failed with code ${code}`))));
  });
}

function readPcmMono(path: string, sampleRate = 48000): Promise<Float32Array> {
  return new Promise<Float32Array>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', path,
      '-f', 'f32le',
      '-ac', '1',
      '-ar', String(sampleRate),
      '-',
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', chunk => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`PCM extraction failed with code ${code}`));
      } else {
        const fullBuf = Buffer.concat(chunks);
        const floatArray = new Float32Array(
          fullBuf.buffer,
          fullBuf.byteOffset,
          fullBuf.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );
        resolve(floatArray);
      }
    });
  });
}

function computeRms(samples: Float32Array, start = 0, end = samples.length): number {
  let sum = 0;
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i++) {
    const val = samples[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum / count);
}

describe('run-audio (ffmpeg integration)', () => {
  let testDir: string;
  let sine1s: string;
  let sine3s: string;
  let silenceThenTone: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'freemotion-run-audio-'));
    sine1s = join(testDir, 'sine_1s.wav');
    sine3s = join(testDir, 'sine_3s.wav');
    silenceThenTone = join(testDir, 'silence_then_tone.wav');
    await generateSine(sine1s, 1, 1000);
    await generateSine(sine3s, 3, 1000);
    await generateSilenceThenTone(silenceThenTone);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('delays audio: 1 kHz tone starting at frame 30 (at 30 fps) has onset at ~1.0s (±1 frame)', async () => {
    const asset: AudioAsset = {
      id: 'delayed_asset',
      src: sine1s,
      startFrame: 30, // 1.0s delay at 30 fps
      trimBefore: 0,
      playbackRate: 1,
      loop: false,
      volumes: [
        [30, 1.0],
        [59, 1.0],
      ],
    };

    const plan = await planAudio({
      assets: [asset],
      fps: 30,
      range: { from: 0, to: 60 }, // 2.0 seconds total
      probe: probeAudioMedia,
      tempDir: testDir,
    });

    const outputPath = await mixAudio(plan);
    const pcm = await readPcmMono(outputPath);

    // Total duration: 2.0s = 96000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(96000, -3);

    // Before frame 29 (~0.966s, sample 46400), should be near silent
    const preOnsetRms = computeRms(pcm, 0, 46400);
    expect(preOnsetRms).toBeLessThan(0.01);

    // Between 1.05s and 1.8s, tone should be active
    const activeRms = computeRms(pcm, 50400, 86400);
    expect(activeRms).toBeGreaterThan(0.5);
  });

  it('reduces RMS to half with constant 0.5 volume', async () => {
    const fullVolAsset: AudioAsset = {
      id: 'full_vol',
      src: sine1s,
      startFrame: 0,
      trimBefore: 0,
      playbackRate: 1,
      loop: false,
      volumes: [
        [0, 1.0],
        [29, 1.0],
      ],
    };

    const halfVolAsset: AudioAsset = {
      id: 'half_vol',
      src: sine1s,
      startFrame: 0,
      trimBefore: 0,
      playbackRate: 1,
      loop: false,
      volumes: [
        [0, 0.5],
        [29, 0.5],
      ],
    };

    const fullDir = join(testDir, 'full');
    const halfDir = join(testDir, 'half');
    await mkdir(fullDir, { recursive: true });
    await mkdir(halfDir, { recursive: true });

    const fullPlan = await planAudio({
      assets: [fullVolAsset],
      fps: 30,
      range: { from: 0, to: 30 },
      probe: probeAudioMedia,
      tempDir: fullDir,
    });

    const halfPlan = await planAudio({
      assets: [halfVolAsset],
      fps: 30,
      range: { from: 0, to: 30 },
      probe: probeAudioMedia,
      tempDir: halfDir,
    });

    const fullOut = await mixAudio(fullPlan);
    const halfOut = await mixAudio(halfPlan);

    const fullPcm = await readPcmMono(fullOut);
    const halfPcm = await readPcmMono(halfOut);

    const fullRms = computeRms(fullPcm);
    const halfRms = computeRms(halfPcm);

    expect(fullRms).toBeGreaterThan(0.3);
    expect(halfRms / fullRms).toBeCloseTo(0.5, 2);
  });

  it('generates increasing RMS following volume ramp from 0 to 1', async () => {
    // 60 frames = 2.0 seconds at 30 fps
    const rampAsset: AudioAsset = {
      id: 'ramp_asset',
      src: sine3s,
      startFrame: 0,
      trimBefore: 0,
      playbackRate: 1,
      loop: false,
      volumes: [
        [0, 0.0],
        [60, 1.0],
      ],
    };

    const plan = await planAudio({
      assets: [rampAsset],
      fps: 30,
      range: { from: 0, to: 60 },
      probe: probeAudioMedia,
      tempDir: testDir,
    });

    const out = await mixAudio(plan);
    const pcm = await readPcmMono(out);

    // Compute RMS in 4 quarter windows
    const quarter = Math.floor(pcm.length / 4);
    const rms0 = computeRms(pcm, 0, quarter);
    const rms1 = computeRms(pcm, quarter, quarter * 2);
    const rms2 = computeRms(pcm, quarter * 2, quarter * 3);
    const rms3 = computeRms(pcm, quarter * 3, pcm.length);

    expect(rms0).toBeLessThan(rms1);
    expect(rms1).toBeLessThan(rms2);
    expect(rms2).toBeLessThan(rms3);

    // Assert measured values against expected curve (ramp from 0 to 1 with peak RMS ~0.707)
    // Quarter 1 (0 to 0.25): expected RMS ~ 0.088
    expect(rms0).toBeCloseTo(0.088, 1);
    // Quarter 4 (0.75 to 1.0): expected RMS ~ 0.62
    expect(rms3).toBeGreaterThan(0.5);
  });

  it('modulates volume envelope with timeline offset without cutting audio tail', async () => {
    // Sound starts at frame 30 (1.0s delay at 30 fps), with a ramp from 0 to 1 across 30 frames (1.0s)
    const rampDelayed: AudioAsset = {
      id: 'ramp_delayed',
      src: sine3s,
      startFrame: 30,
      trimBefore: 0,
      playbackRate: 1,
      loop: false,
      volumes: [
        [30, 0.0],
        [59, 1.0],
      ],
    };

    const plan = await planAudio({
      assets: [rampDelayed],
      fps: 30,
      range: { from: 0, to: 60 }, // 2.0s total
      probe: probeAudioMedia,
      tempDir: testDir,
    });

    const out = await mixAudio(plan);
    const pcm = await readPcmMono(out);

    expect(pcm.length).toBeCloseTo(96000, -3);

    // Before frame 29 (sample 46400), should be near silent
    const preOnsetRms = computeRms(pcm, 0, 46400);
    expect(preOnsetRms).toBeLessThan(0.01);

    // From sample 48000 to 96000 (1.0s to 2.0s), compute RMS across 3 segments
    const third = Math.floor(48000 / 3);
    const rms1 = computeRms(pcm, 48000, 48000 + third);
    const rms2 = computeRms(pcm, 48000 + third, 48000 + third * 2);
    const rms3 = computeRms(pcm, 48000 + third * 2, 96000);

    expect(rms1).toBeLessThan(rms2);
    expect(rms2).toBeLessThan(rms3);

    // The tail (last 330ms up to 2.0s) MUST be active (proving tail was not cut by delay before amultiply)
    expect(rms3).toBeGreaterThan(0.4);
  });

  it('repeats audio with loop: true', async () => {
    // 1-second sine looped across 3 seconds (90 frames)
    const loopAsset: AudioAsset = {
      id: 'loop_test',
      src: sine1s,
      startFrame: 0,
      trimBefore: 0,
      playbackRate: 1,
      loop: true,
      volumes: [
        [0, 1.0],
        [89, 1.0],
      ],
    };

    const plan = await planAudio({
      assets: [loopAsset],
      fps: 30,
      range: { from: 0, to: 90 }, // 3.0 seconds
      probe: probeAudioMedia,
      tempDir: testDir,
    });

    const out = await mixAudio(plan);
    const pcm = await readPcmMono(out);

    // Second 2 (sample 96000 to 140000) should be active, even though source was only 1 second!
    const sec2Rms = computeRms(pcm, 96000, 140000);
    expect(sec2Rms).toBeGreaterThan(0.5);
  });

  it('correctly handles loop when rendering a segment starting after 1+ loop cycles', async () => {
    // 1-second loop (30 frames at 30 fps)
    // Render range from frame 60 to 90 (2.0s to 3.0s, starting in cycle 3)
    const loopSegmentAsset: AudioAsset = {
      id: 'loop_segment',
      src: sine1s,
      startFrame: 0,
      trimBefore: 0,
      playbackRate: 1,
      loop: true,
      volumes: [
        [60, 1.0],
        [89, 1.0],
      ],
    };

    const plan = await planAudio({
      assets: [loopSegmentAsset],
      fps: 30,
      range: { from: 60, to: 90 }, // 1.0 second duration
      probe: probeAudioMedia,
      tempDir: testDir,
    });

    const out = await mixAudio(plan);
    const pcm = await readPcmMono(out);

    expect(pcm.length).toBeCloseTo(48000, -3);
    const activeRms = computeRms(pcm, 5000, 40000);
    expect(activeRms).toBeGreaterThan(0.5);
  });

  it('skips beginning with trimBefore on non-uniform media', async () => {
    // silenceThenTone has 0.5s silence followed by 0.5s of 1 kHz tone.
    // trimBefore: 15 frames at 30 fps = 0.5s skipped.
    const trimAsset: AudioAsset = {
      id: 'trim_test',
      src: silenceThenTone,
      startFrame: 0,
      trimBefore: 15, // skips the 0.5s silence!
      playbackRate: 1,
      loop: false,
      volumes: [
        [0, 1.0],
        [14, 1.0],
      ],
    };

    const plan = await planAudio({
      assets: [trimAsset],
      fps: 30,
      range: { from: 0, to: 15 }, // 0.5s total duration
      probe: probeAudioMedia,
      tempDir: testDir,
    });

    const out = await mixAudio(plan);
    const pcm = await readPcmMono(out);

    // Audio should start immediately with the tone, not silence!
    const onsetRms = computeRms(pcm, 0, 10000);
    expect(onsetRms).toBeGreaterThan(0.4);
  });

  it('successfully batches and mixes 200 assets without hitting descriptor or argument limits', async () => {
    const assets: AudioAsset[] = [];
    for (let i = 0; i < 200; i++) {
      assets.push({
        id: `batch_asset_${i}`,
        src: sine1s,
        startFrame: (i % 50) * 2,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [
          [(i % 50) * 2, 0.05],
          [(i % 50) * 2 + 10, 0.05],
        ],
      });
    }

    const plan = await planAudio({
      assets,
      fps: 30,
      range: { from: 0, to: 100 },
      probe: probeAudioMedia,
      tempDir: testDir,
    });

    // 200 / 32 = 6.25 -> 7 batch passes + 1 combiner pass = 8 passes total
    expect(plan.passes.length).toBe(8);
    for (const pass of plan.passes) {
      const inputCount = pass.args.filter(a => a === '-i').length;
      expect(inputCount).toBeLessThanOrEqual(32);
    }

    const out = await mixAudio(plan);
    const pcm = await readPcmMono(out);

    expect(pcm.length).toBeCloseTo((100 / 30) * 48000, -3);
    const mixedRms = computeRms(pcm, 20000, 80000);
    expect(mixedRms).toBeGreaterThan(0.01);
  });
});
