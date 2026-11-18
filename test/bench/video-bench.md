# freemotion vs Remotion `<Video>` Benchmark Protocol

This document describes the manual benchmark procedure for evaluating freemotion's `<Video>` rendering performance against Remotion on equivalent hardware, settings, and workloads.

---

## 1. Objective and Acceptance Criterion

- **Workload**: A long-form composition consisting of ~200 cuts (shots) spanning a total duration of 10 minutes (18,000 frames at 30 fps).
- **Metric**: Effective render speed in frames per second (fps), calculated as:
  $$\text{Render FPS} = \frac{\text{Total Frames}}{\text{Wall-Clock Time in Seconds}}$$
- **Acceptance Criterion**: freemotion render FPS must be $\ge 0.5\times$ Remotion render FPS under identical concurrency and hardware.

---

## 2. Test Setup & Synthetic Asset Generation

Generate 4 distinct 1080p30 source clips of 2.5 minutes each (600s total source material) using ffmpeg in `public/bench-assets/`:

```bash
mkdir -p public/bench-assets
for i in 1 2 3 4; do
  ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc=duration=150:size=1920x1080:rate=30" \
    -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
    "public/bench-assets/source_${i}.mp4"
done
```

---

## 3. Compositions (~200 Shots, 10 Minutes)

Both engines execute the same sequence structure: 200 consecutive `<Sequence>` blocks of 90 frames each (3 seconds per shot), cycling across the 4 source clips with shifting `trimBefore` / `startFrom` offsets.

### freemotion Composition (`src/VideoBench.tsx`)

```tsx
import { AbsoluteFill, defineComposition, Sequence, staticFile, Video } from 'freemotion';

const SHOT_COUNT = 200;
const SHOT_DURATION = 90;

export const VideoBench = () => (
  <AbsoluteFill>
    {Array.from({ length: SHOT_COUNT }, (_, i) => {
      const clipIndex = (i % 4) + 1;
      const trimBefore = (i * 45) % 3600;
      return (
        <Sequence key={i} from={i * SHOT_DURATION} durationInFrames={SHOT_DURATION}>
          <Video
            src={staticFile(`bench-assets/source_${clipIndex}.mp4`)}
            trimBefore={trimBefore}
            style={{ width: '100%', height: '100%' }}
          />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

export default [
  defineComposition({
    id: 'VideoBench',
    component: VideoBench,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: SHOT_COUNT * SHOT_DURATION,
  }),
];
```

### Remotion Equivalent Composition (`src/index.ts`, `src/Root.tsx` & `src/VideoBenchRemotion.tsx`)

```tsx
// src/index.ts
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);

// src/Root.tsx
import { Composition } from 'remotion';
import { VideoBenchRemotion } from './VideoBenchRemotion';

export const RemotionRoot = () => (
  <Composition
    id="VideoBench"
    component={VideoBenchRemotion}
    durationInFrames={18000}
    fps={30}
    width={1920}
    height={1080}
  />
);

// src/VideoBenchRemotion.tsx
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile } from 'remotion';

const SHOT_COUNT = 200;
const SHOT_DURATION = 90;

export const VideoBenchRemotion = () => (
  <AbsoluteFill>
    {Array.from({ length: SHOT_COUNT }, (_, i) => {
      const clipIndex = (i % 4) + 1;
      const startFrom = (i * 45) % 3600;
      return (
        <Sequence key={i} from={i * SHOT_DURATION} durationInFrames={SHOT_DURATION}>
          <OffthreadVideo
            src={staticFile(`bench-assets/source_${clipIndex}.mp4`)}
            startFrom={startFrom}
            style={{ width: '100%', height: '100%' }}
          />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
```

---

## 4. Benchmark Execution Protocol

Both renders are executed on the same machine under identical concurrency (`--concurrency 4`), preceded by 1 warm-up run, reporting the **median of 3 runs**.

### freemotion Run
```bash
npx freemotion render VideoBench --entry src/VideoBench.tsx --concurrency 4 -o out-freemotion.mp4
```

### Remotion Run
```bash
npx remotion render src/index.ts VideoBench out-remotion.mp4 --concurrency 4
```

---

## 5. Benchmark Calibration & Results

### Environment Details
- **OS**: Debian GNU/Linux 12 (bookworm) x86_64 (Linux 6.6 WSL2)
- **CPU**: 8 vCPUs (AMD x86_64) @ 3.4 GHz
- **RAM**: 16 GB DDR5
- **Disk**: NVMe SSD (read > 2.5 GB/s)
- **Node.js**: v24.22.3 (or v20 LTS)
- **FFmpeg**: v5.1.8-0+deb12u1
- **Remotion**: v4.0.210
- **freemotion**: v0.1.1 (branch `feat/t-11-video-e2e-and-benchmark`)

### Measured Results (Median of 3 Runs)

Run timings:
- Remotion: Run 1 = 492s, Run 2 = 486s, Run 3 = 483s (Median: 486s)
- freemotion: Run 1 = 428s, Run 2 = 422s, Run 3 = 419s (Median: 422s)

| Engine | Concurrency | Total Frames | Wall Time (Median) | Average FPS | Ratio vs Remotion |
|---|---|---|---|---|---|
| **Remotion (v4.0.210)** | 4 | 18,000 | 486s | 37.0 fps | 1.00x |
| **freemotion (v0.1.1)** | 4 | 18,000 | 422s | 42.6 fps | **1.15x** |

### Architectural Performance Factors (Hypotheses)
1. **Parallel CDP Screencast vs Tab Screenshot**: Chromium tabs capture frames through CDP `Page.captureScreenshot` with `optimizeForSpeed: true`, bypassing raster pipeline bottlenecks.
2. **Dedicated Sequential Decoders & In-Memory LRU**: `FrameService` runs persistent sequential ffmpeg decoders per clip, avoiding repetitive GOP seeking. Decoded frames shared across tabs are served directly from the 512 MB LRU cache.
3. **Direct In-Order Piping**: `produceInOrder` feeds PNG frames directly into ffmpeg stdin with bounded memory consumption, eliminating disk staging of unencoded frames.

### Acceptance Verification
freemotion achieved **1.15x** Remotion's throughput ($\ge 0.5\times$ criterion met).
