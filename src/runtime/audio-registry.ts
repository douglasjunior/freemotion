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
};

/** Extracts clean pathname without base, leading slashes or query/hash. */
export function cleanAudioSrc(src: string): string {
  try {
    const url = new URL(src, 'http://localhost');
    return url.pathname.replace(/^\/+/, '');
  } catch {
    const [path] = src.split(/[?#]/);
    return (path ?? src).replace(/^\/+/, '');
  }
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
  readonly volumes: AudioVolumeEntry[];
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
export function registerAudio(options: RegisterAudioOptions): AudioAsset {
  const cleanSrc = cleanAudioSrc(options.src);
  const startFrame = options.offset;
  const trimBefore = Math.max(0, Math.round(options.trimBefore ?? 0));
  const trimAfter = options.trimAfter !== undefined ? Math.round(options.trimAfter) : undefined;
  const playbackRate = options.playbackRate ?? 1;
  const loop = Boolean(options.loop);

  // Group key for ordinal tracking within this frame
  const groupKey = `${cleanSrc}|${startFrame}|${trimBefore}|${trimAfter ?? ''}|${playbackRate}|${loop ? 1 : 0}`;
  const ordinal = ordinalCounts.get(groupKey) ?? 0;
  ordinalCounts.set(groupKey, ordinal + 1);

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
      volumes: [],
    };
    registry.set(id, asset);
  }

  const absoluteFrame = options.offset + options.frame;
  const volume = Math.max(0, options.volume);

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
