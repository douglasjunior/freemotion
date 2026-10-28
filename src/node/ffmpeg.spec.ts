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
    expect(formatFromPath('a.mov')).toBeNull();
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
