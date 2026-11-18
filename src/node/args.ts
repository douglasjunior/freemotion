import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  AUDIO_CODECS,
  CODEC_PIXEL_FORMATS,
  CODECS,
  DEFAULT_CODEC,
  FORMAT_AUDIO_CODECS,
  FORMAT_CODECS,
  formatFromPath,
  IMAGE_FORMATS,
  OUTPUT_FORMATS,
  PIXEL_FORMATS,
  PRORES_PROFILES,
  type AudioCodec,
  type Codec,
  type ContainerFormat,
  type ImageFormat,
  type OutputFormat,
  type PixelFormat,
  type ProResProfile,
} from './ffmpeg.js';
import { GL_BACKENDS, isGlBackend, type GlBackend } from './gl.js';
import type { RenderOptions } from './render.js';
import type { StudioOptions } from './studio.js';


export const HELP = {
  main: `freemotion: make videos with React

Usage
  freemotion <command> [options]

Commands
  init [directory]     Create a new project (default directory: my-video)
  studio               Preview your compositions with hot reload
  render <id...>       Render compositions to MP4, WebM, MOV, GIF, PNG or animated SVG
  browser ensure       Download or verify the Chromium headless shell

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
  --no-open            Do not open the browser
  --entry <file>       File that exports the compositions (default: src/compositions.tsx)
  --config <file>      Vite config to merge (default: vite.config.* in the project)
  --no-config          Ignore the project's Vite config`,

  render: `Usage
  freemotion render <id...> [options]
  freemotion render --all [options]

Options
  -o, --output <file>         Output file, for a single composition (.mp4, .webm, .mov, .gif, .png or .svg)
  --out-dir <dir>             Folder for <id>.<format> files (default: out)
  --all                       Render every composition
  --format <format>           mp4, webm, mov, gif, png or svg (default: from --output, else mp4; png with --frame)
  --frame <n>                 Render a still image of frame n
  --frames <a-b>              Render only frames a to b (inclusive)
  --every-nth-frame <n>       Keep one frame out of every n, at 1/n of the frame rate (lighter GIFs and SVGs)
  --no-loop                   GIF and SVG: stop on the last frame instead of starting over
  --props <json|file>         Props merged over defaultProps, as JSON or a path to a .json file
  --scale <n>                 Pixel density: 2 renders at twice the width and height (default: 1)
  --image-format <format>     Frame capture format: png or jpeg (default: png)
  --jpeg-quality <n>          JPEG quality between 1 and 100 (default: 92)
  --codec <codec>             Video codec: h264, h265, vp9 or prores (default: by format)
  --pixel-format <format>     Pixel format (default: yuv420p)
  --prores-profile <profile>  ProRes profile: proxy, lt, standard, hq, 4444, 4444-xq (default: hq)
  --crf <n>                   Quality for mp4/webm, lower is better (default: 18 for h264, 20 for h265, 32 for vp9)
  --audio-codec <codec>       Audio codec: aac (default for mp4/mov) or opus (default for webm)
  --muted                     Mute all audio in the rendered video
  --silent-audio              Add a silent audio track when no audio is present (or when --muted)
  --overwrite                 Overwrite existing output files (default: true, use --no-overwrite to prevent)
  --concurrency <n>           Browser tabs rendering in parallel (default: ${defaultConcurrency()})
  --recycle-tabs <n>          Recreate each tab after n frames to bound memory (default: 1000; 0 disables)
  --timeout <ms>              Maximum wait time for delayRender holds in ms (default: 30000)
  --video-cache-mb <mb>       Memory limit for decoded video frames in MB (default: 512)
  --gl <backend>              WebGL backend: angle, swangle, egl, swiftshader, vulkan
  --no-download               Fail if the browser is not installed instead of downloading it
  --entry <file>              File that exports the compositions (default: src/compositions.tsx)
  --config <file>             Vite config to merge (default: vite.config.* in the project)
  --no-config                 Ignore the project's Vite config
  --no-build-cache            Rebuild compositions instead of using the cached bundle
  --ffmpeg <path>             ffmpeg binary (default: $FREEMOTION_FFMPEG, the project's ffmpeg-static, or ffmpeg on PATH)
  --browser-executable <path> Chromium/Chrome to use instead of the bundled headless shell
  --progress <mode>           json (one JSON event per line on stdout; logs to stderr)
  --quiet                     Only print errors`,

  browser: `Usage
  freemotion browser ensure [options]

Verify or install the Chromium headless shell used for rendering.

Options
  --browser-executable <path> Chromium/Chrome to verify instead of the bundled headless shell`,
};

