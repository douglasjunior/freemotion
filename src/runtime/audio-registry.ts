import type { AudioAsset, AudioVolumeEntry } from '../shared/render-api.js';


export type AudioAssetKeyOptions = {
  readonly src: string;
  readonly startFrame: number;
  readonly trimBefore?: number;
  readonly trimAfter?: number;
  readonly playbackRate?: number;
  readonly loop?: boolean;
  readonly ordinal?: number;
};

export type RegisterAudioOptions = {
  readonly src: string;
  readonly frame: number;
  readonly offset: number;
  readonly volume: number;
  readonly trimBefore?: number;
  readonly trimAfter?: number;
  readonly playbackRate?: number;
  readonly loop?: boolean;
  readonly ordinal?: number;
};

/**
 * Extracts a clean media source identifier for audio and video assets:
 * - Decodes percent-encoded characters (e.g. "my%20song.mp3" -> "my song.mp3").
 * - Strips query parameters (?...) and hash fragments (#...).
 * - Strips leading slashes for local paths.
 * - For absolute remote URLs (e.g. "https://host/path"), preserves protocol and host.
 */
export function cleanAudioSrc(src: string): string {
  const match = src.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+/);
  if (match) {
    const origin = match[0];
    const rest = src.slice(origin.length);
    const [path] = rest.split(/[?#]/);
    let decoded = path ?? '';
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep original if decoding fails
    }
    return `${origin}/${decoded.replace(/^\/+/, '')}`;
  }

  const [path] = src.split(/[?#]/);
  let cleaned = (path ?? src).replace(/^\/+/, '');
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Keep original if decoding fails
  }
  return cleaned;
}

/** Pure 64-bit FNV-1a hash function returning a 16-character hex string. */
export function fnv1a(str: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Computes a stable audio asset identifier across render tabs and frames. */
export function audioAssetId(options: AudioAssetKeyOptions): string {
  const parts = [
    cleanAudioSrc(options.src),
    options.startFrame,
    options.trimBefore ?? 0,
    options.trimAfter ?? '',
    options.playbackRate ?? 1,
    options.loop ? 1 : 0,
    options.ordinal ?? 0,
  ].join('|');
  return `audio_${fnv1a(parts)}`;
}

type MutableAudioAsset = {
  readonly id: string;
  readonly src: string;
  readonly startFrame: number;
  readonly trimBefore: number;
  readonly trimAfter?: number;
  readonly playbackRate: number;
  readonly loop: boolean;
  readonly ordinal: number;
  readonly volumes: AudioVolumeEntry[];
};

export type RegisteredAudioAsset = AudioAsset & {
  readonly ordinal: number;
};

const registry = new Map<string, MutableAudioAsset>();
const ordinalCounts = new Map<string, number>();

/** Resets ordinal index counter before rendering each frame in the render page. */
export function beginAudioFrame(): void {
  ordinalCounts.clear();
}

/** Resets all registered audio assets and ordinal counters. */
export function clearAudioRegistry(): void {
  registry.clear();
  ordinalCounts.clear();
}

/** Registers an audio asset occurrence during frame rendering. */
export function registerAudio(options: RegisterAudioOptions): RegisteredAudioAsset {
  const cleanSrc = cleanAudioSrc(options.src);
  const startFrame = options.offset;
  const trimBefore = Math.max(0, Math.round(options.trimBefore ?? 0));
  const trimAfter = options.trimAfter !== undefined ? Math.round(options.trimAfter) : undefined;
  const playbackRate = options.playbackRate ?? 1;
  const loop = Boolean(options.loop);

  // Group key for ordinal tracking within this frame
  const groupKey = `${cleanSrc}|${startFrame}|${trimBefore}|${trimAfter ?? ''}|${playbackRate}|${loop ? 1 : 0}`;
  let ordinal: number;
  if (options.ordinal !== undefined) {
    ordinal = options.ordinal;
  } else {
    ordinal = ordinalCounts.get(groupKey) ?? 0;
    ordinalCounts.set(groupKey, ordinal + 1);
  }

  const id = audioAssetId({
    src: cleanSrc,
    startFrame,
    trimBefore,
    trimAfter,
    playbackRate,
    loop,
    ordinal,
  });

  let asset = registry.get(id);
  if (!asset) {
    asset = {
      id,
      src: cleanSrc,
      startFrame,
      trimBefore,
      trimAfter,
      playbackRate,
      loop,
      ordinal,
      volumes: [],
    };
    registry.set(id, asset);
  }

  const absoluteFrame = options.offset + options.frame;
  const rawVolume = typeof options.volume === 'number' && Number.isFinite(options.volume)
    ? options.volume
    : 0;
  const volume = Math.max(0, rawVolume);

  const lastVolume = asset.volumes[asset.volumes.length - 1];
  if (lastVolume && lastVolume[0] === absoluteFrame) {
    // Re-render in the same frame updates the volume
    asset.volumes[asset.volumes.length - 1] = [absoluteFrame, volume];
  } else {
    asset.volumes.push([absoluteFrame, volume]);
  }

  return asset;
}

/** Collects all registered audio assets with volumes sorted by frame, and clears the registry. */
export function collectAudio(): AudioAsset[] {
  const result: AudioAsset[] = [];
  for (const asset of registry.values()) {
    const sortedVolumes = [...asset.volumes].sort((a, b) => a[0] - b[0]);
    result.push({
      ...asset,
      volumes: sortedVolumes,
    });
  }
  clearAudioRegistry();
  return result;
}
