#!/usr/bin/env node
import { relative } from 'node:path';

import { HELP, parseCommand } from './args.js';
import { ensureBrowser } from './browser.js';
import { detectPackageManager, init } from './init.js';
import { createLogger } from './logger.js';
import { packageVersion } from './paths.js';
import { createReporter } from './progress.js';
import { render } from './render.js';
import { startStudio } from './studio.js';


let isJsonProgress = false;

async function main(argv: readonly string[]): Promise<void> {
  const progressIndex = argv.indexOf('--progress');
  if (
    (progressIndex !== -1 && argv[progressIndex + 1] === 'json')
    || argv.includes('--progress=json')
  ) {
    isJsonProgress = true;
  }
  const command = parseCommand(argv, { cwd: process.cwd(), env: process.env });

  switch (command.name) {
    case 'help':
      console.log(HELP[command.topic]);
      return;

    case 'version':
      console.log(packageVersion());
      return;

    case 'init': {
      const { path } = await init({ cwd: process.cwd(), directory: command.directory });
      const pm = detectPackageManager();
      const run = pm === 'npm' ? 'npm run' : pm;
      const where = relative(process.cwd(), path) || '.';
      console.log(`
  Created ${where}

  Next steps:
    cd ${where}
    ${pm} install
    ${run} studio      preview with hot reload
    ${run} render      render out/HelloWorld.mp4
    ${run} page        play the Story video as you scroll
`);
      return;
    }

    case 'studio': {
      const server = await startStudio({ ...command.options, log: createLogger() });
      const stop = () => void server.close().then(() => process.exit(0));
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      return;
    }

    case 'render': {
      const isJson = command.options.progress === 'json';
      if (isJson) {
        isJsonProgress = true;
      }
      await render({ ...command.options, log: createLogger({ quiet: command.quiet, json: isJson }) });
      return;
    }

    case 'browser':
      await ensureBrowser({ ...command.options, log: createLogger().info });
      return;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (isJsonProgress) {
    createReporter({ mode: 'json' }).event({ phase: 'error', message });
  }
  console.error(`\n✖ ${message}`);
  if (process.env.DEBUG && error instanceof Error) {
    console.error(error.stack);
  }
  process.exit(1);
});
