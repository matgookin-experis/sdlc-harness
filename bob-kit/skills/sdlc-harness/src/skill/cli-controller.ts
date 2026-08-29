/** Testable command controller behind the executable CLI entry point. */

import * as fs from 'fs';
import { runAudit } from './audit';
import { persistProjectConfig, validateProjectConfig } from './onboard';
import { applyFinding, rejectFinding } from './review';
import { parseDecisionPayload } from './review-payload';
import { computeAcceptanceRate, readTelemetry } from './telemetry';

export type OutputWriter = (value: string) => void;

/** Read one untrusted JSON file for validation by the command handler. */
function readJson(filePath: string | undefined, purpose: string): unknown {
  if (!filePath) throw new Error(`A JSON ${purpose} file is required.`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`Could not read ${purpose} JSON from ${filePath}: ${detail}`);
  }
}

/** Execute one CLI command and return the intended process exit code. */
export async function runCli(
  args: string[],
  writeOutput: OutputWriter = (value) => process.stdout.write(value),
): Promise<number> {
  const [command, filePath] = args;

  switch (command) {
    case 'onboard': {
      const config = validateProjectConfig(readJson(filePath, 'onboarding'), false);
      const configPath = persistProjectConfig(config);
      writeOutput(`${JSON.stringify({ ok: true, configPath, config }, null, 2)}\n`);
      return 0;
    }
    case 'audit': {
      if (filePath !== undefined) throw new Error('The audit command does not accept a file.');
      writeOutput(`${JSON.stringify(await runAudit(), null, 2)}\n`);
      return 0;
    }
    case 'apply': {
      const payload = parseDecisionPayload(readJson(filePath, 'decision'), 'apply');
      const result = await applyFinding(payload.finding, {
        editedValue: payload.editedValue,
      });
      writeOutput(`${JSON.stringify(result, null, 2)}\n`);
      return result.gitlabWriteSucceeded || payload.finding.agent === 'COV' ? 0 : 2;
    }
    case 'reject': {
      const payload = parseDecisionPayload(readJson(filePath, 'decision'), 'reject');
      const result = await rejectFinding(payload.finding);
      writeOutput(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    case 'summary': {
      if (filePath !== undefined) throw new Error('The summary command does not accept a file.');
      writeOutput(`${JSON.stringify(computeAcceptanceRate(await readTelemetry()), null, 2)}\n`);
      return 0;
    }
    default:
      throw new Error(
        'Usage: sdlc-harness onboard <config.json> | audit | ' +
        'apply <decision.json> | reject <decision.json> | summary',
      );
  }
}
