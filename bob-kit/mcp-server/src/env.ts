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

import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const DEFAULT_ENV_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.env',
);

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
  if (!existsSync(filePath)) {
    return {};
  }

  const stats = lstatSync(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Refusing to load environment file ${filePath}: symbolic links are not allowed.`,
    );
  }

  if (!stats.isFile()) {
    throw new Error(`Environment path is not a regular file: ${filePath}`);
  }

  if (process.platform !== 'win32') {
    const mode = stats.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      const displayMode = mode.toString(8).padStart(3, '0');
      throw new Error(
        `Refusing to load environment file ${filePath}: mode ${displayMode} permits ` +
        'group or world access. Run chmod 600 on the file.',
      );
    }
  }

  const raw = readFileSync(filePath, 'utf-8');

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
 * Resolve the selected credentials file without reading it.
 * @returns The SDLC_ENV_FILE override or canonical repository-root .env path.
 */
export function resolveEnvFilePath(): string {
  return resolve(process.env['SDLC_ENV_FILE'] ?? DEFAULT_ENV_FILE);
}

/**
 * Merge variables from the resolved .env file into process.env, without
 * overriding any variable already set (existing values always win).
 *
 * Silently does nothing if the file is absent. Unsafe files still fail closed.
 */
export function mergeEnvFile(): void {
  const envFilePath = resolveEnvFilePath();

  // Parse file (silently skipped if absent)
  const fileVars = parseDotenvFile(envFilePath);

  // Merge into process.env WITHOUT overriding existing values
  for (const [key, value] of Object.entries(fileVars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Load and validate configuration.
 *
 * 1. Merges the resolved .env file into process.env — existing vars win.
 * 2. Validates required vars are present and returns a typed Config object.
 *
 * Throws if any required variable is missing.
 * Never logs values — only variable names.
 */
export function loadConfig(): Config {
  mergeEnvFile();

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
