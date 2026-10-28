import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { OUTPUT_FORMATS, type OutputFormat } from './ffmpeg.js';
import type { RenderOptions } from './render.js';
import type { StudioOptions } from './studio.js';


export const HELP = {
  main: `freemotion: make videos with React

Usage
  freemotion <command> [options]

Commands
  init [directory]     Create a new project (default directory: my-video)
  studio               Preview your compositions with hot reload
  render <id...>       Render compositions to MP4, WebM, GIF, PNG or animated SVG

Options
  -h, --help           Show help for a command
  -v, --version        Show the version

Run "freemotion <command> --help" for the options of each command.`,

  init: `Usage
  freemotion init [directory]

Creates a project with a sample composition in [directory] (default: my-video).
The directory must not exist or be empty.`,

  studio: `Usage
  freemotion studio [options]

Options
  --port <number>      Port to listen on (default: 3000, the next free one if taken)
  --host <address>     Address to listen on (0.0.0.0 exposes it on the network)
  --open               Open the browser
  --entry <file>       File that exports the compositions (default: src/compositions.tsx)
  --config <file>      Vite config to merge (default: vite.config.* in the project)
  --no-config          Ignore the project's Vite config`,

  render: `Usage
  freemotion render <id...> [options]
  freemotion render --all [options]

Options
  -o, --output <file>         Output file, for a single composition (.mp4, .webm, .gif, .png or .svg)
  --out-dir <dir>             Folder for <id>.<format> files (default: out)
  --all                       Render every composition
  --format <format>           mp4, webm, gif, png or svg (default: from --output, else mp4; png with --frame)
  --frame <n>                 Render a still image of frame n
  --frames <a-b>              Render only frames a to b (inclusive)
  --every-nth-frame <n>       Keep one frame out of every n, at 1/n of the frame rate (lighter GIFs and SVGs)
  --no-loop                   GIF and SVG: stop on the last frame instead of starting over
  --props <json|file>         Props merged over defaultProps, as JSON or a path to a .json file
  --scale <n>                 Pixel density: 2 renders at twice the width and height (default: 1)
  --crf <n>                   Quality for mp4/webm, lower is better (default: 18 mp4, 32 webm)
  --concurrency <n>           Browser tabs rendering in parallel (default: ${defaultConcurrency()})
  --entry <file>              File that exports the compositions (default: src/compositions.tsx)
  --config <file>             Vite config to merge (default: vite.config.* in the project)
  --no-config                 Ignore the project's Vite config
  --ffmpeg <path>             ffmpeg binary (default: $FREEMOTION_FFMPEG, the project's ffmpeg-static, or ffmpeg on PATH)
  --browser-executable <path> Chromium/Chrome to use instead of the bundled headless shell
  --quiet                     Only print errors`,
};

export function defaultConcurrency(): number {
  return Math.min(8, Math.max(1, availableParallelism() - 2));
}

export type Command =
  | { readonly name: 'help'; readonly topic: keyof typeof HELP }
  | { readonly name: 'version' }
  | { readonly name: 'init'; readonly directory?: string }
  | { readonly name: 'studio'; readonly options: Omit<StudioOptions, 'log'> }
  | { readonly name: 'render'; readonly quiet: boolean; readonly options: Omit<RenderOptions, 'log'> };

