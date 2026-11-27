import { EventEmitter } from 'node:events';

import type { HardwarePlan } from './ffmpeg.js';
import { chooseEncoder, describeChoice, hardwareBlocker, probeEncoder, resetEncoderProbes, SOFTWARE } from './hardware.js';


const request = { codec: 'h264', pixelFormat: 'yuv420p', crf: undefined, size: { width: 1920, height: 1080 }, ffmpeg: 'ffmpeg', platform: 'linux', env: {} } as const;
/** A probe that starts only the given encoders, and fails the others the way ffmpeg words it. */
const works = (...encoders: string[]) => async (_ffmpeg: string, plan: HardwarePlan) => (encoders.includes(plan.encoder) ? null : 'Cannot load libcuda.so.1');

describe('hardwareBlocker', () => {
  it('allows h264 and h265 with yuv420p and no crf', () => {
    expect(hardwareBlocker({ codec: 'h264', pixelFormat: 'yuv420p', crf: undefined })).toBeNull();
    expect(hardwareBlocker({ codec: 'h265', pixelFormat: undefined, crf: undefined })).toBeNull();
  });

  it('explains what rules the GPU out', () => {
    expect(hardwareBlocker({ codec: 'vp9', pixelFormat: 'yuv420p', crf: undefined })).toMatch(/only encoded in software/);
    expect(hardwareBlocker({ codec: 'prores', pixelFormat: undefined, crf: undefined })).toMatch(/only encoded in software/);
    expect(hardwareBlocker({ codec: 'h264', pixelFormat: 'yuv444p', crf: undefined })).toMatch(/yuv444p/);
    expect(hardwareBlocker({ codec: 'h264', pixelFormat: 'yuv420p', crf: 20 })).toMatch(/--video-bitrate/);
  });
});

