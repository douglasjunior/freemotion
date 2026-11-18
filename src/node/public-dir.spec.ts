import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as createServerRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPublicDirMiddleware, mimeTypeFor, resolvePublicDir, servePublicDirPlugin } from './public-dir.js';


describe('public-dir', () => {
  let tempDir: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'freemotion-public-test-'));
    writeFileSync(join(tempDir, 'hello.txt'), 'Hello, World!');
    writeFileSync(join(tempDir, 'image.png'), 'fake-png');
    writeFileSync(join(tempDir, 'vector.svg'), '<svg></svg>');
    writeFileSync(join(tempDir, 'data.json'), '{"ok":true}');
    writeFileSync(join(tempDir, 'font.woff2'), 'fake-font');

    const middleware = createPublicDirMiddleware(tempDir);
    server = createServer((req, res) => {
      middleware(req, res, () => {
        res.statusCode = 404;
        res.end('Not Found');
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('serving files', () => {
    it('serves an existing file with correct headers', async () => {
      const res = await fetch(`${baseUrl}/hello.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('content-length')).toBe('13');
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(await res.text()).toBe('Hello, World!');
    });

    it('responds to HEAD requests without body', async () => {
      const res = await fetch(`${baseUrl}/hello.txt`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('content-length')).toBe('13');
      expect(await res.text()).toBe('');
    });

    it('detects correct MIME types for known extensions', () => {
      expect(mimeTypeFor('a.png')).toBe('image/png');
      expect(mimeTypeFor('b.jpg')).toBe('image/jpeg');
      expect(mimeTypeFor('c.jpeg')).toBe('image/jpeg');
      expect(mimeTypeFor('d.webp')).toBe('image/webp');
      expect(mimeTypeFor('e.gif')).toBe('image/gif');
      expect(mimeTypeFor('f.svg')).toBe('image/svg+xml');
      expect(mimeTypeFor('g.woff2')).toBe('font/woff2');
      expect(mimeTypeFor('h.woff')).toBe('font/woff');
      expect(mimeTypeFor('i.ttf')).toBe('font/ttf');
      expect(mimeTypeFor('j.json')).toBe('application/json');
      expect(mimeTypeFor('k.mp3')).toBe('audio/mpeg');
      expect(mimeTypeFor('l.wav')).toBe('audio/wav');
      expect(mimeTypeFor('m.mp4')).toBe('video/mp4');
      expect(mimeTypeFor('n.webm')).toBe('video/webm');
      expect(mimeTypeFor('o.txt')).toBe('text/plain; charset=utf-8');
      expect(mimeTypeFor('p.unknown')).toBe('application/octet-stream');
    });
  });

  describe('404 on nonexistent', () => {
    it('calls next which yields 404 when file does not exist', async () => {
      const res = await fetch(`${baseUrl}/nonexistent.png`);
      expect(res.status).toBe(404);
    });
  });

  describe('path traversal protection', () => {
    it('blocks .. path traversal attempts with 403', async () => {
      const port = (server.address() as AddressInfo).port;
      const res = await new Promise<{ statusCode?: number }>((resolve, reject) => {
        const req = createServerRequest({ port, path: '/../outside.txt', host: '127.0.0.1' }, (r) => {
          resolve({ statusCode: r.statusCode });
        });
        req.on('error', reject);
        req.end();
      });
      expect(res.statusCode).toBe(403);
    });

    it('blocks encoded %2e%2e path traversal attempts with 403', async () => {
      const port = (server.address() as AddressInfo).port;
      const res = await new Promise<{ statusCode?: number }>((resolve, reject) => {
        const req = createServerRequest({ port, path: '/%2e%2e/outside.txt', host: '127.0.0.1' }, (r) => {
          resolve({ statusCode: r.statusCode });
        });
        req.on('error', reject);
        req.end();
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Range requests', () => {
    it('responds with 206 for explicit start-end byte range', async () => {
      const res = await fetch(`${baseUrl}/hello.txt`, {
        headers: { Range: 'bytes=0-4' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 0-4/13');
      expect(res.headers.get('content-length')).toBe('5');
      expect(await res.text()).toBe('Hello');
    });

    it('responds with 206 for open-ended range', async () => {
      const res = await fetch(`${baseUrl}/hello.txt`, {
        headers: { Range: 'bytes=7-' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 7-12/13');
      expect(res.headers.get('content-length')).toBe('6');
      expect(await res.text()).toBe('World!');
    });

    it('responds with 206 for suffix range', async () => {
      const res = await fetch(`${baseUrl}/hello.txt`, {
        headers: { Range: 'bytes=-6' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 7-12/13');
      expect(res.headers.get('content-length')).toBe('6');
      expect(await res.text()).toBe('World!');
    });

    it('responds with 416 for unsatisfied range', async () => {
      const res = await fetch(`${baseUrl}/hello.txt`, {
        headers: { Range: 'bytes=50-100' },
      });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe('bytes */13');
    });
  });

  describe('resolvePublicDir', () => {
    it('returns false when disabled', () => {
      expect(resolvePublicDir('/root', false)).toBe(false);
    });

    it('defaults to root/public', () => {
      expect(resolvePublicDir('/root')).toBe('/root/public');
    });

    it('resolves custom relative public directory', () => {
      expect(resolvePublicDir('/root', '../shared-public')).toBe('/shared-public');
    });
  });

  describe('servePublicDirPlugin', () => {
    it('returns a vite plugin with preview and dev server hooks', () => {
      const plugin = servePublicDirPlugin(tempDir);
      expect(plugin.name).toBe('freemotion:serve-public');
      expect(typeof plugin.configurePreviewServer).toBe('function');
      expect(typeof plugin.configureServer).toBe('function');
    });
  });
});
