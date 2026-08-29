#!/usr/bin/env node

/** Runtime bridge used by Bob's execute tool for review decisions. */

import * as fs from 'fs';
import { applyFinding, rejectFinding } from './skill/review';
import { computeAcceptanceRate, readTelemetry } from './skill/telemetry';
import type { AnyFinding } from './models';

interface DecisionPayload {
  finding: AnyFinding;
  editedValue?: string | null;
}

function readPayload(filePath: string | undefined): DecisionPayload {
  if (!filePath) {
    throw new Error('A JSON decision file is required.');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as DecisionPayload;
}

async function main(): Promise<void> {
  const [command, filePath] = process.argv.slice(2);

  switch (command) {
    case 'apply': {
      const payload = readPayload(filePath);
      const result = await applyFinding(payload.finding, {
        editedValue: payload.editedValue ?? null,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.gitlabWriteCalled) process.exitCode = 2;
      return;
    }
    case 'reject': {
      const payload = readPayload(filePath);
      const result = await rejectFinding(payload.finding);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case 'summary': {
      const summary = computeAcceptanceRate(await readTelemetry());
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }
    default:
      throw new Error('Usage: sdlc-harness-review <apply|reject> <decision.json> | summary');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown runtime error';
  process.stderr.write(`[sdlc-harness] ${message}\n`);
  process.exitCode = 1;
});

