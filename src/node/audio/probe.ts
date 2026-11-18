import { spawn } from 'node:child_process';

import type { AudioProbeInfo } from './audio-plan.js';


/**
 * Parses audio metadata from ffmpeg stderr output.
 */
export function parseAudioProbeInfo(stderr: string): AudioProbeInfo {
  const hasAudio = /Stream\s+#\d+:\d+.*?: Audio:/.test(stderr);
  if (!hasAudio) {
    return { hasAudio: false, duration: 0 };
  }

  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durationMatch && durationMatch[1] && durationMatch[2] && durationMatch[3]
    ? parseInt(durationMatch[1], 10) * 3600 + parseInt(durationMatch[2], 10) * 60 + parseFloat(durationMatch[3])
    : 0;

  const rateMatch = stderr.match(/Stream\s+#\d+:\d+.*?: Audio:.*?(\d{4,6})\s*Hz/);
  const sampleRate = rateMatch && rateMatch[1] ? parseInt(rateMatch[1], 10) : 48000;

  return {
    hasAudio: true,
    duration,
    sampleRate,
  };
}

/**
 * Probes any media file (audio or video) for audio streams and duration via ffmpeg.
 */
export async function probeAudioMedia(filePath: string, ffmpeg = 'ffmpeg'): Promise<AudioProbeInfo> {
  return new Promise<AudioProbeInfo>((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-hide_banner', '-i', filePath]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', reject);
    proc.on('close', () => {
      resolve(parseAudioProbeInfo(stderr));
    });
  });
}
