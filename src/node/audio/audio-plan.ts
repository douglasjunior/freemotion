import { join } from 'node:path';

import type { AudioAsset } from '../../shared/render-api.js';

import { buildEnvelope, isConstantVolume } from './envelope.js';


export const MAX_INPUTS_PER_PASS = 32;

export type AudioProbeInfo = {
  readonly hasAudio: boolean;
  readonly duration: number; // in seconds
  readonly sampleRate?: number;
};

export type AudioProbeFunction = (
  src: string,
) => Promise<AudioProbeInfo | undefined> | AudioProbeInfo | undefined;

export type PlanAudioOptions = {
  readonly assets: readonly AudioAsset[];
  readonly fps: number;
  readonly range?: { readonly from: number; readonly to: number };
  readonly sampleRate?: number;
  readonly probe: AudioProbeFunction;
  readonly tempDir: string;
};

export type EnvelopeFile = {
  readonly path: string;
  readonly data: Float32Array;
};

export type AudioPass = {
  readonly args: readonly string[];
  readonly filterComplexScript?: {
    readonly path: string;
    readonly content: string;
  };
  readonly outputPath: string;
};

export type AudioPlan = {
  readonly passes: readonly AudioPass[];
  readonly envelopeFiles: readonly EnvelopeFile[];
  readonly outputPath: string;
  readonly duration: number; // in seconds
  readonly warnings: readonly string[];
};

/**
 * Decomposes a playback rate into a chain of `atempo` filters (each between 0.5 and 2.0).
 */
export function buildAtempoFilters(rate: number): string[] {
  if (Math.abs(rate - 1) < 1e-6) {
    return [];
  }
  const filters: string[] = [];
  let current = rate;
  while (current > 2.00001) {
    filters.push('atempo=2.0');
    current /= 2.0;
  }
  while (current < 0.49999) {
    filters.push('atempo=0.5');
    current /= 0.5;
  }
  if (Math.abs(current - 1) > 1e-6) {
    const formatted = current.toFixed(6).replace(/\.?0+$/, '');
    filters.push(`atempo=${formatted}`);
  }
  return filters;
}

type PreparedAsset = {
  readonly asset: AudioAsset;
  readonly effectiveFrom: number;
  readonly effectiveTo: number;
  readonly outputTimeSec: number;
  readonly outputDurationSec: number;
  readonly sourceStartSec: number;
  readonly loopSamples?: number;
  readonly loopOffsetSec?: number;
  readonly isConstant: boolean;
  readonly constantVolume: number;
  readonly envelopeData?: Float32Array;
  readonly envelopePath?: string;
};

/**
 * Plans ffmpeg audio mixing passes and envelope files from collected AudioAssets.
 * Pure function: no file system or child process I/O.
 */
