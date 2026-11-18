import { describe, expect, it } from 'vitest';

import type { AudioAsset } from '../../shared/render-api.js';

import { buildAtempoFilters, planAudio } from './audio-plan.js';


describe('audio-plan', () => {
  describe('buildAtempoFilters', () => {
    it('returns empty array for rate 1.0', () => {
      expect(buildAtempoFilters(1.0)).toEqual([]);
    });

    it('returns single filter for rate 0.5', () => {
      expect(buildAtempoFilters(0.5)).toEqual(['atempo=0.5']);
    });

    it('returns single filter for rate 1.5', () => {
      expect(buildAtempoFilters(1.5)).toEqual(['atempo=1.5']);
    });

    it('chains filters for rate 0.25 (0.5x0.5)', () => {
      expect(buildAtempoFilters(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    });

    it('chains filters for rate 4 (2x2)', () => {
      expect(buildAtempoFilters(4.0)).toEqual(['atempo=2.0', 'atempo=2']);
    });

    it('chains filters for rate 16 (4 stages of 2)', () => {
      expect(buildAtempoFilters(16.0)).toEqual([
        'atempo=2.0',
        'atempo=2.0',
        'atempo=2.0',
        'atempo=2',
      ]);
    });
  });

  describe('planAudio', () => {
    const mockProbe = async (src: string) => {
      if (src === 'silent.mp4') {
        return { hasAudio: false, duration: 10 };
      }
      return { hasAudio: true, duration: 60, sampleRate: 48000 };
    };

    it('generates silence pass when no assets are provided', async () => {
      const plan = await planAudio({
        assets: [],
        fps: 30,
        range: { from: 0, to: 60 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      expect(plan.duration).toBe(2); // 60 frames / 30 fps
      expect(plan.passes).toHaveLength(1);
      expect(plan.passes[0]!.args).toContain('anullsrc=r=48000:cl=stereo');
    });

    it('discards assets without audio stream with warning', async () => {
      const asset: AudioAsset = {
        id: 'no_audio',
        src: 'silent.mp4',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[0, 1]],
      };

      const plan = await planAudio({
        assets: [asset],
        fps: 30,
        range: { from: 0, to: 30 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]).toContain('no audio stream found');
      expect(plan.passes[0]!.args).toContain('anullsrc=r=48000:cl=stereo');
    });

    it('plans single asset with constant volume and timeline delay', async () => {
      const asset: AudioAsset = {
        id: 'asset_1',
        src: 'track.mp3',
        startFrame: 30,
        trimBefore: 15,
        playbackRate: 1,
        loop: false,
        volumes: [
          [30, 0.6],
          [31, 0.6],
          [59, 0.6],
        ],
      };

      const plan = await planAudio({
        assets: [asset],
        fps: 30,
        range: { from: 0, to: 60 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      expect(plan.passes).toHaveLength(1);
      const pass = plan.passes[0]!;
      expect(pass.args).toContain('-i');
      expect(pass.args).toContain('track.mp3');

      const filterIdx = pass.args.indexOf('-filter_complex');
      expect(filterIdx).not.toBe(-1);
      const filterStr = pass.args[filterIdx + 1]!;

      // adelay for frame 30 at 30 fps is 1000ms
      expect(filterStr).toContain('adelay=1000|1000');
      // Constant volume 0.6
      expect(filterStr).toContain('volume=0.600000');
      // Source trim: 15 frames / 30 fps = 0.5s
      expect(filterStr).toContain('atrim=start=0.500000');
      // Duration clamp and apad
      expect(filterStr).toContain('atrim=duration=2.000000,apad=whole_dur=2.000000');
    });

    it('cuts initial source portion proportionally to playbackRate for negative sequence start', async () => {
      // Sequence started at -10, playbackRate 2.0. Render range [0, 30].
      // At frame 0, 10 frames have elapsed: 10 * 2.0 / 30 = 0.666667s on source.
      const asset: AudioAsset = {
        id: 'neg_asset',
        src: 'fast.mp3',
        startFrame: -10,
        trimBefore: 0,
        playbackRate: 2,
        loop: false,
        volumes: [
          [0, 1],
          [15, 1],
        ],
      };

      const plan = await planAudio({
        assets: [asset],
        fps: 30,
        range: { from: 0, to: 30 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      const pass = plan.passes[0]!;
      const filterIdx = pass.args.indexOf('-filter_complex');
      const filterStr = pass.args[filterIdx + 1]!;

      // 10 * 2 / 30 = 0.666667
      expect(filterStr).toContain('atrim=start=0.666667');
      expect(filterStr).toContain('atempo=2');
      // No adelay because it plays at frame 0 (outputTime = 0)
      expect(filterStr).not.toContain('adelay');
    });

    it('creates envelope file and amultiply for varying volume', async () => {
      const asset: AudioAsset = {
        id: 'variable_vol',
        src: 'fade.mp3',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [
          [0, 0.1],
          [15, 0.5],
          [29, 1.0],
        ],
      };

      const plan = await planAudio({
        assets: [asset],
        fps: 30,
        range: { from: 0, to: 30 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      expect(plan.envelopeFiles).toHaveLength(1);
      expect(plan.envelopeFiles[0]!.path).toContain('env_variable_vol.f32');
      expect(plan.envelopeFiles[0]!.data.length).toBeGreaterThan(0);

      const pass = plan.passes[0]!;
      expect(pass.args).toContain('-f');
      expect(pass.args).toContain('f32le');

      const filterIdx = pass.args.indexOf('-filter_complex');
      const filterStr = pass.args[filterIdx + 1]!;
      expect(filterStr).toContain('amultiply');
      expect(filterStr).toContain('pan=stereo|c0=c0|c1=c0');
    });

    it('applies adelay AFTER amultiply for variable volume assets with timeline offset', async () => {
      const asset: AudioAsset = {
        id: 'delayed_var_vol',
        src: 'fade.mp3',
        startFrame: 30, // 1000ms delay at 30 fps
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [
          [30, 0.2],
          [59, 1.0],
        ],
      };

      const plan = await planAudio({
        assets: [asset],
        fps: 30,
        range: { from: 0, to: 60 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      const pass = plan.passes[0]!;
      const filterIdx = pass.args.indexOf('-filter_complex');
      const filterStr = pass.args[filterIdx + 1]!;

      // Pre-volume chain MUST NOT have adelay
      const preVolLine = filterStr.split(';\n').find(l => l.includes('[pre_vol_0]'))!;
      expect(preVolLine).not.toContain('adelay');

      // Post-multiply chain MUST apply adelay
      const postMulLine = filterStr.split(';\n').find(l => l.includes('amultiply'))!;
      expect(postMulLine).toContain('amultiply,adelay=1000|1000[a_0]');
    });

    it('wraps source offset modulo loop duration when rendering segment starting after loop cycles', async () => {
      // Loop duration: trimAfter 60 frames (2.0s) - trimBefore 0 = 2.0s
      // Rendering segment from frame 150 (5.0s, which is 2.5 cycles in)
      // Modulo offset: 5.0s % 2.0s = 1.0s
      const asset: AudioAsset = {
        id: 'looped_segment',
        src: 'loop.mp3',
        startFrame: 0,
        trimBefore: 0,
        trimAfter: 60,
        playbackRate: 1,
        loop: true,
        volumes: [
          [150, 1.0],
          [209, 1.0],
        ],
      };

      const plan = await planAudio({
        assets: [asset],
        fps: 30,
        range: { from: 150, to: 210 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      const pass = plan.passes[0]!;
      const filterIdx = pass.args.indexOf('-filter_complex');
      const filterStr = pass.args[filterIdx + 1]!;

      // The complete loop cycle (0.0s to 2.0s) MUST be fed to aloop,
      // and the modulo offset (1.0s) MUST be applied AFTER aloop so full cycles repeat correctly.
      expect(filterStr).toContain('atrim=start=0.000000:end=2.000000,asetpts=PTS-STARTPTS,aloop=loop=-1:size=96000,atrim=start=1.000000,asetpts=PTS-STARTPTS');
    });

    it('caches probe results across multiple assets sharing the same src', async () => {
      let probeCallCount = 0;
      const countingProbe = async () => {
        probeCallCount++;
        return { hasAudio: true, duration: 60, sampleRate: 48000 };
      };

      const asset1: AudioAsset = {
        id: 'a1',
        src: 'shared.mp3',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[0, 1]],
      };
      const asset2: AudioAsset = {
        id: 'a2',
        src: 'shared.mp3',
        startFrame: 10,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[10, 1]],
      };

      await planAudio({
        assets: [asset1, asset2],
        fps: 30,
        range: { from: 0, to: 30 },
        probe: countingProbe,
        tempDir: '/tmp/test_audio',
      });

      expect(probeCallCount).toBe(1);
    });

    it('generates aloop filter with sample count for looped assets', async () => {
      const asset: AudioAsset = {
        id: 'looped_asset',
        src: 'loop.mp3',
        startFrame: 0,
        trimBefore: 0,
        trimAfter: 60, // 60 frames at 30 fps = 2.0s
        playbackRate: 1,
        loop: true,
        volumes: [[0, 1]],
      };

      const plan = await planAudio({
        assets: [asset],
        fps: 30,
        range: { from: 0, to: 120 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      const pass = plan.passes[0]!;
      const filterIdx = pass.args.indexOf('-filter_complex');
      const filterStr = pass.args[filterIdx + 1]!;

      // 2.0s * 48000 sampleRate = 96000 samples
      expect(filterStr).toContain('aloop=loop=-1:size=96000');
    });

    it('mixes multiple assets with amix=inputs=N:normalize=0', async () => {
      const asset1: AudioAsset = {
        id: 'asset_1',
        src: 'a1.mp3',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[0, 0.5]],
      };

      const asset2: AudioAsset = {
        id: 'asset_2',
        src: 'a2.mp3',
        startFrame: 0,
        trimBefore: 0,
        playbackRate: 1,
        loop: false,
        volumes: [[0, 0.5]],
      };

      const plan = await planAudio({
        assets: [asset1, asset2],
        fps: 30,
        range: { from: 0, to: 30 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      const pass = plan.passes[0]!;
      const filterIdx = pass.args.indexOf('-filter_complex');
      const filterStr = pass.args[filterIdx + 1]!;
      expect(filterStr).toContain('amix=inputs=2:normalize=0:duration=longest');
    });

    it('splits > 32 assets into batches and adds a final combiner pass', async () => {
      // 35 assets -> 2 batches (32 + 3) + 1 combiner pass = 3 passes total
      const assets: AudioAsset[] = [];
      for (let i = 0; i < 35; i++) {
        assets.push({
          id: `asset_${i}`,
          src: `sound_${i}.mp3`,
          startFrame: i * 2,
          trimBefore: 0,
          playbackRate: 1,
          loop: false,
          volumes: [[i * 2, 0.8]],
        });
      }

      const plan = await planAudio({
        assets,
        fps: 30,
        range: { from: 0, to: 100 },
        probe: mockProbe,
        tempDir: '/tmp/test_audio',
      });

      expect(plan.passes).toHaveLength(3);
      // Batch 0
      expect(plan.passes[0]!.outputPath).toContain('batch_0.wav');
      expect(plan.passes[0]!.args.filter(a => a === '-i')).toHaveLength(32);

      // Batch 1
      expect(plan.passes[1]!.outputPath).toContain('batch_1.wav');
      expect(plan.passes[1]!.args.filter(a => a === '-i')).toHaveLength(3);

      // Final combiner pass
      expect(plan.passes[2]!.outputPath).toContain('mixed_audio.wav');
      expect(plan.passes[2]!.args.filter(a => a === '-i')).toHaveLength(2);
    });
  });
});
