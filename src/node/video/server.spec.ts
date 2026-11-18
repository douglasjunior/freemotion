import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startVideoFrameServer, type VideoFrameServer } from './server.js';


const hasFfmpeg = (() => {
  try {
    const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
})();

describe('startVideoFrameServer', () => {
  let tmpDir: string;
  let publicDir: string;
  let server: VideoFrameServer;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'freemotion-server-test-'));
    publicDir = join(tmpDir, 'public');
    mkdirSync(publicDir, { recursive: true });

    // Non-video file for testing 500 error
    writeFileSync(join(publicDir, 'corrupt.mp4'), 'this is not a valid video file');

    if (hasFfmpeg) {
      const generated = join(tmpDir, 'test.mp4');
      spawnSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=64x64:rate=30',
        '-t',
        '2',
        generated,
      ]);
      copyFileSync(generated, join(publicDir, 'sample.mp4'));
      copyFileSync(generated, join(publicDir, 'a..b.mp4'));
    }

    server = await startVideoFrameServer({ publicDir });
  });

  afterAll(async () => {
    await server.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('rejects remote URLs with 400 and actionable guidance', async () => {
    const res = await fetch(`${server.url}/__freemotion/video-frame?src=https://example.com/video.mp4&time=0`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('remote video URLs are not supported');
    expect(text).toContain('public/');
  });

  it('rejects path traversal with .. as 400', async () => {
    const res = await fetch(`${server.url}/__freemotion/video-frame?src=../secret.mp4&time=0`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('invalid video path');
  });

  it.runIf(hasFfmpeg)('allows filenames containing double dots like a..b.mp4', async () => {
    const res = await fetch(`${server.url}/__freemotion/video-frame?src=a..b.mp4&time=0`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for missing video file', async () => {
    const res = await fetch(`${server.url}/__freemotion/video-frame?src=nonexistent.mp4&time=0`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain('not found');
  });

  it('returns 404 on unrecognized route', async () => {
    const res = await fetch(`${server.url}/some/other/path`);
    expect(res.status).toBe(404);
  });

  it.runIf(hasFfmpeg)('returns 500 with useful ffmpeg error message for corrupted files', async () => {
    const res = await fetch(`${server.url}/__freemotion/video-frame?src=corrupt.mp4&time=0`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it.runIf(hasFfmpeg)('returns 500 without hanging when requesting beyond video duration', async () => {
    const res = await fetch(`${server.url}/__freemotion/video-frame?src=sample.mp4&time=999.0`);
    expect(res.status).toBe(500);
  });

  it.runIf(hasFfmpeg)('serves video frames with 200 and proper headers', async () => {
    const res = await fetch(`${server.url}/__freemotion/video-frame?src=sample.mp4&time=0.5`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it.runIf(hasFfmpeg)('leaves no orphan ffmpeg processes after closing', async () => {
    let spawnedPid: number | undefined;
    const trackingSpawn = ((...args: [string, readonly string[], object]) => {
      const child = spawn(args[0], args[1], args[2]);
      spawnedPid = child.pid;
      return child;
    }) as unknown as typeof spawn;

    const s = await startVideoFrameServer({ publicDir, spawn: trackingSpawn });
    const res = await fetch(`${s.url}/__freemotion/video-frame?src=sample.mp4&time=0.1`);
    expect(res.status).toBe(200);
    expect(spawnedPid).toBeDefined();

    // Close server
    await s.close();

    // Verify the spawned child process has terminated
    expect(() => process.kill(spawnedPid!, 0)).toThrow();
  });
});
