/**
 * index.ts — MCP server entry point for sdlc-harness.
 *
 * Startup sequence:
 *  1. Load configuration from the env file (throws with a clear message if
 *     required variables are missing).
 *  2. Construct the GitLab client with the loaded config.
 *  3. Build the shared ToolContext.
 *  4. Call createServer(context) to build a fully-wired MCP Server.
 *  5. Connect via StdioServerTransport and stay running.
 *
 * Stderr is kept quiet unless SDLC_DEBUG=true so Bob's stdio transport
 * is not polluted with log noise.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, debugLog } from "./env.js";
import { GitLabClient } from "./gitlab-client.js";
import { createServer } from "./server.js";
import type { ToolContext } from "./types.js";

async function main(): Promise<void> {
  // 1. Load + validate configuration
  const config = loadConfig();
  debugLog(config, "Configuration loaded successfully.");

  // 2. Construct GitLab client
  const gitlab = new GitLabClient(
    config.gitlabHost,
    config.gitlabToken,
    config.gitlabProject
  );
  debugLog(config, `GitLab client ready for project: ${config.gitlabProject}`);

  // 3. Build shared context
  const context: ToolContext = { gitlab, config };

  // 4. Build the MCP server
  const server = createServer(context);
  debugLog(config, `Server created. Connecting transport...`);

  // 5. Connect stdio transport and keep the process alive
  const transport = new StdioServerTransport();
  await server.connect(transport);

  debugLog(config, "MCP server connected and listening on stdio.");
}

main().catch((error: unknown) => {
  if (process.env["SDLC_DEBUG"] === "true" || process.env["SDLC_DEBUG"] === "1") {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[sdlc-harness] Fatal startup error: ${message}\n`);
  }
  process.exit(1);
});
