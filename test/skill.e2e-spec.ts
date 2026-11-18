import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  computeRms,
  ensureSkillClips,
  FIXTURE,
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
    // Sequence 2: frozen at frame 29, trimBefore=5, playbackRate=1.5 -> source frame in shot2 is 5 + 29*1.5 = 48.5 -> 48.5 / 30s
    const outF25 = referenceFrame(outMp4, 25 / 30, join(OUT, 'out_f25.png'));
    const refShot2 = referenceFrame(join(SKILL_CLIPS_DIR, 'shot2.mp4'), 48.5 / 30, join(OUT, 'ref_shot2.png'));
    expect(psnr(outF25, refShot2)).toBeGreaterThan(35);

    // Keyframe in Sequence 3: global frame 64 = rendered frame 54
    // Sequence 3: trimBefore=0, playbackRate=2, frame in sequence is 64 - 60 = 4 -> source frame in shot3 is 0 + 4*2 = 8 -> 8 / 30s
    const outF54 = referenceFrame(outMp4, 54 / 30, join(OUT, 'out_f54.png'));
    const refShot3 = referenceFrame(join(SKILL_CLIPS_DIR, 'shot3.mp4'), 8 / 30, join(OUT, 'ref_shot3.png'));
    expect(psnr(outF54, refShot3)).toBeGreaterThan(35);

    // Audio synchronization
    const pcm = readPcmMono(outMp4, 48000);
    // 60 frames at 30 fps = 2.0s = 96000 samples at 48 kHz
    expect(pcm.length).toBeCloseTo(96000, -3);

    // Narration 1 onset at global frame 15 = rendered frame 5 (sample 5 * 1600 = 8000)
    // Before frame 4.5 (sample 7200), audio must be near silent (music volume is 0 before frame 15)
    const preOnsetRms = computeRms(pcm, 0, 7200);
    expect(preOnsetRms).toBeLessThan(0.02);

    let onsetSample = -1;
    for (let i = 0; i < pcm.length; i++) {
      if (Math.abs(pcm[i]!) >= 0.05) {
        onsetSample = i;
        break;
      }
    }
    expect(onsetSample).toBeGreaterThanOrEqual(0);
    expect(Math.abs(onsetSample - 8000)).toBeLessThanOrEqual(1600);

    // Music ducking envelope during Scene 2 (freeze, narration 2 suppressed):
    // Active music at volume 0.8 during samples 40000 to 72000
    const freezeAudioRms = computeRms(pcm, 40000, 72000);
    expect(freezeAudioRms).toBeGreaterThan(0.3);

    // 4. Frozen sequence renders the exact same frame across all its frozen frames, with audio suppressed
    // Rendered frames 20 to 49 are all from the frozen Sequence 2
    const fFreeze22 = referenceFrame(outMp4, 22 / 30, join(OUT, 'freeze_22.png'));
    const fFreeze35 = referenceFrame(outMp4, 35 / 30, join(OUT, 'freeze_35.png'));
    const fFreeze48 = referenceFrame(outMp4, 48 / 30, join(OUT, 'freeze_48.png'));
    expect(psnr(fFreeze22, fFreeze35)).toBe(Infinity);
    expect(psnr(fFreeze35, fFreeze48)).toBe(Infinity);

    // 5. The Studio-only badge is completely absent from the rendered frames
    // In studio mode, a bright yellow (255, 255, 0) box is placed at top-left (0, 0, 16, 16)
    // In CLI render mode, that badge is not rendered
    const [r, g, b] = pixelAt(outMp4, 8, 8, 0);
    const isStudioYellow = r > 200 && g > 200 && b < 50;
    expect(isStudioYellow).toBe(false);

    // 6. Both runs (with and without --recycle-tabs 5) produce identical output frames
    expect(psnr(outMp4, outRecycleMp4)).toBe(Infinity);
  });

  it('fails fast with a descriptive error when --browser-executable does not exist with --no-download', async () => {
    const failOutput = join(OUT, 'missing-browser.mp4');
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
    expect(stderr).toMatch(/Executable doesn't exist|not found|error/i);
  });
});