export function defaultConcurrency(): number {
  return Math.min(8, Math.max(1, availableParallelism() - 2));
}

export type Command =
  | { readonly name: 'help'; readonly topic: keyof typeof HELP }
  | { readonly name: 'version' }
  | { readonly name: 'init'; readonly directory?: string }
  | { readonly name: 'studio'; readonly options: Omit<StudioOptions, 'log'> }
  | { readonly name: 'render'; readonly quiet: boolean; readonly options: Omit<RenderOptions, 'log'> }
  | { readonly name: 'browser'; readonly subcommand: 'ensure'; readonly options: { readonly executablePath?: string } };

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

function configFile(values: { config?: string | boolean; 'no-config'?: boolean }): string | false | undefined {
  if (values['no-config'] || values.config === false) {
    return false;
  }
  return typeof values.config === 'string' ? values.config : undefined;
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
        allowNegative: true,
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
          'image-format': { type: 'string' },
          'jpeg-quality': { type: 'string' },
          codec: { type: 'string' },
          'pixel-format': { type: 'string' },
          'prores-profile': { type: 'string' },
          crf: { type: 'string' },
          muted: { type: 'boolean' },
          'silent-audio': { type: 'boolean' },
          'audio-codec': { type: 'string' },
          overwrite: { type: 'boolean' },
          concurrency: { type: 'string' },
          'recycle-tabs': { type: 'string' },
          timeout: { type: 'string' },
          'video-cache-mb': { type: 'string' },
          gl: { type: 'string' },
          download: { type: 'boolean' },
          entry: { type: 'string' },
          config: { type: 'string' },
          'no-config': { type: 'boolean' },
          'build-cache': { type: 'boolean' },
          ffmpeg: { type: 'string' },
          'browser-executable': { type: 'string' },
          progress: { type: 'string' },
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
      if (values.gl !== undefined && !isGlBackend(values.gl)) {
        throw new Error(`--gl must be one of ${GL_BACKENDS.join(', ')} (got "${values.gl}").`);
      }
      if (values.frame !== undefined && values.frames !== undefined) {
        throw new Error('Use --frame for a still image or --frames for a video range, not both.');
      }

      if (values['image-format'] && !(IMAGE_FORMATS as readonly string[]).includes(values['image-format'])) {
        throw new Error(`--image-format must be one of ${IMAGE_FORMATS.join(', ')} (got "${values['image-format']}").`);
      }

      let jpegQuality: number | undefined;
      if (values['jpeg-quality'] !== undefined) {
        const number = Number(values['jpeg-quality']);
        if (!Number.isInteger(number) || number < 1 || number > 100) {
          throw new Error(`--jpeg-quality must be an integer between 1 and 100 (got "${values['jpeg-quality']}").`);
        }
        jpegQuality = number;
      }

      if (values.codec && !(CODECS as readonly string[]).includes(values.codec)) {
        throw new Error(`--codec must be one of ${CODECS.join(', ')} (got "${values.codec}").`);
      }

      const outputExtFormat = values.output ? formatFromPath(values.output) : null;
      const targetFormat = (values.format as OutputFormat | undefined)
        ?? outputExtFormat
        ?? (values.frame !== undefined ? 'png' : 'mp4');

      if (values.codec) {
        if (targetFormat !== 'mp4' && targetFormat !== 'webm' && targetFormat !== 'mov') {
          throw new Error(`Format "${targetFormat}" does not support --codec.`);
        }
        const allowedCodecs = FORMAT_CODECS[targetFormat as ContainerFormat];
        if (!allowedCodecs.includes(values.codec as Codec)) {
          throw new Error(`Format "${targetFormat}" does not support codec "${values.codec}". Valid codecs for ${targetFormat}: ${allowedCodecs.join(', ')}.`);
        }
      }

      const effectiveCodec: Codec | undefined = (values.codec as Codec | undefined)
        ?? (targetFormat === 'mp4' || targetFormat === 'webm' || targetFormat === 'mov'
          ? DEFAULT_CODEC[targetFormat as ContainerFormat]
          : undefined);

      if (values['prores-profile']) {
        if (!(PRORES_PROFILES as readonly string[]).includes(values['prores-profile'])) {
          throw new Error(`--prores-profile must be one of ${PRORES_PROFILES.join(', ')} (got "${values['prores-profile']}").`);
        }
        if (effectiveCodec !== 'prores') {
          throw new Error('--prores-profile is only valid with prores codec.');
        }
      }

      if (values.crf !== undefined && effectiveCodec === 'prores') {
        throw new Error('--crf cannot be used with prores.');
      }

      if (values['pixel-format']) {
        if (!(PIXEL_FORMATS as readonly string[]).includes(values['pixel-format'])) {
          throw new Error(`--pixel-format must be one of ${PIXEL_FORMATS.join(', ')} (got "${values['pixel-format']}").`);
        }
        if (!effectiveCodec) {
          throw new Error(`Format "${targetFormat}" does not support --pixel-format.`);
        }
        const allowedPixelFormats = CODEC_PIXEL_FORMATS[effectiveCodec];
        if (!allowedPixelFormats.includes(values['pixel-format'] as PixelFormat)) {
          throw new Error(`Codec "${effectiveCodec}" does not support pixel format "${values['pixel-format']}". Valid pixel formats: ${allowedPixelFormats.join(', ')}.`);
        }
        if (effectiveCodec === 'prores') {
          const profile = (values['prores-profile'] as ProResProfile | undefined) ?? 'hq';
          const is4444 = profile === '4444' || profile === '4444-xq';
          if (is4444 !== (values['pixel-format'] === 'yuva444p10le')) {
            throw new Error('ProRes 4444 profiles need --pixel-format yuva444p10le; the other profiles need yuv422p10le.');
          }
        }
      }

      if (values['audio-codec'] && !(AUDIO_CODECS as readonly string[]).includes(values['audio-codec'])) {
        throw new Error(`--audio-codec must be one of ${AUDIO_CODECS.join(', ')} (got "${values['audio-codec']}").`);
      }

      if (values['audio-codec']) {
        if (targetFormat !== 'mp4' && targetFormat !== 'webm' && targetFormat !== 'mov') {
          throw new Error(`Format "${targetFormat}" does not support --audio-codec.`);
        }
        const allowedAudioCodecs = FORMAT_AUDIO_CODECS[targetFormat as ContainerFormat];
        if (!allowedAudioCodecs.includes(values['audio-codec'] as AudioCodec)) {
          throw new Error(`Format "${targetFormat}" does not support audio codec "${values['audio-codec']}". Use "${allowedAudioCodecs.join(', ')}" instead.`);
        }
      }

      if (values.progress !== undefined && values.progress !== 'json') {
        throw new Error(`--progress must be json (got "${values.progress}").`);
      }
      return {
        name: 'render',
        quiet: Boolean(values.quiet),
        options: {
          root: cwd,
          entry: values.entry,
          configFile: configFile(values),
          buildCache: values['build-cache'],
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
          imageFormat: values['image-format'] as ImageFormat | undefined,
          jpegQuality: jpegQuality ?? 92,
          codec: values.codec as Codec | undefined,
          pixelFormat: values['pixel-format'] as PixelFormat | undefined,
          proresProfile: values['prores-profile'] as ProResProfile | undefined,
          crf: values.crf === undefined ? undefined : integer(values.crf, '--crf', 0),
          muted: values.muted,
          silentAudio: values['silent-audio'],
          audioCodec: values['audio-codec'] as AudioCodec | undefined,
          overwrite: values.overwrite ?? true,
          concurrency: integer(values.concurrency, '--concurrency', 1) ?? defaultConcurrency(),
          recycleTabs: values['recycle-tabs'] === undefined ? 1000 : integer(values['recycle-tabs'], '--recycle-tabs', 0),
          timeout: integer(values.timeout, '--timeout', 1000),
          videoCacheMb: integer(values['video-cache-mb'], '--video-cache-mb', 1),
          gl: values.gl as GlBackend | undefined,
          download: values.download,
          ffmpeg: values.ffmpeg ?? env.FREEMOTION_FFMPEG,
          browserExecutable: values['browser-executable'],
          progress: values.progress as 'json' | undefined,
        },
      };
    }

    case 'browser': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          help: { type: 'boolean', short: 'h' },
          'browser-executable': { type: 'string' },
        },
      });
      if (values.help) {
        return { name: 'help', topic: 'browser' };
      }
      const subcommand = positionals[0];
      if (!subcommand) {
        throw new Error('browser requires a subcommand. Available: ensure.');
      }
      if (subcommand !== 'ensure') {
        throw new Error(`Unknown browser subcommand "${subcommand}". Available: ensure.`);
      }
      return {
        name: 'browser',
        subcommand: 'ensure',
        options: {
          executablePath: values['browser-executable'],
        },
      };
    }

    default:
      throw new Error(`Unknown command "${name}". Run "freemotion --help" to see the commands.`);
  }
}
