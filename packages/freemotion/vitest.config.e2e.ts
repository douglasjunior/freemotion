import { defineConfig } from 'vitest/config';


// The e2e suite drives the built CLI (dist/) against real projects: Vite builds, Chromium renders,
// ffmpeg encodes. Each file starts its own browser, so they run one at a time.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
