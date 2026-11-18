import { spawn } from 'node:child_process';
import { rm, stat, writeFile } from 'node:fs/promises';

import type { AudioPlan } from './audio-plan.js';


export type MixAudioOptions = {
  readonly ffmpeg?: string;
  readonly cleanup?: boolean;
};

/**
 * Executes planned audio passes in sequence with ffmpeg.
 * Writes envelope files, executes ffmpeg passes, and cleans up temporary files in finally.
 * Returns the path to the final mixed audio file.
 */
export async function mixAudio(
  plan: AudioPlan,
  options: MixAudioOptions = {},
): Promise<string> {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  const shouldCleanup = options.cleanup ?? true;

  try {
    // 1. Write envelope files
    for (const envFile of plan.envelopeFiles) {
      await writeFile(
        envFile.path,
        Buffer.from(envFile.data.buffer, envFile.data.byteOffset, envFile.data.byteLength),
      );
    }

    // 2. Write filter_complex_script files if present
    for (const pass of plan.passes) {
      if (pass.filterComplexScript) {
        await writeFile(pass.filterComplexScript.path, pass.filterComplexScript.content, 'utf8');
      }
    }

    // 3. Execute all passes in sequence
    for (let passIdx = 0; passIdx < plan.passes.length; passIdx++) {
      const pass = plan.passes[passIdx]!;
      const fullArgs = ['-hide_banner', '-loglevel', 'error', '-y', ...pass.args];
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpeg, fullArgs);
        let stderr = '';
        proc.stderr?.on('data', (chunk) => {
          stderr += chunk;
        });
        proc.on('error', (err) => {
          reject(
            new Error(
              `freemotion: failed to spawn ffmpeg for audio mixing pass ${passIdx + 1}/${plan.passes.length}: ${err.message}`,
            ),
          );
        });
        proc.on('close', (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `freemotion: ffmpeg audio mixing pass ${passIdx + 1}/${plan.passes.length} failed with code ${code}: ${stderr.trim()}`,
              ),
            );
          } else {
            resolve();
          }
        });
      });
    }

    if (plan.passes.length > 0) {
      try {
        const s = await stat(plan.outputPath);
        if (s.size === 0) {
          throw new Error(`freemotion: audio mixing produced an empty file (0 bytes) at "${plan.outputPath}".`);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`freemotion: audio mixing failed to produce output file at "${plan.outputPath}".`);
        }
        throw err;
      }
    }

    return plan.outputPath;
  } finally {
    if (shouldCleanup) {
      for (const envFile of plan.envelopeFiles) {
        await rm(envFile.path, { force: true }).catch(() => undefined);
      }
      for (const pass of plan.passes) {
        if (pass.filterComplexScript) {
          await rm(pass.filterComplexScript.path, { force: true }).catch(() => undefined);
        }
      }
      if (plan.passes.length > 1) {
        for (let i = 0; i < plan.passes.length - 1; i++) {
          await rm(plan.passes[i]!.outputPath, { force: true }).catch(() => undefined);
        }
      }
    }
  }
}
