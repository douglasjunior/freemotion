# AGENTS: freemotion

## Overview

**freemotion** makes videos with React. A composition is a React component whose output depends only on the current frame; the package ships the runtime that compositions import, a CLI (`init`, `studio`, `render`, `browser`) and a `<Player>` for web pages.

Everything in the repository is written in **English**: source code, identifiers, tests, comments, documentation and commit messages.

## Repository Structure

The repository is a pnpm monorepo. The root is private (shared ESLint config, `tsconfig.base.json`, CI); the published `freemotion` package lives in `packages/freemotion/`, and every path below is relative to it except `packages/three/`, which is a sibling package.

```text
packages/freemotion/
├── src/
│   ├── index.ts              # Public runtime API (what `import 'freemotion'` gives)
│   ├── runtime/              # Browser code imported by compositions
│   │   ├── frame.tsx         # Frame context: useCurrentFrame, useVideoConfig, FrameProvider
│   │   ├── stage.tsx         # <Stage>: one frame at native size (scoped border-box CSS)
│   │   ├── audio.tsx, audio-registry.ts, video.tsx, freeze.tsx, font.ts
│   │   ├── environment.ts, playback.tsx, context-bridge.tsx, timeline-registry.ts
│   │   ├── sequence.tsx      # <Sequence>, <Series>
│   │   ├── interpolate.ts, easing.ts, spring.ts, random.ts
│   │   ├── delay-render.ts   # Render holds: delayRender/continueRender/cancelRender
│   │   ├── img.tsx, static-file.ts, absolute-fill.tsx
│   │   ├── composition.ts    # defineComposition, validateCompositions
│   │   ├── player.tsx        # <Player>
│   │   └── scroll.tsx        # useScrollFrame, <ScrollPlayer>, scrollProgress
│   ├── studio/               # Browser apps served/bundled by the CLI
│   │   ├── main.tsx, studio.tsx  # `freemotion studio`
│   │   ├── timeline.tsx, timeline-layout.ts, keys.ts
│   │   ├── render-page.tsx   # Page the renderer drives in headless Chromium
│   │   ├── svg-recorder.ts   # Animated SVG: samples the stage's DOM after each frame, embeds styles and resources
│   │   └── svg-export.ts     # Animated SVG: turns the samples into a <foreignObject> + CSS @keyframes document (pure)
│   ├── shared/render-api.ts  # Contract between render-page (browser) and render.ts (Node)
│   └── node/                 # The CLI (Node only)
│       ├── cli.ts            # bin entry
│       ├── args.ts           # Argument parsing and help texts
│       ├── vite-config.ts    # Vite plugin: virtual entry, runtime alias, studio HTML, render HTML
│       ├── render.ts         # Build → preview server → Chromium tabs → ffmpeg
│       ├── video/            # Frame server, decoding and LRU cache
│       ├── audio/            # Audio collection, planning and mixing
│       ├── progress.ts, gl.ts, bundle-cache.ts, public-dir.ts
│       ├── ordered-frames.ts # Parallel capture, in-order consumption, bounded memory
│       ├── ffmpeg.ts         # Encoder arguments; finds ffmpeg (flag, env, project's ffmpeg-static, PATH)
│       ├── browser.ts, studio.ts, init.ts, project.ts, paths.ts, logger.ts
├── templates/default/        # What `freemotion init` copies (`_gitignore` becomes `.gitignore`)
├── test/                     # e2e suite (`*.e2e-spec.ts`) and its fixture project
├── tsconfig.json             # Type checks src/ and test/ (NodeNext)
├── tsconfig.build.json       # Emits dist/ from src/
└── tsconfig.projects.json    # Type checks templates/ and test/fixtures/ (bundler resolution)

packages/three/               # @free-motion/three (ThreeCanvas)
```

## How the Pieces Fit

- **One runtime instance.** The Vite plugin aliases `freemotion` to `dist/index.js`, and the studio and render page import the runtime by relative path inside `dist/`. Both resolve to the same files, so the project's components and the host share one React context and one render-hold registry. React is deduped for the same reason.
- **Everything derives from the frame.** Runtime code never keeps time on its own (no timers or CSS animations). The renderer draws frames in parallel tabs and in any order; the studio and the player jump to arbitrary frames.
- **Rendering pipeline** (`src/node/render.ts`): Vite build to a temp dir with `render-page` as input, `renderHtmlPlugin` writes `index.html`, Vite preview serves it, each tab `mount()`s the composition and, per frame, `setFrame()` renders with `flushSync`, waits for fonts, holds, images and two animation frames, then the tab is captured through CDP `Page.captureScreenshot` with `optimizeForSpeed` (several times faster than `page.screenshot`, same pixels). `produceInOrder` feeds PNGs to ffmpeg in order.
- **Video and audio.** A separate local frame server decodes video with ffmpeg, serves frames with CORS, and bounds decoded data with an LRU cache. Tabs collect audio assets and per-frame envelopes; the Node pipeline merges the observations, mixes tracks in batches with ffmpeg, and muxes audio with the video.
- **Render resources.** The renderer recycles tabs after a configurable number of frames. Bundle builds are cached and project public assets are served without copying. `--gl` selects Chromium's WebGL backend; `swangle` supports headless software rendering.
- **Three.** `useContextBridge` passes frame and playback contexts into the R3F reconciler. Environment and render holds are module state and cross reconcilers only when the runtime is shared. `ThreeCanvas` advances R3F from the composition frame and holds rendering during loading and drawing.
- **Animated SVG** (`--format svg`): one tab, frames in order; after each `setFrame()` the page records the stage's DOM (`svg-recorder.ts`) and at the end builds the file (`svg-export.ts`): the markup inside a `<foreignObject>`, and every value that changed between frames as `@keyframes` stepping at the frame rate. Elements are written once per contiguous run of frames they are rendered in, and what is inside them starts with a negative `animation-delay`, because Chromium only starts animations once every ancestor is displayed. No ffmpeg.
- **Errors must fail the render.** Render errors are caught through `onUncaughtError` in the render page; any `pageerror` in a tab also aborts.

## Conventions

- Audio identities must be stable across tabs and arbitrary frame order; do not use React `useId` for cross-tab asset identity.
- The repository uses pnpm workspaces (`pnpm-workspace.yaml`); keep the core and `packages/three` build and tests working together.
- ESM everywhere; relative imports in `src/` use the `.js` extension (NodeNext). Templates and fixtures use bundler resolution and extensionless imports.
- Style is enforced by ESLint with `@stylistic` (no Prettier). Run `pnpm lint:fix` before committing.
- Public API changes go together with the README (API table, examples) and tests.
- Unit tests live next to the code as `*.spec.ts(x)` and run in Node; React output is checked with `renderToStaticMarkup`. Anything that needs Chromium or ffmpeg belongs in `test/*.e2e-spec.ts`, which runs against `dist/`.
- Error messages are written for the user of the CLI: say what is wrong and what to do.

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Compiles the core and workspace packages |
| `pnpm ts` | Type checks the core, workspaces, templates and fixtures |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm test` | Core and workspace unit tests |
| `pnpm test:e2e` | Builds, then runs the CLI against `packages/freemotion/test/fixtures/basic` (renders, studio, scroll page) and a fresh `init` project (needs ffmpeg) |