export async function planAudio({
  assets,
  fps,
  range,
  sampleRate = 48000,
  probe,
  tempDir,
}: PlanAudioOptions): Promise<AudioPlan> {
  const warnings: string[] = [];
  const envelopeFiles: EnvelopeFile[] = [];
  const probeCache = new Map<string, AudioProbeInfo | undefined>();

  const rangeFrom = range?.from ?? 0;
  const rangeTo = range?.to;

  const validAssets: PreparedAsset[] = [];

  for (const asset of assets) {
    if (asset.volumes.length === 0) {
      continue;
    }

    let info = probeCache.get(asset.src);
    if (!probeCache.has(asset.src)) {
      info = await probe(asset.src);
      probeCache.set(asset.src, info);
    }

    if (!info || !info.hasAudio) {
      warnings.push(`freemotion: discarded audio asset "${asset.src}" (no audio stream found).`);
      continue;
    }

    const firstObserved = asset.volumes[0]![0];
    const lastObserved = asset.volumes[asset.volumes.length - 1]![0];

    const effectiveFrom = Math.max(rangeFrom, firstObserved);
    const effectiveTo = rangeTo !== undefined ? Math.min(rangeTo, lastObserved + 1) : (lastObserved + 1);

    if (effectiveFrom >= effectiveTo) {
      continue;
    }

    const outputTimeSec = Math.max(0, (effectiveFrom - rangeFrom) / fps);
    const outputDurationSec = (effectiveTo - effectiveFrom) / fps;

    let loopSamples: number | undefined;
    let loopDurationSec: number | undefined;
    if (asset.loop) {
      loopDurationSec = asset.trimAfter !== undefined
        ? (asset.trimAfter - asset.trimBefore) / fps
        : (info.duration - (asset.trimBefore / fps));

      if (loopDurationSec <= 0 || !Number.isFinite(loopDurationSec)) {
        throw new Error(
          `freemotion: cannot loop audio asset "${asset.src}" with duration <= 0 (probed ${info.duration}s, trimBefore ${asset.trimBefore}).`,
        );
      }
      const assetSampleRate = info.sampleRate || sampleRate;
      loopSamples = Math.round(loopDurationSec * assetSampleRate);
    }

    let sourceStartSec: number;
    let loopOffsetSec = 0;

    if (asset.loop && loopDurationSec !== undefined && loopDurationSec > 0) {
      sourceStartSec = asset.trimBefore / fps;
      const elapsedSrc = ((effectiveFrom - asset.startFrame) * asset.playbackRate) / fps;
      loopOffsetSec = ((elapsedSrc % loopDurationSec) + loopDurationSec) % loopDurationSec;
    } else {
      const elapsedSrc = ((effectiveFrom - asset.startFrame) * asset.playbackRate) / fps;
      sourceStartSec = (asset.trimBefore / fps) + elapsedSrc;
    }

    const volCheck = isConstantVolume(asset.volumes);
    let envelopeData: Float32Array | undefined;
    let envelopePath: string | undefined;

    if (!volCheck.constant) {
      envelopeData = buildEnvelope({
        volumes: asset.volumes,
        fromFrame: effectiveFrom,
        toFrame: effectiveTo,
        fps,
        sampleRate: 1000,
      });
      envelopePath = join(tempDir, `env_${asset.id}.f32`);
      envelopeFiles.push({ path: envelopePath, data: envelopeData });
    }

    validAssets.push({
      asset,
      effectiveFrom,
      effectiveTo,
      outputTimeSec,
      outputDurationSec,
      sourceStartSec: Math.max(0, sourceStartSec),
      loopSamples,
      loopOffsetSec,
      isConstant: volCheck.constant,
      constantVolume: volCheck.value,
      envelopeData,
      envelopePath,
    });
  }

  // Sort assets by timeline start time ascending
  validAssets.sort((a, b) => a.outputTimeSec - b.outputTimeSec);

  // Compute total composition duration
  let totalDurationSec = 0;
  if (rangeTo !== undefined) {
    totalDurationSec = Math.max(0, (rangeTo - rangeFrom) / fps);
  } else if (validAssets.length > 0) {
    totalDurationSec = Math.max(...validAssets.map(a => a.outputTimeSec + a.outputDurationSec));
  }

  const finalOutputPath = join(tempDir, 'mixed_audio.wav');

  // Case 0: No audio assets
  if (validAssets.length === 0) {
    if (totalDurationSec <= 0) {
      return {
        passes: [],
        envelopeFiles: [],
        outputPath: finalOutputPath,
        duration: 0,
        warnings,
      };
    }

    const silencePass: AudioPass = {
      args: [
        '-f', 'lavfi',
        '-i', `anullsrc=r=${sampleRate}:cl=stereo`,
        '-t', totalDurationSec.toFixed(6),
        '-c:a', 'pcm_s16le',
        finalOutputPath,
      ],
      outputPath: finalOutputPath,
    };

    return {
      passes: [silencePass],
      envelopeFiles: [],
      outputPath: finalOutputPath,
      duration: totalDurationSec,
      warnings,
    };
  }

  // Helper to build filter chain and arguments for a single pass
  const buildPass = (
    passAssets: readonly PreparedAsset[],
    outputPath: string,
    passName: string,
    isFinal: boolean,
    timelineOffsetSec = 0,
    enforceDurationSec?: number,
  ): AudioPass => {
    const args: string[] = [];
    const filterLines: string[] = [];
    let currentInputIdx = 0;
    const outputLabels: string[] = [];

    for (let i = 0; i < passAssets.length; i++) {
      const item = passAssets[i]!;
      const audioInputIdx = currentInputIdx++;
      args.push('-i', item.asset.src);

      let envInputIdx = -1;
      if (!item.isConstant && item.envelopePath) {
        envInputIdx = currentInputIdx++;
        args.push('-f', 'f32le', '-ar', '1000', '-ac', '1', '-i', item.envelopePath);
      }

      const filters: string[] = [];
      if (item.loopSamples !== undefined) {
        // Loop mode:
        // 1. Trim to the complete loop segment (from trimBefore to trimAfter)
        const trimParts = [`start=${item.sourceStartSec.toFixed(6)}`];
        if (item.asset.trimAfter !== undefined) {
          trimParts.push(`end=${(item.asset.trimAfter / fps).toFixed(6)}`);
        }
        filters.push(`atrim=${trimParts.join(':')}`, 'asetpts=PTS-STARTPTS');

        // 2. Loop the complete slice
        filters.push(`aloop=loop=-1:size=${item.loopSamples}`);

        // 3. If offset within loop > 0, discard the initial slice of the looped stream
        if (item.loopOffsetSec && item.loopOffsetSec > 1e-6) {
          filters.push(`atrim=start=${item.loopOffsetSec.toFixed(6)}`, 'asetpts=PTS-STARTPTS');
        }
      } else {
        // Non-loop mode:
        // 1. Source trim and pts reset
        const trimParts = [`start=${item.sourceStartSec.toFixed(6)}`];
        if (item.asset.trimAfter !== undefined) {
          trimParts.push(`end=${(item.asset.trimAfter / fps).toFixed(6)}`);
        }
        filters.push(`atrim=${trimParts.join(':')}`, 'asetpts=PTS-STARTPTS');
      }

      // Playback rate (atempo)
      filters.push(...buildAtempoFilters(item.asset.playbackRate));

      // Output duration trimming
      filters.push(`atrim=duration=${item.outputDurationSec.toFixed(6)}`, 'asetpts=PTS-STARTPTS');

      // 5. Volume
      if (item.isConstant) {
        filters.push(`volume=${item.constantVolume.toFixed(6)}`);
        filters.push(`aformat=channel_layouts=stereo:sample_rates=${sampleRate}`);
      } else {
        filters.push(`aformat=channel_layouts=stereo:sample_rates=${sampleRate}`);
      }

      // 6. Delay within this pass
      const delaySec = Math.max(0, item.outputTimeSec - timelineOffsetSec);
      const delayMs = Math.round(delaySec * 1000);

      if (item.isConstant) {
        if (delayMs > 0) {
          filters.push(`adelay=${delayMs}|${delayMs}`);
        }
        const outLabel = `a_${i}`;
        filterLines.push(`[${audioInputIdx}:a]${filters.join(',')}[${outLabel}]`);
        outputLabels.push(`[${outLabel}]`);
      } else {
        const preVolLabel = `pre_vol_${i}`;
        const envLabel = `env_${i}`;
        const outLabel = `a_${i}`;
        filterLines.push(`[${audioInputIdx}:a]${filters.join(',')}[${preVolLabel}]`);
        filterLines.push(
          `[${envInputIdx}:a]aresample=${sampleRate},aformat=sample_fmts=fltp,pan=stereo|c0=c0|c1=c0[${envLabel}]`,
        );
        const postMulFilters = ['amultiply'];
        if (delayMs > 0) {
          postMulFilters.push(`adelay=${delayMs}|${delayMs}`);
        }
        filterLines.push(`[${preVolLabel}][${envLabel}]${postMulFilters.join(',')}[${outLabel}]`);
        outputLabels.push(`[${outLabel}]`);
      }
    }

    // 7. Mix inputs
    let mixLabel: string;
    if (outputLabels.length === 1) {
      mixLabel = outputLabels[0]!;
    } else {
      mixLabel = '[mixed]';
      filterLines.push(`${outputLabels.join('')}amix=inputs=${outputLabels.length}:normalize=0:duration=longest${mixLabel}`);
    }

    // 8. Final formatting and duration clamp
    if (isFinal && enforceDurationSec !== undefined) {
      const formattedDuration = enforceDurationSec.toFixed(6);
      filterLines.push(
        `${mixLabel}atrim=duration=${formattedDuration},apad=whole_dur=${formattedDuration}[out_final]`,
      );
      mixLabel = '[out_final]';
    }

    const fullFilterComplex = filterLines.join(';\n');

    let filterComplexScript: { readonly path: string; readonly content: string } | undefined;
    if (fullFilterComplex.length > 2048) {
      const scriptPath = join(tempDir, `filter_${passName}.txt`);
      filterComplexScript = { path: scriptPath, content: fullFilterComplex };
      args.push('-filter_complex_script', scriptPath);
    } else {
      args.push('-filter_complex', fullFilterComplex);
    }

    args.push('-map', mixLabel);
    if (isFinal) {
      args.push('-c:a', 'pcm_s16le', outputPath);
    } else {
      args.push('-c:a', 'pcm_f32le', outputPath);
    }

    return {
      args,
      filterComplexScript,
      outputPath,
    };
  };

  // Case 1: Single pass (assets <= MAX_INPUTS_PER_PASS)
  if (validAssets.length <= MAX_INPUTS_PER_PASS) {
    const singlePass = buildPass(
      validAssets,
      finalOutputPath,
      'pass_final',
      true,
      0,
      totalDurationSec,
    );

    return {
      passes: [singlePass],
      envelopeFiles,
      outputPath: finalOutputPath,
      duration: totalDurationSec,
      warnings,
    };
  }

  // Case 2: Batch mixing (assets > MAX_INPUTS_PER_PASS)
  const passes: AudioPass[] = [];
  const batchOutputs: { readonly path: string; readonly startSec: number; readonly durationSec: number }[] = [];

  for (let i = 0; i < validAssets.length; i += MAX_INPUTS_PER_PASS) {
    const chunk = validAssets.slice(i, i + MAX_INPUTS_PER_PASS);
    const batchIdx = Math.floor(i / MAX_INPUTS_PER_PASS);
    const batchPath = join(tempDir, `batch_${batchIdx}.wav`);

    const batchStartSec = Math.min(...chunk.map(a => a.outputTimeSec));
    const batchEndSec = Math.max(...chunk.map(a => a.outputTimeSec + a.outputDurationSec));
    const batchDurationSec = batchEndSec - batchStartSec;

    const batchPass = buildPass(
      chunk,
      batchPath,
      `batch_${batchIdx}`,
      false,
      batchStartSec,
    );

    passes.push(batchPass);
    batchOutputs.push({
      path: batchPath,
      startSec: batchStartSec,
      durationSec: batchDurationSec,
    });
  }

  // Final combiner pass mixing all batch files
  const combinerArgs: string[] = [];
  const combinerFilterLines: string[] = [];
  const combinerLabels: string[] = [];

  for (let b = 0; b < batchOutputs.length; b++) {
    const batch = batchOutputs[b]!;
    combinerArgs.push('-i', batch.path);
    const delayMs = Math.round(batch.startSec * 1000);
    const delayedLabel = `b_${b}`;
    if (delayMs > 0) {
      combinerFilterLines.push(`[${b}:a]adelay=${delayMs}|${delayMs}[${delayedLabel}]`);
    } else {
      combinerFilterLines.push(`[${b}:a]anull[${delayedLabel}]`);
    }
    combinerLabels.push(`[${delayedLabel}]`);
  }

  let finalMixLabel: string;
  if (combinerLabels.length === 1) {
    finalMixLabel = combinerLabels[0]!;
  } else {
    finalMixLabel = '[mixed]';
    combinerFilterLines.push(
      `${combinerLabels.join('')}amix=inputs=${combinerLabels.length}:normalize=0:duration=longest${finalMixLabel}`,
    );
  }

  const finalFormattedDuration = totalDurationSec.toFixed(6);
  combinerFilterLines.push(
    `${finalMixLabel}atrim=duration=${finalFormattedDuration},apad=whole_dur=${finalFormattedDuration}[out_final]`,
  );

  const finalFilterComplex = combinerFilterLines.join(';\n');
  let combinerScript: { readonly path: string; readonly content: string } | undefined;
  if (finalFilterComplex.length > 2048) {
    const scriptPath = join(tempDir, 'filter_combiner.txt');
    combinerScript = { path: scriptPath, content: finalFilterComplex };
    combinerArgs.push('-filter_complex_script', scriptPath);
  } else {
    combinerArgs.push('-filter_complex', finalFilterComplex);
  }

  combinerArgs.push('-map', '[out_final]', '-c:a', 'pcm_s16le', finalOutputPath);

  passes.push({
    args: combinerArgs,
    filterComplexScript: combinerScript,
    outputPath: finalOutputPath,
  });

  return {
    passes,
    envelopeFiles,
    outputPath: finalOutputPath,
    duration: totalDurationSec,
    warnings,
  };
}
