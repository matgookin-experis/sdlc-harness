/**
 * telemetry.ts — Suggestion Telemetry (Task 26).
 *
 * Appends one JSON object per accepted, edited, rejected, or failed decision to
 * `sdlc-harness-telemetry.jsonl` beside the selected project config.
 *
 * Rules:
 *  - APPEND ONLY — never truncates or overwrites the file.
 *  - No issue content or secrets are written — only agent tag, issue IID,
 *    action label, outcome, and timestamp.
 *  - Skip decisions are NOT logged (they are neutral).
 *  - Provides acceptance-rate summary logic via `computeAcceptanceRate()`.
 *  - The telemetry file itself must be gitignored (see .gitignore).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { TelemetryEntry } from '../models';
import { resolveProjectConfigPath } from './onboard';

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

/**
 * Resolve the telemetry file path.
 * Defaults beside the selected project config so telemetry cannot mix projects.
 * Override via the SDLC_TELEMETRY_PATH env var for tests.
 */
export function resolveTelemetryPath(): string {
  const override = process.env['SDLC_TELEMETRY_PATH'];
  if (override) return path.resolve(override);
  return path.join(
    path.dirname(resolveProjectConfigPath()),
    'sdlc-harness-telemetry.jsonl',
  );
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append a single telemetry entry to the JSONL file.
 * Creates the file if it does not exist. Never overwrites existing entries.
 */
export async function appendTelemetry(entry: TelemetryEntry): Promise<void> {
  const filePath = resolveTelemetryPath();
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(filePath, line, { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read all telemetry entries from the JSONL file.
 * Returns an empty array if the file does not exist.
 */
export async function readTelemetry(): Promise<TelemetryEntry[]> {
  const filePath = resolveTelemetryPath();

  if (!fs.existsSync(filePath)) return [];

  const entries: TelemetryEntry[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  return new Promise<TelemetryEntry[]>((resolve, reject) => {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      try {
        entries.push(JSON.parse(trimmed) as TelemetryEntry);
      } catch {
        // Ignore malformed lines — telemetry reads should be resilient
      }
    });
    rl.on('close', () => resolve(entries));
    rl.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Acceptance-rate summary
// ---------------------------------------------------------------------------

export interface AcceptanceRateSummary {
  /** Completed review decisions (accepted + edited + rejected) — excludes failed. */
  total: number;
  accepted: number;
  edited: number;
  rejected: number;
  /**
   * Write attempts that did not reach GitLab (adapter returned written:false).
   * Excluded from `total` and from all rate calculations.
   */
  failed: number;
  /** accepted / (accepted + edited + rejected), or 0 when there are no decisions. */
  acceptanceRate: number;
}

/**
 * Compute acceptance-rate statistics from a set of telemetry entries.
 *
 * 'failed' entries are excluded from both the numerator and denominator so
 * that writes which never reached GitLab do not inflate the acceptance rate.
 * Skipped decisions are not in the log and so are never counted.
 */
export function computeAcceptanceRate(
  entries: TelemetryEntry[]
): AcceptanceRateSummary {
  const accepted = entries.filter((e) => e.outcome === 'accepted').length;
  const edited   = entries.filter((e) => e.outcome === 'edited').length;
  const rejected = entries.filter((e) => e.outcome === 'rejected').length;
  const failed   = entries.filter((e) => e.outcome === 'failed').length;

  // 'total' counts only the decisions that were completed (not failed writes).
  const total = accepted + edited + rejected;

  if (total === 0) {
    return { total: 0, accepted: 0, edited: 0, rejected: 0, failed, acceptanceRate: 0 };
  }

  return {
    total,
    accepted,
    edited,
    rejected,
    failed,
    acceptanceRate: accepted / total,
  };
}