describe('chooseEncoder', () => {
  it('never probes when acceleration is disabled', async () => {
    const probe = vi.fn();
    expect(await chooseEncoder({ ...request, mode: 'disable', probe })).toBe(SOFTWARE);
    expect(probe).not.toHaveBeenCalled();
  });

  it('uses NVENC with constant quality, or a bitrate when given', async () => {
    const quality = await chooseEncoder({ ...request, mode: 'if-possible', probe: works('h264_nvenc') });
    expect(quality).toMatchObject({ label: 'NVIDIA NVENC', plan: { encoder: 'h264_nvenc', rateArgs: ['-rc', 'vbr', '-cq', '19', '-b:v', '0'] } });
    const bitrate = await chooseEncoder({ ...request, codec: 'h265', videoBitrate: '8M', mode: 'required', probe: works('hevc_nvenc') });
    expect(bitrate.plan).toMatchObject({ encoder: 'hevc_nvenc', rateArgs: ['-b:v', '8M'] });
  });

  it('moves on to the next backend of the platform when one does not start', async () => {
    const choice = await chooseEncoder({ ...request, videoBitrate: '8M', mode: 'if-possible', probe: works('h264_vaapi') });
    expect(choice.label).toBe('VA-API (AMD, Intel)');
    expect(choice.plan).toMatchObject({
      encoder: 'h264_vaapi',
      inputArgs: ['-vaapi_device', '/dev/dri/renderD128'],
      filter: 'format=nv12,hwupload',
      rateArgs: ['-b:v', '8M'],
    });
  });

  it('lets the VA-API device be chosen from the environment', async () => {
    const choice = await chooseEncoder({ ...request, videoBitrate: '8M', env: { FREEMOTION_VAAPI_DEVICE: '/dev/dri/renderD129' }, mode: 'if-possible', probe: works('h264_vaapi') });
    expect(choice.plan?.inputArgs).toEqual(['-vaapi_device', '/dev/dri/renderD129']);
  });

  it('probes at the size of the video, and says why a tiny frame is refused', async () => {
    const probe = vi.fn().mockResolvedValue('Frame Dimension less than the minimum supported value.');
    const choice = await chooseEncoder({ ...request, size: { width: 64, height: 64 }, mode: 'if-possible', probe });
    expect(probe).toHaveBeenCalledWith('ffmpeg', expect.objectContaining({ encoder: 'h264_nvenc' }), { width: 64, height: 64 });
    expect(choice.reason).toMatch(/Frame Dimension less than the minimum/);
  });

  it('picks AMD AMF on Windows and VideoToolbox on macOS', async () => {
    const windows = await chooseEncoder({ ...request, platform: 'win32', videoBitrate: '8M', mode: 'if-possible', probe: works('h264_amf') });
    expect(windows.plan?.encoder).toBe('h264_amf');
    const mac = await chooseEncoder({ ...request, platform: 'darwin', codec: 'h265', videoBitrate: '8M', mode: 'if-possible', probe: works('hevc_videotoolbox') });
    expect(mac.plan?.encoder).toBe('hevc_videotoolbox');
  });

  it('asks for a bitrate instead of guessing a quality for encoders without a calibrated default', async () => {
    const probe = vi.fn().mockResolvedValue(null);
    const choice = await chooseEncoder({ ...request, platform: 'darwin', mode: 'if-possible', probe });
    expect(choice).toMatchObject({ plan: null, reason: expect.stringMatching(/Apple VideoToolbox needs --video-bitrate/) });
    expect(probe).not.toHaveBeenCalled();
  });

  it('falls back to software with a reason under if-possible', async () => {
    const failing = await chooseEncoder({ ...request, videoBitrate: '8M', mode: 'if-possible', probe: works() });
    expect(failing.plan).toBeNull();
    expect(failing.reason).toMatch(/the GPU encoder did not start \(h264_nvenc: Cannot load libcuda\.so\.1; h264_vaapi: Cannot load libcuda\.so\.1\)/);
    const blocked = await chooseEncoder({ ...request, crf: 20, mode: 'if-possible', probe: works('h264_nvenc') });
    expect(blocked).toMatchObject({ plan: null, reason: expect.stringMatching(/--crf/) });
    const unsupported = await chooseEncoder({ ...request, platform: 'freebsd', mode: 'if-possible', probe: works('h264_nvenc') });
    expect(unsupported.reason).toMatch(/no GPU encoder is supported on freebsd/);
  });

  it('fails under required when the GPU cannot be used', async () => {
    await expect(chooseEncoder({ ...request, mode: 'required', probe: works() })).rejects.toThrow(/required, but the GPU encoder did not start \(h264_nvenc: Cannot load/);
    await expect(chooseEncoder({ ...request, videoBitrate: '8M', mode: 'required', probe: works() })).rejects.toThrow(/required, but the GPU encoder did not start \(h264_nvenc: .+; h264_vaapi: /);
    await expect(chooseEncoder({ ...request, codec: 'vp9', mode: 'required', probe: works('h264_nvenc') })).rejects.toThrow(/required, but vp9 is only encoded in software/);
  });
});

describe('describeChoice', () => {
  it('says nothing when acceleration is off', () => {
    expect(describeChoice('disable', SOFTWARE)).toBeNull();
  });

  it('names the encoder, or why software is used', () => {
    expect(describeChoice('if-possible', { plan: { encoder: 'h264_nvenc', inputArgs: [], rateArgs: [] }, label: 'NVIDIA NVENC' }))
      .toBe('Encoder: h264_nvenc (NVIDIA NVENC), hardware accelerated: true');
    expect(describeChoice('if-possible', { plan: null, reason: 'no GPU encoder is supported on freebsd' }))
      .toBe('Hardware acceleration unavailable: no GPU encoder is supported on freebsd. Encoding in software.');
  });
});

describe('probeEncoder', () => {
  beforeEach(resetEncoderProbes);

  const plan: HardwarePlan = { encoder: 'h264_vaapi', inputArgs: ['-vaapi_device', '/dev/dri/renderD128'], filter: 'format=nv12,hwupload', rateArgs: [] };
  const size = { width: 1280, height: 720 };
  const fakeSpawn = (outcome: { code: number; stderr?: string } | 'error') => vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    queueMicrotask(() => {
      if (outcome === 'error') {
        child.emit('error', new Error('spawn ffmpeg ENOENT'));
        return;
      }
      if (outcome.stderr) {
        child.stderr.emit('data', Buffer.from(outcome.stderr));
      }
      child.emit('close', outcome.code);
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  const lastArgs = (spawnFn: unknown) => (spawnFn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string[];

  it('encodes one tiny frame with the same device, filter, encoder and size as the render', async () => {
    const spawnFn = fakeSpawn({ code: 0 });
    expect(await probeEncoder('ffmpeg', plan, size, spawnFn)).toBeNull();
    const args = lastArgs(spawnFn);
    expect(args.indexOf('-vaapi_device')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-i') + 1]).toContain('s=1280x720');
    expect(args[args.indexOf('-vf') + 1]).toBe('format=nv12,hwupload');
    expect(args[args.indexOf('-c:v') + 1]).toBe('h264_vaapi');
    expect(args).toContain('-frames:v');
  });

  it('returns the cause ffmpeg gave first when the encoder does not start', async () => {
    const stderr = '[h264_nvenc @ 0x5555] InitializeEncoder failed: invalid param (8): Frame Dimension less than the minimum supported value.\nError initializing output stream 0:0 -- Error while opening encoder\n';
    expect(await probeEncoder('ffmpeg', plan, size, fakeSpawn({ code: 1, stderr }))).toBe('InitializeEncoder failed: invalid param (8): Frame Dimension less than the minimum supported value.');
    resetEncoderProbes();
    expect(await probeEncoder('ffmpeg', plan, size, fakeSpawn({ code: 1 }))).toBe('ffmpeg failed to start the encoder');
    resetEncoderProbes();
    expect(await probeEncoder('ffmpeg', plan, size, fakeSpawn('error'))).toBe('spawn ffmpeg ENOENT');
  });

  it('remembers the answer per binary, encoder, device and size', async () => {
    const spawnFn = fakeSpawn({ code: 0 });
    await probeEncoder('ffmpeg', plan, size, spawnFn);
    await probeEncoder('ffmpeg', plan, size, spawnFn);
    await probeEncoder('ffmpeg', { ...plan, inputArgs: ['-vaapi_device', '/dev/dri/renderD129'] }, size, spawnFn);
    await probeEncoder('ffmpeg', plan, { width: 64, height: 64 }, spawnFn);
    expect(spawnFn).toHaveBeenCalledTimes(3);
  });
});
