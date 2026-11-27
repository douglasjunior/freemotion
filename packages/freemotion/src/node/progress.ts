import { createRateTracker, describeRate } from './eta.js';
import type { Logger } from './logger.js';


export type ProgressEvent =
  | { readonly phase: 'bundle'; readonly status: 'start' | 'done' }
  | { readonly phase: 'render'; readonly id: string; readonly done: number; readonly total: number }
  | { readonly phase: 'encode'; readonly id: string; readonly done: number; readonly total: number }
  | { readonly phase: 'audio'; readonly id: string }
  | { readonly phase: 'mux'; readonly id: string }
  | { readonly phase: 'done'; readonly id: string; readonly output: string; readonly frames: number; readonly seconds: number }
  | { readonly phase: 'error'; readonly message: string };

export type ProgressMode = 'json';

export type Reporter = {
  readonly event: (e: ProgressEvent) => void;
};

export type ProgressStream = {
  write: (chunk: string) => unknown;
};

export type ReporterOptions = {
  readonly mode?: ProgressMode | string;
  readonly stdout?: ProgressStream;
  readonly stderr?: ProgressStream;
  readonly log?: Logger;
  readonly throttleMs?: number;
  readonly now?: () => number;
};

export function createReporter({
  mode,
  stdout = process.stdout,
  log,
  throttleMs = 250,
  now = Date.now,
}: ReporterOptions = {}): Reporter {
  const isJson = mode === 'json';
  const lastTimes = new Map<string, number>();
  const hasEncode = new Set<string>();
  const rates = new Map<string, ReturnType<typeof createRateTracker>>();

  const reportProgress = (message: string) => {
    if (log) {
      log.progress(message);
    } else if ('isTTY' in stdout && Boolean((stdout as NodeJS.WriteStream).isTTY)) {
      stdout.write(`\r\x1b[2K${message}`);
    }
  };

  return {
    event: (e: ProgressEvent) => {
      if (isJson) {
        if (e.phase === 'render' || e.phase === 'encode') {
          const key = `${e.phase}:${e.id}`;
          const last = lastTimes.get(key) ?? -Infinity;
          const currentTime = now();
          const isFinal = e.done === e.total;
          if (isFinal || currentTime - last >= throttleMs) {
            lastTimes.set(key, currentTime);
            stdout.write(`${JSON.stringify(e)}\n`);
          }
        } else {
          stdout.write(`${JSON.stringify(e)}\n`);
        }
        return;
      }

      if (e.phase === 'encode') {
        hasEncode.add(e.id);
      }
      if (e.phase === 'encode' || (e.phase === 'render' && !hasEncode.has(e.id))) {
        const key = `default:${e.id}`;
        const last = lastTimes.get(key) ?? -Infinity;
        const currentTime = now();
        const isFinal = e.done === e.total;
        if (isFinal || currentTime - last >= throttleMs) {
          lastTimes.set(key, currentTime);
          // Rendered and encoded counts differ, so each phase gets its own estimate.
          const rateKey = `${e.phase}:${e.id}`;
          if (!rates.has(rateKey)) {
            rates.set(rateKey, createRateTracker());
          }
          const rate = rates.get(rateKey)!.update(currentTime, e.done, e.total);
          reportProgress(`${e.id} · ${e.done}/${e.total} frames${rate ? ` · ${describeRate(rate)}` : ''}`);
        }
      }
    },
  };
}
