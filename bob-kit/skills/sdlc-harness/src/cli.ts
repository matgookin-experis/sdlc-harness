#!/usr/bin/env node

/** Executable entry point for the SDLC harness command controller. */

import { runCli } from './skill/cli-controller';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown runtime error';
    process.stderr.write(`[sdlc-harness] ${message}\n`);
    process.exitCode = 1;
  });
