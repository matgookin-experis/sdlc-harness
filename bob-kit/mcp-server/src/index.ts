/**
 * index.ts — MCP server entry point for sdlc-harness.
 *
 * Startup sequence:
 *  1. Load configuration from the env file (throws with a clear message if
 *     required variables are missing).
 *  2. Construct the GitLab client with the loaded config.
 *  3. Build the shared ToolContext.
 *  4. Create an McpServer, register every tool from the registry.
 *  5. Connect via StdioServerTransport and stay running.
 *
 * Stderr is kept quiet unless SDLC_DEBUG=true so Bob's stdio transport
 * is not polluted with log noise.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, debugLog } from "./env.js";
import { GitLabClient } from "./gitlab-client.js";
import { TOOLS } from "./tools.js";
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

  // 4. Create MCP server and register tools
  const server = new McpServer({
    name: "sdlc-harness",
    version: "0.1.0",
  });

  for (const tool of TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.argsSchema.shape ?? {},
      async (args: unknown) => {
        const parsed = tool.argsSchema.parse(args);
        const result = await tool.execute(parsed, context);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );
    debugLog(config, `Registered tool: ${tool.name}`);
  }

  debugLog(config, `${TOOLS.length} tool(s) registered. Connecting transport...`);

  // 5. Connect stdio transport and keep the process alive
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Reaching here means the transport has been connected.
  // The process stays alive because the transport holds stdin open.
  debugLog(config, "MCP server connected and listening on stdio.");
}

main().catch((error: unknown) => {
  // Only write to stderr — never stdout (that's the MCP protocol channel)
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[sdlc-harness] Fatal startup error: ${message}\n`);
  process.exit(1);
});
