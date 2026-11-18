import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  computeRms,
  ensureSkillClips,
  FIXTURE,
  goertzelPower,
  pixelAt,
  probe,
  probeAudioStreams,
  psnr,
  readPcmMono,
  referenceFrame,
  run,
  SKILL_CLIPS_DIR,
} from './helpers.js';


const OUT = join(FIXTURE, 'out');

describe('video-maker skill integration workflow e2e', () => {
  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    ensureSkillClips();
  });

  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(SKILL_CLIPS_DIR, { recursive: true, force: true });
  });

  it('executes full video-maker skill render command with flags and tab recycling', async () => {
    const outMp4 = join(OUT, 'out-skill.mp4');
    const outRecycleMp4 = join(OUT, 'out-skill-recycle.mp4');

    const baseArgs = [
      'render',
      'ShotMix',
      '-o',
      outMp4,
      '--frames',
      '10-69',
      '--codec',
      'h264',
      '--pixel-format',
      'yuv420p',
      '--image-format',
      'jpeg',
      '--jpeg-quality',
      '92',
      '--crf',
      '23',
      '--scale',
      '1',
      '--concurrency',
      '3',
      '--video-cache-mb',
      '128',
      '--progress',
      'json',
      '--no-download',
      '--overwrite',
    ];

    // Execution 1: complete skill command without tab recycling
    const res1 = await run(baseArgs, FIXTURE);
    expect(res1.code, res1.stderr).toBe(0);

    // Execution 2: adding --recycle-tabs 5
    const recycleArgs = [
      ...baseArgs.slice(0, 3),
      outRecycleMp4,
      ...baseArgs.slice(4),
      '--recycle-tabs',
      '5',
    ];
    const res2 = await run(recycleArgs, FIXTURE);
    expect(res2.code, res2.stderr).toBe(0);

    // 1. stdout contains strictly valid JSON lines, ending with phase: done; stderr has no JSON
    const stdoutLines = res1.stdout.trim().split('\n').filter(Boolean);
    expect(stdoutLines.length).toBeGreaterThanOrEqual(3);

    const events = stdoutLines.map((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
      return JSON.parse(line);
    });

    const lastEvent = events[events.length - 1];
    expect(lastEvent).toMatchObject({
      phase: 'done',
      id: 'ShotMix',
      output: outMp4,
      frames: 60,
    });
    expect(typeof lastEvent.seconds).toBe('number');

    for (const line of res1.stderr.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        expect(() => JSON.parse(trimmed)).toThrow();
      }
    }

    // 2. Output is valid MP4 container with H.264 video (yuv420p) and AAC stereo 48 kHz audio, 60 frames
    const videoStream = probe(outMp4);
    expect(videoStream).toMatchObject({
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      width: 64,
      height: 64,
      nb_read_frames: '60',
    });

    const audioStreams = probeAudioStreams(outMp4);
    expect(audioStreams).toHaveLength(1);
    expect(audioStreams[0]).toMatchObject({
      codec_name: 'aac',
      sample_rate: '48000',
      channels: 2,
    });

    // 3. Keyframes match reference frames via PSNR and audio is synchronized
    // Keyframe in Sequence 1: global frame 20 = rendered frame 10 (at 30 fps, t = 10 / 30)
    // Sequence 1: trimBefore=10, playbackRate=1 -> source frame in shot1 is 10 + 20*1 = 30 -> 1.0s
    const outF10 = referenceFrame(outMp4, 10 / 30, join(OUT, 'out_f10.png'));
    const refShot1 = referenceFrame(join(SKILL_CLIPS_DIR, 'shot1.mp4'), 1.0, join(OUT, 'ref_shot1.png'));
    expect(psnr(outF10, refShot1)).toBeGreaterThan(35);

    // Keyframe in Sequence 2 (frozen): global frame 35 = rendered frame 25
    // Sequence 2: frozen at frame 29, trimBefore=5, playbackRate=2 -> source frame in shot2 is 5 + 29*2 = 63 -> 2.1s
    const outF25 = referenceFrame(outMp4, 25 / 30, join(OUT, 'out_f25.png'));
    const refShot2 = referenceFrame(join(SKILL_CLIPS_DIR, 'shot2.mp4'), 2.1, join(OUT, 'ref_shot2.png'));
    expect(psnr(outF25, refShot2)).toBeGreaterThan(35);

    // Keyframe in Sequence 3: global frame 64 = rendered frame 54
    // Sequence 3: trimBefore=0, playbackRate=0.5, frame in sequence is 64 - 60 = 4 -> source frame in shot3 is 0 + 4*0.5 = 2 -> 2 / 30s
    const outF54 = referenceFrame(outMp4, 54 / 30, join(OUT, 'out_f54.png'));
    const refShot3 = referenceFrame(join(SKILL_CLIPS_DIR, 'shot3.mp4'), 2 / 30, join(OUT, 'ref_shot3.png'));
    expect(psnr(outF54, refShot3)).toBeGreaterThan(35);

    // Audio verification
    const pcm = readPcmMono(outMp4, 48000);
    // 60 frames at 30 fps = 2.0s = 96000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(96000, -3);

    // Active negative SFX:
    // Sequence from={-5} durationInFrames={18} covers global frames -5 to 12.
    // In rendered segment 10-69, global frames 10, 11, 12 correspond to rendered frames 0, 1, 2 (samples 0 to 4800).
    // In samples 0 to 4000, 800 Hz SFX is active while music is muted (volume=0) and narration has not started.
    expect(goertzelPower(pcm.subarray(0, 4000), 800)).toBeGreaterThan(0.15);
    expect(goertzelPower(pcm.subarray(0, 4000), 1000)).toBeLessThan(0.001);

    // Narration 1 onset separation:
    // SFX ended at global frame 12 (rendered frame 2, sample 4800).
    // Narration 1 (1000 Hz) begins at global frame 18 = rendered frame 8 = sample 12800 (8 * 1600).
    // Between sample 6000 and 12000 (rendered frames 4 to 7), audio is silent (music volume is 0 before frame 18).
    // Allow slight AAC transform / bit-reservoir noise floor (< 0.02)
    const preOnsetRms = computeRms(pcm, 6000, 12000);
    expect(preOnsetRms).toBeLessThan(0.02);
    expect(goertzelPower(pcm.subarray(6000, 12000), 1000)).toBeLessThan(0.001);

    // At sample 12800 onwards, Narration 1 (1000 Hz) begins
    expect(goertzelPower(pcm.subarray(12800, 16000), 1000)).toBeGreaterThan(0.2);

    // Proves absence of audio inside Freeze:
    // Sequence 2 is wrapped in <Freeze frame={29}> and contains narration2.wav (1500 Hz).
    // During rendered frames 20 to 49 (samples 40000 to 72000), background music (440 Hz) is active at volume 0.8,
    // but narration 2 (1500 Hz) is completely suppressed by Freeze.
    expect(goertzelPower(pcm.subarray(40000, 72000), 440)).toBeGreaterThan(0.2);
    expect(goertzelPower(pcm.subarray(40000, 72000), 1500)).toBeLessThan(0.001);

    // 4. Frozen sequence renders the exact same frame across all its frozen frames
    // Rendered frames 20 to 49 are all from the frozen Sequence 2
    const fFreeze22 = referenceFrame(outMp4, 22 / 30, join(OUT, 'freeze_22.png'));
    const fFreeze35 = referenceFrame(outMp4, 35 / 30, join(OUT, 'freeze_35.png'));
    const fFreeze48 = referenceFrame(outMp4, 48 / 30, join(OUT, 'freeze_48.png'));
    expect(psnr(fFreeze22, fFreeze35)).toBeGreaterThan(45);
    expect(psnr(fFreeze35, fFreeze48)).toBeGreaterThan(45);

    // 5. The Studio-only badge is completely absent from the rendered frames
    // In studio mode, a bright yellow (255, 255, 0) box is placed at top-left (0, 0, 16, 16)
    // In CLI render mode, that badge is not rendered
    const [r, g, b] = pixelAt(outMp4, 8, 8, 0);
    const isStudioYellow = r > 200 && g > 200 && b < 50;
    expect(isStudioYellow).toBe(false);

    // 6. Both runs (with and without --recycle-tabs 5) produce identical output frames (within lossy tolerance)
    expect(psnr(outMp4, outRecycleMp4)).toBeGreaterThan(45);
  });

  it('fails fast with clear guidance when browser is not installed and --no-download is passed', async () => {
    const failOutput = join(OUT, 'no-browser-download.mp4');
    const { code, stderr } = await run(
      ['render', 'ShotMix', '--no-download', '-o', failOutput],
      FIXTURE,
      { PLAYWRIGHT_BROWSERS_PATH: '/tmp/nonexistent-playwright-browsers' },
    );
    expect(code).toBe(1);
    expect(stderr).toContain('Browser is not installed. Run freemotion browser ensure or pass --browser-executable.');
  });

  it('fails fast with a descriptive error when --browser-executable does not exist', async () => {
    const failOutput = join(OUT, 'missing-browser-exec.mp4');
    const { code, stderr } = await run(
      [
        'render',
        'ShotMix',
        '--no-download',
        '--browser-executable',
        '/nonexistent/browser-binary-path',
        '-o',
        failOutput,
      ],
      FIXTURE,
    );
    expect(code).toBe(1);
    expect(stderr.toLowerCase()).toContain('executable doesn\'t exist at /nonexistent/browser-binary-path');
  });
});
