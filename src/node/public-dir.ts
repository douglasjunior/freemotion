import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';


const MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function resolvePublicDir(root: string, configuredPublicDir?: string | false): string | false {
  if (configuredPublicDir === false) {
    return false;
  }
  return resolve(root, configuredPublicDir ?? 'public');
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }
  const [, startStr, endStr] = match;
  let start: number;
  let end: number;

  if (startStr && endStr) {
    start = Number(startStr);
    end = Number(endStr);
  } else if (startStr) {
    start = Number(startStr);
    end = size - 1;
  } else if (endStr) {
    const len = Number(endStr);
    if (len === 0) {
      return null;
    }
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    return null;
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= size || start > end) {
    return null;
  }

  return { start, end };
}

export type NextFunction = (err?: unknown) => void;

export function createPublicDirMiddleware(publicDir: string) {
  const normalizedPublicDir = resolve(publicDir);

  return async (req: IncomingMessage, res: ServerResponse, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    let pathname: string;
    try {
      const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
      pathname = decodeURIComponent(rawPath);
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    if (pathname.includes('\0')) {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    // Protect against path traversal
    const targetPath = resolve(normalizedPublicDir, '.' + pathname);
    const rel = relative(normalizedPublicDir, targetPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    let stats;
    try {
      stats = await stat(targetPath);
    } catch {
      next();
      return;
    }

    if (!stats.isFile()) {
      next();
      return;
    }

    const contentType = mimeTypeFor(targetPath);
    const rangeHeader = req.headers.range;

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      if (stats.size === 0) {
        res.statusCode = 416;
        res.setHeader('Content-Range', 'bytes */0');
        res.setHeader('Content-Length', 0);
        res.end();
        return;
      }

      const range = parseRange(rangeHeader, stats.size);
      if (!range) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        res.setHeader('Content-Length', 0);
        res.end();
        return;
      }

      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = createReadStream(targetPath, { start: range.start, end: range.end });
      stream.on('error', next);
      stream.pipe(res);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = createReadStream(targetPath);
    stream.on('error', next);
    stream.pipe(res);
  };
}

export function servePublicDirPlugin(publicDir: string): Plugin {
  const middleware = createPublicDirMiddleware(publicDir);
  return {
    name: 'freemotion:serve-public',
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
