import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertFfmpeg, ffmpegArgs, formatFromPath, resolveFfmpeg } from './ffmpeg.js';


describe('formatFromPath', () => {
  it('reads the extension', () => {
    expect(formatFromPath('out/a.mp4')).toBe('mp4');
    expect(formatFromPath('A.WEBM')).toBe('webm');
    expect(formatFromPath('a.gif')).toBe('gif');
    expect(formatFromPath('a.png')).toBe('png');
    expect(formatFromPath('a.mov')).toBe('mov');
    expect(formatFromPath('a.avi')).toBeNull();
    expect(formatFromPath('a')).toBeNull();
  });
});

describe('ffmpegArgs', () => {
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it('reads PNG frames from stdin at the composition frame rate', () => {
    const args = ffmpegArgs({ format: 'mp4', fps: 24, output: 'o.mp4' });
    expect(args.slice(0, 12)).toEqual(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '24', '-c:v', 'png', '-i', '-']);
    expect(args.at(-1)).toBe('o.mp4');
  });

  it('encodes on the GPU with the options of the chosen backend', () => {
    const nvenc = ffmpegArgs({ format: 'mp4', fps: 30, hardware: { encoder: 'h264_nvenc', inputArgs: [], rateArgs: ['-rc', 'vbr', '-cq', '19', '-b:v', '0'] }, output: 'o.mp4' });
    expect(nvenc).toContain('h264_nvenc');
    expect(nvenc).not.toContain('libx264');
    expect(nvenc).not.toContain('-crf');
    expect(after(nvenc, '-cq')).toBe('19');

    const hevc = ffmpegArgs({ format: 'mp4', fps: 30, codec: 'h265', hardware: { encoder: 'hevc_nvenc', inputArgs: [], rateArgs: ['-b:v', '8M'] }, output: 'o.mp4' });
    expect(hevc).toContain('hevc_nvenc');
    expect(after(hevc, '-tag:v')).toBe('hvc1');
    expect(after(hevc, '-b:v')).toBe('8M');
  });

  it('puts the device before the input and the upload filter at the end of the chain', () => {
    const args = ffmpegArgs({
      format: 'mp4',
      fps: 30,
      hardware: { encoder: 'h264_vaapi', inputArgs: ['-vaapi_device', '/dev/dri/renderD128'], filter: 'format=nv12,hwupload', rateArgs: ['-b:v', '8M'] },
      output: 'o.mp4',
    });
    expect(args.indexOf('-vaapi_device')).toBeLessThan(args.indexOf('-i'));
    expect(after(args, '-vf')).toMatch(/setparams=.*,format=nv12,hwupload$/);
  });

  it('uses a target bitrate instead of CRF in software too', () => {
    const h264 = ffmpegArgs({ format: 'mp4', fps: 30, videoBitrate: '5000k', output: 'o.mp4' });
    expect(after(h264, '-b:v')).toBe('5000k');
    expect(h264).not.toContain('-crf');
    const vp9 = ffmpegArgs({ format: 'webm', fps: 30, videoBitrate: '2M', output: 'o.webm' });
    expect(after(vp9, '-b:v')).toBe('2M');
    expect(vp9).not.toContain('-crf');
  });

  it('encodes H.264 tagged as BT.709', () => {
    const args = ffmpegArgs({ format: 'mp4', fps: 30, output: 'o.mp4' });
    expect(after(args.slice(12), '-c:v')).toBe('libx264');
    expect(after(args, '-crf')).toBe('18');
    expect(after(args, '-vf')).toContain('out_color_matrix=bt709');
    expect(after(args, '-vf')).toContain('colorspace=bt709');
    expect(args).toContain('+faststart');
  });

  it('encodes VP9 for webm', () => {
    const args = ffmpegArgs({ format: 'webm', fps: 30, crf: 28, output: 'o.webm' });
    expect(after(args.slice(12), '-c:v')).toBe('libvpx-vp9');
    expect(after(args, '-crf')).toBe('28');
  });

  it('builds a palette for gif', () => {
    const args = ffmpegArgs({ format: 'gif', fps: 15, output: 'o.gif' });
    expect(after(args, '-filter_complex')).toContain('palettegen');
    expect(after(args, '-loop')).toBe('0');
  });

  it('matches snapshot: h264 yuv420p', () => {
    expect(ffmpegArgs({ format: 'mp4', fps: 30, codec: 'h264', pixelFormat: 'yuv420p', output: 'o.mp4' })).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-c:v',
      'png',
      '-i',
      '-',
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709',
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-video_track_timescale',
      '90000',
      '-movflags',
      '+faststart',
      'o.mp4',
    ]);
  });

  it('matches snapshot: h265 com hvc1', () => {
    expect(ffmpegArgs({ format: 'mp4', fps: 30, codec: 'h265', output: 'o.mp4' })).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-c:v',
      'png',
      '-i',
      '-',
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709',
      '-c:v',
      'libx265',
      '-tag:v',
      'hvc1',
      '-crf',
      '20',
      '-video_track_timescale',
      '90000',
      '-movflags',
      '+faststart',
      'o.mp4',
    ]);
  });

  it('matches snapshot: vp9 yuva420p', () => {
    expect(ffmpegArgs({ format: 'webm', fps: 30, codec: 'vp9', pixelFormat: 'yuva420p', output: 'o.webm' })).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-c:v',
      'png',
      '-i',
      '-',
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '32',
      '-b:v',
      '0',
      '-row-mt',
      '1',
      '-auto-alt-ref',
      '0',
      'o.webm',
    ]);
  });

  it('matches snapshot: prores 4444', () => {
    expect(ffmpegArgs({ format: 'mov', fps: 24, codec: 'prores', proresProfile: '4444', output: 'o.mov' })).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '24',
      '-c:v',
      'png',
      '-i',
      '-',
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le,setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '4',
      'o.mov',
    ]);
  });

  it('matches snapshot: entrada mjpeg com conversão BT.601 para BT.709', () => {
    expect(ffmpegArgs({ format: 'mp4', fps: 30, imageFormat: 'jpeg', output: 'o.mp4' })).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-c:v',
      'mjpeg',
      '-i',
      '-',
      '-vf',
      'scale=in_range=pc:in_color_matrix=bt601:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709',
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-video_track_timescale',
      '90000',
      '-movflags',
      '+faststart',
      'o.mp4',
    ]);
  });

  it('uses -n when overwrite is false', () => {
    const args = ffmpegArgs({ format: 'mp4', fps: 30, overwrite: false, output: 'o.mp4' });
    expect(args[3]).toBe('-n');
  });
});

