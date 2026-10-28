# AGENTS: freemotion

## Overview

**freemotion** makes videos with React. A composition is a React component whose output depends only on the current frame; the package ships the runtime that compositions import, a CLI with three commands (`init`, `studio`, `render`) and a `<Player>` for web pages.

Everything in the repository is written in **English**: source code, identifiers, tests, comments, documentation and commit messages.

## Repository Structure

```text
freemotion/
├── src/
│   ├── index.ts              # Public runtime API (what `import 'freemotion'` gives)
│   ├── runtime/              # Browser code imported by compositions
│   │   ├── frame.tsx         # Frame context: useCurrentFrame, useVideoConfig, FrameProvider
│   │   ├── stage.tsx         # <Stage>: one frame at native size (scoped border-box CSS)
│   │   ├── sequence.tsx      # <Sequence>, <Series>
│   │   ├── interpolate.ts, easing.ts, spring.ts, random.ts
│   │   ├── delay-render.ts   # Render holds: delayRender/continueRender/cancelRender
│   │   ├── img.tsx, static-file.ts, absolute-fill.tsx
│   │   ├── composition.ts    # defineComposition, validateCompositions
│   │   ├── player.tsx        # <Player>
│   │   └── scroll.tsx        # useScrollFrame, <ScrollPlayer>, scrollProgress
│   ├── studio/               # Browser apps served/bundled by the CLI
│   │   ├── main.tsx, studio.tsx  # `freemotion studio`
│   │   └── render-page.tsx   # Page the renderer drives in headless Chromium
│   ├── shared/render-api.ts  # Contract between render-page (browser) and render.ts (Node)
│   └── node/                 # The CLI (Node only)
│       ├── cli.ts            # bin entry
│       ├── args.ts           # Argument parsing and help texts
│       ├── vite-config.ts    # Vite plugin: virtual entry, runtime alias, studio HTML, render HTML
│       ├── render.ts         # Build → preview server → Chromium tabs → ffmpeg
│       ├── ordered-frames.ts # Parallel capture, in-order consumption, bounded memory
│       ├── ffmpeg.ts         # Encoder arguments; finds ffmpeg (flag, env, project's ffmpeg-static, PATH)
│       ├── browser.ts, studio.ts, init.ts, project.ts, paths.ts, logger.ts
├── templates/default/        # What `freemotion init` copies (`_gitignore` becomes `.gitignore`)
├── test/                     # e2e suite (`*.e2e-spec.ts`) and its fixture project
├── tsconfig.json             # Type checks src/ and test/ (NodeNext)
├── tsconfig.build.json       # Emits dist/ from src/
└── tsconfig.projects.json    # Type checks templates/ and test/fixtures/ (bundler resolution)
```

## How the Pieces Fit

- **One runtime instance.** The Vite plugin aliases `freemotion` to `dist/index.js`, and the studio and render page import the runtime by relative path inside `dist/`. Both resolve to the same files, so the project's components and the host share one React context and one render-hold registry. React is deduped for the same reason.
- **Everything derives from the frame.** Runtime code never keeps time on its own (no timers or CSS animations). The renderer draws frames in parallel tabs and in any order; the studio and the player jump to arbitrary frames.
- **Rendering pipeline** (`src/node/render.ts`): Vite build to a temp dir with `render-page` as input, `renderHtmlPlugin` writes `index.html`, Vite preview serves it, each tab `mount()`s the composition and, per frame, `setFrame()` renders with `flushSync`, waits for fonts, holds, images and two animation frames, then the tab is captured through CDP `Page.captureScreenshot` with `optimizeForSpeed` (several times faster than `page.screenshot`, same pixels). `produceInOrder` feeds PNGs to ffmpeg in order.
- **Errors must fail the render.** Render errors are caught through `onUncaughtError` in the render page; any `pageerror` in a tab also aborts.

## Conventions

- ESM everywhere; relative imports in `src/` use the `.js` extension (NodeNext). Templates and fixtures use bundler resolution and extensionless imports.
- Style is enforced by ESLint with `@stylistic` (no Prettier). Run `npm run lint:fix` before committing.
- Public API changes go together with the README (API table, examples) and tests.
- Unit tests live next to the code as `*.spec.ts(x)` and run in Node; React output is checked with `renderToStaticMarkup`. Anything that needs Chromium or ffmpeg belongs in `test/*.e2e-spec.ts`, which runs against `dist/`.
- Error messages are written for the user of the CLI: say what is wrong and what to do.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Compiles `src/` to `dist/` |
| `npm run ts` | Type checks the package, templates and fixtures |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm test` | Unit tests |
| `npm run test:e2e` | Builds, then runs the CLI against `test/fixtures/basic` (renders, studio, scroll page) and a fresh `init` project (needs ffmpeg) |
