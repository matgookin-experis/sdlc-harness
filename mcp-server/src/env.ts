/**
 * env.ts — safe configuration loading for the sdlc-harness MCP server.
 *
 * Rules:
 *  - Reads from a dotenv file ONLY if the variable is not already set in
 *    the process environment (never overrides).
 *  - Never logs or echoes credential values.
 *  - The env-file path itself can be overridden via SDLC_ENV_FILE so the
 *    server can be pointed at different environments without code changes.
 *  - Throws a descriptive error listing every missing required variable so
 *    the operator knows exactly what to fix.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Resolved configuration shape
// ---------------------------------------------------------------------------

/** All runtime configuration consumed by the MCP server. */
export interface Config {
  /** GitLab instance host, e.g. "https://gitlab.example.com". No trailing slash. */
  gitlabHost: string;

  /** GitLab project path (e.g. "sdlc-harness-demo/weather") or numeric ID. */
  gitlabProject: string;

  /** GitLab Personal Access Token with api scope. */
  gitlabToken: string;

  /** Emit verbose debug output to stderr when true. */
  debug: boolean;
}

// ---------------------------------------------------------------------------
// Dotenv file parser — avoids a runtime dependency on the dotenv binary
// ---------------------------------------------------------------------------

/**
 * Parse a .env file and return key/value pairs.
 * Lines starting with # and blank lines are ignored.
 * Values may be quoted with single or double quotes (quotes are stripped).
 */
function parseDotenvFile(filePath: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    // File is optional — return empty record if it doesn't exist
    return {};
  }

  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and validate configuration.
 *
 * 1. Determines the env-file path (SDLC_ENV_FILE env var → default ".env").
 * 2. Reads the file and merges into process.env — existing vars win.
 * 3. Validates required vars are present and returns a typed Config object.
 *
 * Throws if any required variable is missing.
 * Never logs values — only variable names.
 */
export function loadConfig(): Config {
  // Determine env-file location
  const envFilePath = resolve(
    process.env["SDLC_ENV_FILE"] ?? ".env"
  );

  // Parse file (silently skipped if absent)
  const fileVars = parseDotenvFile(envFilePath);

  // Merge into process.env WITHOUT overriding existing values
  for (const [key, value] of Object.entries(fileVars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  // Validate required variables
  const required = [
    "GITLAB_HOST",
    "GITLAB_PROJECT",
    "GITLAB_TOKEN",
  ] as const;

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
      `Set them in your .env file or in the process environment.\n` +
      `See .env.example for the expected variable names.`
    );
  }

  return {
    gitlabHost: process.env["GITLAB_HOST"]!.replace(/\/$/, ""),
    gitlabProject: process.env["GITLAB_PROJECT"]!,
    gitlabToken: process.env["GITLAB_TOKEN"]!,
    debug: process.env["SDLC_DEBUG"] === "true" || process.env["SDLC_DEBUG"] === "1",
  };
}

/**
 * Emit a debug message to stderr.
 * Only produces output when config.debug is true.
 * NEVER call this with a token or credential value.
 */
export function debugLog(config: Config, message: string): void {
  if (config.debug) {
    process.stderr.write(`[sdlc-harness debug] ${message}\n`);
  }
}