describe('assertFfmpeg', () => {
  it('explains how to install a missing binary', async () => {
    await expect(assertFfmpeg('/nonexistent/ffmpeg-binary')).rejects.toThrow(/brew install ffmpeg/);
  });
});

describe('resolveFfmpeg', () => {
  const project = (withStatic: boolean) => {
    const root = mkdtempSync(join(tmpdir(), 'freemotion-ffmpeg-'));
    writeFileSync(join(root, 'package.json'), '{}');
    if (withStatic) {
      const dir = join(root, 'node_modules/ffmpeg-static');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'ffmpeg'), '');
      writeFileSync(join(dir, 'index.js'), `module.exports = ${JSON.stringify(join(dir, 'ffmpeg'))};`);
    }
    return root;
  };

  it('prefers an explicit binary', () => {
    expect(resolveFfmpeg(project(true), '/opt/ffmpeg')).toBe('/opt/ffmpeg');
  });

  it('uses the project\'s ffmpeg-static', () => {
    const root = project(true);
    expect(resolveFfmpeg(root)).toBe(join(root, 'node_modules/ffmpeg-static/ffmpeg'));
  });

  it('falls back to ffmpeg on PATH', () => {
    expect(resolveFfmpeg(project(false))).toBe('ffmpeg');
  });
});