function integer(value: string | undefined, flag: string, min: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${flag} must be an integer of at least ${min} (got "${value}").`);
  }
  return number;
}

function positive(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  if (!(number > 0) || !Number.isFinite(number)) {
    throw new Error(`${flag} must be a positive number (got "${value}").`);
  }
  return number;
}

/** `"30-89"` → `[30, 89]`; `"30"` → `[30, 30]`. */
export function parseFrames(value: string): [number, number] {
  const match = /^(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`--frames must look like 0-89 (got "${value}").`);
  }
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (to < from) {
    throw new Error(`--frames ${value} ends before it starts.`);
  }
  return [from, to];
}

/** Inline JSON (`'{"title":"Hi"}'`) or the path of a JSON file. */
export function parseProps(value: string, cwd: string): Record<string, unknown> {
  const text = value.trim().startsWith('{') ? value : readFileSync(resolve(cwd, value), 'utf8');
  let props: unknown;
  try {
    props = JSON.parse(text);
  } catch (error) {
    throw new Error(`--props is not valid JSON: ${(error as Error).message}`);
  }
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new Error('--props must be a JSON object.');
  }
  return props as Record<string, unknown>;
}

function configFile(values: { config?: string; 'no-config'?: boolean }): string | false | undefined {
  return values['no-config'] ? false : values.config;
}

export function parseCommand(argv: readonly string[], { cwd, env }: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }): Command {
  const [name, ...rest] = argv;
  if (!name || name === '-h' || name === '--help' || name === 'help') {
    const topic = rest[0];
    return { name: 'help', topic: topic && topic in HELP ? (topic as keyof typeof HELP) : 'main' };
  }
  if (name === '-v' || name === '--version') {
    return { name: 'version' };
  }
  const args = [...rest];

  switch (name) {
    case 'init': {
      const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
      if (values.help) {
        return { name: 'help', topic: 'init' };
      }
      if (positionals.length > 1) {
        throw new Error('init takes a single directory.');
      }
      return { name: 'init', directory: positionals[0] };
    }

    case 'studio': {
      const { values } = parseArgs({
        args,
        options: {
          help: { type: 'boolean', short: 'h' },
          port: { type: 'string' },
          host: { type: 'string' },
          open: { type: 'boolean' },
          entry: { type: 'string' },
          config: { type: 'string' },
          'no-config': { type: 'boolean' },
        },
      });
      if (values.help) {
        return { name: 'help', topic: 'studio' };
      }
      return {
        name: 'studio',
        options: {
          root: cwd,
          entry: values.entry,
          configFile: configFile(values),
          port: integer(values.port, '--port', 0),
          host: values.host,
          open: values.open,
        },
      };
    }

    case 'render': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        allowNegative: true,
        options: {
          help: { type: 'boolean', short: 'h' },
          output: { type: 'string', short: 'o' },
          'out-dir': { type: 'string' },
          all: { type: 'boolean' },
          format: { type: 'string' },
          frame: { type: 'string' },
          frames: { type: 'string' },
          'every-nth-frame': { type: 'string' },
          loop: { type: 'boolean' },
          props: { type: 'string' },
          scale: { type: 'string' },
          crf: { type: 'string' },
          concurrency: { type: 'string' },
          entry: { type: 'string' },
          config: { type: 'string' },
          'no-config': { type: 'boolean' },
          ffmpeg: { type: 'string' },
          'browser-executable': { type: 'string' },
          quiet: { type: 'boolean' },
        },
      });
      if (values.help) {
        return { name: 'help', topic: 'render' };
      }
      if (values.all && positionals.length > 0) {
        throw new Error('Pass composition ids or --all, not both.');
      }
      if (!values.all && positionals.length === 0) {
        throw new Error('Which composition? Pass its id (freemotion render MyVideo) or --all.');
      }
      if (values.format && !(OUTPUT_FORMATS as readonly string[]).includes(values.format)) {
        throw new Error(`--format must be one of ${OUTPUT_FORMATS.join(', ')} (got "${values.format}").`);
      }
      if (values.frame !== undefined && values.frames !== undefined) {
        throw new Error('Use --frame for a still image or --frames for a video range, not both.');
      }
      return {
        name: 'render',
        quiet: Boolean(values.quiet),
        options: {
          root: cwd,
          entry: values.entry,
          configFile: configFile(values),
          compositions: values.all ? 'all' : positionals,
          output: values.output,
          outDir: values['out-dir'] ?? 'out',
          format: values.format as OutputFormat | undefined,
          frame: integer(values.frame, '--frame', 0),
          frames: values.frames === undefined ? undefined : parseFrames(values.frames),
          everyNthFrame: integer(values['every-nth-frame'], '--every-nth-frame', 1),
          loop: values.loop,
          props: values.props === undefined ? undefined : parseProps(values.props, cwd),
          scale: positive(values.scale, '--scale') ?? 1,
          crf: values.crf === undefined ? undefined : integer(values.crf, '--crf', 0),
          concurrency: integer(values.concurrency, '--concurrency', 1) ?? defaultConcurrency(),
          ffmpeg: values.ffmpeg ?? env.FREEMOTION_FFMPEG,
          browserExecutable: values['browser-executable'],
        },
      };
    }

    default:
      throw new Error(`Unknown command "${name}". Run "freemotion --help" to see the commands.`);
  }
}
