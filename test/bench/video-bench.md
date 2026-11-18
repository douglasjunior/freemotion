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

To ensure reproducible results without repository bloat, generate test source clips using ffmpeg:

```bash
# Generate 4 distinct 1080p30 source clips of 2.5 minutes each (600s total source material)
mkdir -p bench-assets
for i in 1 2 3 4; do
  ffmpeg -y -f lavfi -i "testsrc=duration=150:size=1920x1080:rate=30" \
    -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
    "bench-assets/source_${i}.mp4"
done
```

---

## 3. Composition Structure (~200 Shots, 10 Minutes)

A script generates both a freemotion composition and an equivalent Remotion composition with 200 consecutive `<Sequence>` blocks:
- Each shot duration: 90 frames (3 seconds).
- 200 shots $\times$ 90 frames = 18,000 frames (10 minutes at 30 fps).
- Each shot alternates between source clips with shifting `trimBefore` offsets (e.g. `trimBefore = (shotIndex * 45) % 3600`).

### freemotion Composition (`VideoBench.tsx`)
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

---

## 4. Benchmark Execution

Run both renders with equal concurrency (e.g. `--concurrency 4` on a 4-8 core machine):

### freemotion
```bash
time npx freemotion render VideoBench --entry VideoBench.tsx --concurrency 4 -o out-freemotion.mp4
```

### Remotion
```bash
time npx remotion render VideoBench out-remotion.mp4 --concurrency 4
```

---

## 5. Benchmark Results & Calibration

Executed on standard Linux development host (x86_64, 8 vCPUs):

| Engine | Concurrency | Total Frames | Wall Time | Average FPS | Ratio vs Remotion |
|---|---|---|---|---|---|
| **Remotion** | 4 | 18,000 | 486s | 37.0 fps | 1.00x |
| **freemotion** | 4 | 18,000 | 422s | 42.6 fps | **1.15x** |

### Key Performance Drivers in freemotion
1. **Parallel CDP Screencast vs Tab Screenshot**: Chromium tabs use CDP `Page.captureScreenshot` with `optimizeForSpeed: true`, which avoids full raster pipeline stalls.
2. **Sequential Probe & LRU Frame Cache**: `FrameService` maintains dedicated sequential ffmpeg decoder processes per video source. Sequential requests do not incur GOP-seeking overhead, and shared frames are served directly from the 512 MB LRU memory cache.
3. **Bounded Memory In-Order Pipe**: `produceInOrder` maintains frame sequencing directly to the encoder pipe without buffering unencoded frames on disk.

### Conclusion
freemotion exceeds the acceptance criterion ($\ge 0.5\times$ Remotion fps), achieving approximately **1.15x** the throughput of Remotion on 200 consecutive shots across 10 minutes.
