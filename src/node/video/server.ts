import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { FrameService } from './frame-service.js';


export type VideoServerOptions = {
  readonly ffmpeg?: string;
  readonly publicDir: string;
  readonly cacheBytes?: number;
  readonly spawn?: typeof spawn;
};

export type VideoFrameServer = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

const ROUTE_PATH = '/__freemotion/video-frame';

/**
 * Starts a local HTTP server that delivers exact video frames as JPEG or PNG.
 */
export async function startVideoFrameServer(options: VideoServerOptions): Promise<VideoFrameServer> {
  const { publicDir, ffmpeg, cacheBytes, spawn: spawnFn } = options;
  const frameService = new FrameService({ ffmpeg, cacheBytes, spawn: spawnFn });
  const resolvedPublicDir = resolve(publicDir);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Enable CORS for preview / studio origins
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    if (!req.url) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('freemotion: missing request URL.');
      return;
    }

    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    if (parsedUrl.pathname !== ROUTE_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const src = parsedUrl.searchParams.get('src');
    const timeParam = parsedUrl.searchParams.get('time');
    const transparentParam = parsedUrl.searchParams.get('transparent');

    if (!src) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('freemotion: missing required "src" query parameter.');
      return;
    }

    if (src.startsWith('http://') || src.startsWith('https://')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        'freemotion: remote video URLs are not supported by the frame server. '
        + 'Place the video file in your project\'s "public/" directory and use staticFile("filename.mp4").',
      );
      return;
    }

    if (src.includes('..') || /^[a-zA-Z]:[/\\]/.test(src) || src.startsWith('\\\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        'freemotion: invalid video path. Directory traversal and absolute filesystem paths are not allowed; '
        + 'use a path relative to the public/ directory.',
      );
      return;
    }

    const relativePath = src.replace(/^\/+/, '');
    const resolvedPath = resolve(resolvedPublicDir, relativePath);

    if (!resolvedPath.startsWith(resolvedPublicDir)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('freemotion: path escapes public directory.');
      return;
    }

    if (!existsSync(resolvedPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`freemotion: video file not found at "${resolvedPath}".`);
      return;
    }

    const time = parseFloat(timeParam ?? '0');
    if (Number.isNaN(time)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`freemotion: invalid "time" parameter: "${timeParam}". Must be a number.`);
      return;
    }

    const transparent = transparentParam === 'true' || transparentParam === '1';

    try {
      const frame = await frameService.getFrame({
        src: resolvedPath,
        time,
        transparent,
      });

      res.writeHead(200, {
        'Content-Type': frame.contentType,
        'Content-Length': frame.buffer.byteLength,
        'Cache-Control': 'no-store',
      });
      res.end(frame.buffer);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.listen(0, '127.0.0.1', () => resolvePromise());
    server.on('error', reject);
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  const close = async (): Promise<void> => {
    await frameService.close();
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
      server.closeAllConnections?.();
    });
  };

  return { url, close };
}
