import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';


export default defineConfig({
  resolve: { alias: { freemotion: fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
